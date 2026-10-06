#!/usr/bin/env python3
"""Draw synthetic drones into replay-bench frames, consistently in all cameras.

Two commands:

  add    Composite extra drones onto one camera's extracted .pgm frames. The
         replay window is split in thirds: the recorded footage alone, then one
         more drone, then two more. Each drone is a 3D trajectory projected
         through that camera's pose with the pinhole model the vps fuses with,
         so the three cameras agree and the fusion sees real extra targets.

  synth  Write a synthetic recording in the bench format (<cam>.mjpeg and
         <cam>.meta.txt) with one moving drone, for trying the bench without
         footage. It prints the --pose arguments the bench needs.

Projection. The detectors replay without calibrated intrinsics, so their raw
lines carry fx = 0 and the vps falls back to a 1280 x 720 image with the given
field of view (toTriObs in vps/src/fusion/observation/fusion-observation.ts),
whatever the real frame size. The bench's fitted poses rely on that, and so
does this tool: a drone is drawn at the pixel where the vps expects it.

Pure Python (plus ffmpeg for synth), so it runs wherever the bench runs.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

DEG = math.pi / 180.0

# Pixel model of the vps when the detector sends no intrinsics.
VPS_WIDTH = 1280
VPS_HEIGHT = 720

DRONE_SPAN_M = 0.15   # rotor tip to rotor tip
MIN_RANGE_M = 0.6     # the bench keeps fused points between 0.5 and 3 m
MAX_RANGE_M = 2.8
EDGE_PX = 12          # keep the drone centre this far inside the frame


# ------------------------------------------------------------------ geometry --

def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add3(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    return math.sqrt(dot(a, a))


def unit(a):
    n = norm(a)
    return scale(a, 1.0 / n) if n > 1e-12 else (0.0, 0.0, 0.0)


def camera_basis(heading_deg, elevation_deg, roll_deg):
    """Same axes as cameraBasis() in vps/src/fusion/geometry/fusion-geo.ts."""
    h, e, r = heading_deg * DEG, elevation_deg * DEG, roll_deg * DEG
    forward = (math.sin(h) * math.cos(e), math.cos(h) * math.cos(e), math.sin(e))
    right = (math.cos(h), -math.sin(h), 0.0)
    up = unit(cross(right, forward))
    if r != 0.0:
        cr, sr = math.cos(r), math.sin(r)
        right, up = add3(scale(right, cr), scale(up, sr)), add3(scale(up, cr), scale(right, -sr))
    return unit(forward), unit(right), up


class Camera:
    def __init__(self, cam_id, x, y, z, heading, elevation, roll, fov, width, height):
        self.id = cam_id
        self.center = (x, y, z)
        self.forward, self.right, self.up = camera_basis(heading, elevation, roll)
        # The vps fallback intrinsics: 1280 x 720 at this field of view.
        self.f = (VPS_WIDTH * 0.5) / math.tan(fov * 0.5 * DEG)
        self.cx = VPS_WIDTH * 0.5
        self.cy = VPS_HEIGHT * 0.5
        # Real frame, for what is visible and how big a drone looks.
        self.width = width
        self.height = height
        self.f_frame = (width * 0.5) / math.tan(fov * 0.5 * DEG)

    def project(self, p):
        """Pixel where the vps expects p, and its depth; None behind the camera."""
        rel = sub(p, self.center)
        zc = dot(rel, self.forward)
        if zc <= 1e-6:
            return None
        u = self.cx + self.f * dot(rel, self.right) / zc
        v = self.cy + self.f * (-dot(rel, self.up)) / zc
        return u, v, zc

    def ray(self, u, v):
        """Inverse of project: direction of the ray through pixel (u, v)."""
        xn = (u - self.cx) / self.f
        yn = (v - self.cy) / self.f
        return unit(add3(self.forward, add3(scale(self.right, xn), scale(self.up, -yn))))

    def sees(self, p, margin=EDGE_PX):
        hit = self.project(p)
        if hit is None:
            return False
        u, v, zc = hit
        return (margin <= u <= self.width - margin and margin <= v <= self.height - margin
                and MIN_RANGE_M <= zc <= MAX_RANGE_M)


def closest_point(rays):
    """Least-squares point nearest to every (origin, direction) ray, or None."""
    a = [[0.0] * 3 for _ in range(3)]
    b = [0.0, 0.0, 0.0]
    for origin, d in rays:
        proj = [[(1.0 if i == j else 0.0) - d[i] * d[j] for j in range(3)] for i in range(3)]
        for i in range(3):
            for j in range(3):
                a[i][j] += proj[i][j]
            b[i] += sum(proj[i][j] * origin[j] for j in range(3))
    det = (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
           - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
           + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    if abs(det) < 1e-9:
        return None
    sol = []
    for k in range(3):
        m = [row[:] for row in a]
        for i in range(3):
            m[i][k] = b[i]
        sol.append((m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
                    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])) / det)
    return tuple(sol)


def view_center(cameras):
    """A point that every camera sees near the middle of its frame."""
    rays = [(c.center, c.ray(c.width * 0.5, c.height * 0.5)) for c in cameras]
    p = closest_point(rays)
    if p is not None and all(c.sees(p) for c in cameras):
        return p
    # Nearly parallel views: walk out along the first camera's centre ray and
    # keep the first point all of them see.
    origin, d = rays[0]
    for step in range(10, 29):
        q = add3(origin, scale(d, step * 0.1))
        if all(c.sees(q) for c in cameras):
            return q
    raise SystemExit("[drones] no point is visible in all cameras at 0.6-2.8 m; "
                     "check the camera poses")


# ------------------------------------------------------------- trajectories --

# Three lanes side by side, so the drones never cross: the middle one (the
# recorded drone in a real session, a synthetic one in synth), then one on
# each side. Each loops mostly up/down and in depth, which keeps it moving in
# every camera. Per drone: lane offset from the common view point (m: right,
# forward, up), loop amplitudes (m), loop periods (s), phase.
DRONES = [
    ((0.00, 0.00, 0.00), (0.05, 0.15, 0.11), (7.0, 9.0, 4.0), 0.0),
    ((-0.22, -0.10, 0.03), (0.04, 0.12, 0.10), (6.0, 8.0, 3.6), 1.3),
    ((0.22, 0.12, -0.03), (0.04, 0.12, 0.10), (8.0, 6.5, 4.4), 2.6),
]


def make_trajectory(center, cameras, spec):
    offset, amp, period, phase = spec

    def path(lane, swing):
        def at(t):
            return (
                center[0] + lane * offset[0] + swing * amp[0] * math.sin(2 * math.pi * t / period[0] + phase),
                center[1] + lane * offset[1] + swing * amp[1] * math.sin(2 * math.pi * t / period[1] + 2 * phase),
                center[2] + lane * offset[2] + swing * amp[2] * math.sin(2 * math.pi * t / period[2] + 3 * phase),
            )
        return at

    def fits(at):
        for k in range(0, 4 * 60):
            p = at(k / 4.0)
            for c in cameras:
                margin = 0.5 * c.f_frame * DRONE_SPAN_M / max(1e-6, norm(sub(p, c.center)))
                if not c.sees(p, margin):
                    return False
        return True

    # Narrow the loop first, then pull the lane in, until every camera sees
    # the whole drone all the time.
    for lane in (1.0, 0.85, 0.7, 0.55):
        for swing in (1.0, 0.7, 0.5, 0.3):
            at = path(lane, swing)
            if fits(at):
                return at
    raise SystemExit("[drones] could not fit a drone path inside every camera's view")


# ------------------------------------------------------------------- images --

def read_pgm(path):
    data = Path(path).read_bytes()
    fields, pos = [], 0
    while len(fields) < 4:
        while data[pos:pos + 1].isspace():
            pos += 1
        if data[pos:pos + 1] == b"#":
            pos = data.index(b"\n", pos) + 1
            continue
        end = pos
        while not data[end:end + 1].isspace():
            end += 1
        fields.append(data[pos:end])
        pos = end
    if fields[0] != b"P5" or int(fields[3]) != 255:
        raise SystemExit(f"[drones] {path}: only 8-bit binary PGM (P5) is supported")
    width, height = int(fields[1]), int(fields[2])
    pixels = bytearray(data[pos + 1:pos + 1 + width * height])
    return width, height, pixels


def write_pgm(path, width, height, pixels):
    with open(path, "wb") as fh:
        fh.write(f"P5\n{width} {height}\n255\n".encode())
        fh.write(pixels)


_sprites = {}


def sprite(size_px, frac_x, frac_y):
    """Coverage of a quadcopter seen from slightly below: (dx, dy, alpha) list."""
    key = (round(size_px * 2) / 2, round(frac_x * 4) / 4, round(frac_y * 4) / 4)
    if key in _sprites:
        return _sprites[key]
    s, fx, fy = key
    half = s * 0.5
    squash = 0.55                                  # seen from below, not from above
    arm = s * 0.40                                 # centre to rotor hub
    hubs = [(sx * arm * 0.707, sy * arm * 0.707 * squash) for sx in (-1, 1) for sy in (-1, 1)]
    rotor_r, body_r, arm_w = s * 0.16, s * 0.13, max(1.2, s * 0.05)
    cells = []
    r = int(math.ceil(half)) + 2
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            x, y = dx - fx, dy - fy
            # Body: an ellipse.
            d_body = math.hypot(x, y / squash) - body_r
            # Arms: distance to the two diagonals, out to the hubs.
            d_arm = 1e9
            for hx, hy in hubs:
                t = max(0.0, min(1.0, (x * hx + y * hy) / (hx * hx + hy * hy)))
                d_arm = min(d_arm, math.hypot(x - t * hx, y - t * hy) - arm_w * 0.5)
            solid = max(0.0, min(1.0, 0.5 - min(d_body, d_arm)))
            # Spinning rotors: translucent discs.
            disc = 0.0
            for hx, hy in hubs:
                disc = max(disc, max(0.0, min(1.0, 0.5 - (math.hypot(x - hx, (y - hy) / squash) - rotor_r))))
            alpha = max(solid * 0.95, disc * 0.55)
            if alpha > 0.02:
                cells.append((dx, dy, alpha))
    _sprites[key] = cells
    return cells


def draw_drone(pixels, width, height, u, v, size_px):
    iu, iv = int(math.floor(u)), int(math.floor(v))
    cells = sprite(size_px, u - iu, v - iv)
    # Dark drone on a light scene, light drone on a dark one: keep it visible.
    samples = [pixels[(iv + dy) * width + iu + dx] for dx, dy, _ in cells[::7]
               if 0 <= iu + dx < width and 0 <= iv + dy < height]
    ink = 28 if not samples or sum(samples) / len(samples) >= 90 else 225
    for dx, dy, alpha in cells:
        x, y = iu + dx, iv + dy
        if 0 <= x < width and 0 <= y < height:
            i = y * width + x
            p = pixels[i]
            pixels[i] = int(p + (ink - p) * alpha)


def render(pixels, width, height, camera, positions):
    for p in positions:
        hit = camera.project(p)
        if hit is None:
            continue
        u, v, _ = hit
        depth = norm(sub(p, camera.center))
        draw_drone(pixels, width, height, u, v, camera.f_frame * DRONE_SPAN_M / depth)


# ----------------------------------------------------------------- commands --

def load_cameras(spec_path):
    spec = json.loads(Path(spec_path).read_text())
    cams = [Camera(c["id"], c["x"], c.get("y", 0.0), c.get("z", 0.0), c["heading"],
                   c["elevation"], c.get("roll", 0.0), spec["fov"], spec["width"], spec["height"])
            for c in spec["cameras"]]
    return spec, cams


def cmd_add(args):
    spec, cameras = load_cameras(args.cameras)
    camera = next((c for c in cameras if c.id == args.cam), None)
    if camera is None:
        raise SystemExit(f"[drones] camera {args.cam} is not in {args.cameras}")
    center = view_center(cameras)
    paths = [make_trajectory(center, cameras, s) for s in DRONES[1:]]
    t0, t1 = spec["t0_us"], spec["t1_us"]
    third = (t1 - t0) / 3.0

    src, dst = Path(args.src), Path(args.dst)
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    for name in ("fps.txt", "timestamps.txt"):
        if (src / name).exists():
            shutil.copy2(src / name, dst / name)
    frames = sorted(src.glob("*.pgm"))
    stamps = [int(x) for x in (src / "timestamps.txt").read_text().split()]
    if len(stamps) != len(frames):
        raise SystemExit(f"[drones] {src}: {len(frames)} frames, {len(stamps)} timestamps")

    started = time.time()
    for n, (frame, ts) in enumerate(zip(frames, stamps)):
        extra = 0 if ts < t0 + third else (1 if ts < t0 + 2 * third else 2)
        out = dst / frame.name
        if extra == 0:
            try:
                os.link(frame, out)
            except OSError:
                shutil.copy2(frame, out)
            continue
        width, height, pixels = read_pgm(frame)
        t = (ts - t0) / 1e6
        render(pixels, width, height, camera, [path(t) for path in paths[:extra]])
        write_pgm(out, width, height, pixels)
        if n % 300 == 0:
            print(f"[drones]   {args.cam}: {n}/{len(frames)} frames", flush=True)
    print(f"[drones]   {args.cam}: done in {time.time() - started:.0f}s "
          f"(1 drone until +{third / 1e6:.0f}s, 2 until +{2 * third / 1e6:.0f}s, then 3)")


def converging_pose(x, target, fov, width, height):
    """Heading and elevation that put `target` at the centre of the real frame."""
    h, e = 0.0, 0.0
    for _ in range(60):
        cam = Camera("probe", x, 0.0, 0.0, h, e, 0.0, fov, width, height)
        hit = cam.project(target)
        if hit is None:
            break
        u, v, _ = hit
        du, dv = width * 0.5 - u, height * 0.5 - v
        if abs(du) < 0.05 and abs(dv) < 0.05:
            break
        h -= math.atan(du / cam.f) / DEG
        e += math.atan(dv / cam.f) / DEG
    return round(h, 3), round(e, 3)


def cmd_synth(args):
    rail_x = dict(item.split("=") for item in args.rail_x.split(","))
    target = tuple(float(v) for v in args.target.split(","))
    width, height, fov = args.width, args.height, args.fov
    poses = {}
    for cam_id, x in rail_x.items():
        h, e = converging_pose(float(x), target, fov, width, height)
        poses[cam_id] = (float(x), h, e)
    cameras = [Camera(cid, x, 0.0, 0.0, h, e, 0.0, fov, width, height)
               for cid, (x, h, e) in poses.items()]
    center = view_center(cameras)
    drone = make_trajectory(center, cameras, DRONES[0])

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(7)
    n_frames = int(args.seconds * 30)
    start_ns = (int(time.time()) - 3600) * 1_000_000_000
    for k, cam in enumerate(cameras):
        background = make_background(width, height, rng, float(rail_x[cam.id]))
        # Unsynchronised shutters: each camera starts a few ms apart.
        stamps = [start_ns + k * 11_000_000 + i * 33_333_333 + rng.randint(-800_000, 800_000)
                  for i in range(n_frames)]
        (out / f"{cam.id}.meta.txt").write_text(
            "".join(f"FrameWallClock={t}\n" for t in stamps))
        enc = subprocess.Popen(
            ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "rawvideo",
             "-pix_fmt", "gray", "-s", f"{width}x{height}", "-r", "30", "-i", "-",
             "-vf", "noise=alls=7:allf=t", "-c:v", "mjpeg", "-q:v", "3",
             "-f", "mjpeg", str(out / f"{cam.id}.mjpeg")],
            stdin=subprocess.PIPE)
        for i, t_ns in enumerate(stamps):
            pixels = bytearray(background)
            render(pixels, width, height, cam, [drone((t_ns - start_ns) / 1e9)])
            enc.stdin.write(pixels)
        enc.stdin.close()
        if enc.wait() != 0:
            raise SystemExit("[drones] ffmpeg failed")
        print(f"[drones] {cam.id}: {n_frames} frames written")
    print("[drones] replay it with:")
    print("  scripts/pavois_replay_bench.sh --recording " + str(out) +
          f" --from 0 --duration {int(args.seconds) - 3} --fov {fov} --add-drones " +
          " ".join(f"--pose {cid}={h},{e},0" for cid, (_, h, e) in poses.items()))


def make_background(width, height, rng, shift_m):
    """A wall, a door, a window and some posters: static texture to subtract."""
    px = bytearray(width * height)
    for y in range(height):
        base = 150 + int(30 * y / height)
        for x in range(width):
            px[y * width + x] = base + ((x * 7 + y * 13) % 5)
    shift = int(shift_m * 200)
    for _ in range(14):
        w, h = rng.randint(30, 140), rng.randint(20, 110)
        x0 = (rng.randint(0, width) + shift) % width
        y0 = rng.randint(0, height - h)
        shade = rng.choice((95, 115, 185, 205))
        for y in range(y0, y0 + h):
            row = y * width
            for x in range(x0, min(width, x0 + w)):
                px[row + x] = shade
    return bytes(px)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub_cmds = parser.add_subparsers(dest="cmd", required=True)

    add = sub_cmds.add_parser("add", help="composite extra drones onto one camera's frames")
    add.add_argument("--cameras", required=True, help="JSON: fov, width, height, t0_us, t1_us, cameras[]")
    add.add_argument("--cam", required=True)
    add.add_argument("--src", required=True, help="extracted frames (.pgm + timestamps.txt)")
    add.add_argument("--dst", required=True, help="where to write the composited frames")
    add.set_defaults(func=cmd_add)

    synth = sub_cmds.add_parser("synth", help="write a synthetic one-drone recording")
    synth.add_argument("--out", required=True)
    synth.add_argument("--seconds", type=float, default=48.0)
    synth.add_argument("--width", type=int, default=640)
    synth.add_argument("--height", type=int, default=360)
    synth.add_argument("--fov", type=float, default=41.0)
    synth.add_argument("--rail-x", default="jean=0.0,tanel=0.4286,walid=-0.4286",
                       help="camera positions along the rail, as the bench sets them")
    synth.add_argument("--target", default="0.0,2.4,0.85",
                       help="point the three cameras converge on (x right, y forward, z up)")
    synth.set_defaults(func=cmd_synth)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
