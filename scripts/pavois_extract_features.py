#!/usr/bin/env python3
"""Turn recorded flights into a labelled feature table for the track classifier.

    scripts/pavois_extract_features.py RECORDING_DIR [RECORDING_DIR ...] \
        --label drone --out dataset.xlsx

A recording directory is what the bench produces:
    <cam>.mp4 or <cam>.mjpeg   the video
    <cam>.meta.txt             one FrameWallClock=<unix_ns> per frame

What it does, per recording:

  1. Finds the target in every frame of every camera. This uses a per-pixel
     temporal MEDIAN as the background, which is a far better model than the
     detector's online running average (the target moves, so it vanishes from
     the median) -- appropriate here because this is offline labelling, not
     live detection.
  2. Triangulates a 3D track where at least two cameras see it.
  3. Cuts the track into overlapping windows and measures each one.
  4. Appends the windows to an Excel sheet with the given label.

On features: the columns the model trains on are deliberately SCALE-FREE --
angular rates, hover fraction, straightness, silhouette dynamics. They survive
a rig whose extrinsics are not properly calibrated, which is the situation
today (see pavois_imu_calib). altitude_m and speed_mps are written too because
they are what an operator reads, but they are derived from that uncalibrated
geometry, so they are marked uncalibrated and EXCLUDED from training. Once the
rig is calibrated they can be recomputed and promoted without redoing labels.
"""
from __future__ import annotations

import argparse
import math
import pathlib
import subprocess
import sys
import tempfile

import numpy as np

try:
    import pandas as pd
except ImportError:  # pragma: no cover
    sys.exit("pandas is required: python3 -m pip install pandas openpyxl")

# Rail bench: 1 m rig, 0.4286 m between neighbours, walid - jean - tanel seen
# from behind. Headings are the BNO08x medians plus the offsets fitted from the
# 2026-09-23 session, because the sensor measures its housing not the lens.
DEFAULT_RIG = {
    "jean": dict(x=0.0, heading=45.16, elevation=72.18, roll=-5.78),
    "tanel": dict(x=0.4286, heading=20.26, elevation=81.26, roll=-2.66),
    "walid": dict(x=-0.4286, heading=49.32, elevation=57.02, roll=-9.67),
}
DEFAULT_FOV_DEG = 41.0

WIDTH, HEIGHT = 640, 360
DIFF_T = 35          # grey levels; the target is much darker than a lit wall
MIN_AREA = 60
MAX_ASPECT = 4.0
MIN_FILL = 0.20
MAX_AREA_FRAC = 0.08  # a real target never fills this much of the frame


# --------------------------------------------------------------------- video --
def decode_to_pgm(video: pathlib.Path, out_dir: pathlib.Path) -> int:
    """Decode a recording to greyscale PGM frames. Returns the frame count."""
    inputs = (["-f", "mjpeg", "-i", str(video)] if video.suffix == ".mjpeg"
              else ["-i", str(video)])
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", *inputs,
         "-vf", f"scale={WIDTH}:{HEIGHT},format=gray", "-vsync", "0",
         "-f", "image2", str(out_dir / "%06d.pgm")],
        check=True,
    )
    return len(list(out_dir.glob("*.pgm")))


def read_pgm(path: pathlib.Path) -> np.ndarray:
    raw = path.read_bytes()
    idx = fields = 0
    while fields < 4:
        while raw[idx:idx + 1].isspace():
            idx += 1
        if raw[idx:idx + 1] == b"#":
            while raw[idx:idx + 1] != b"\n":
                idx += 1
            continue
        while not raw[idx:idx + 1].isspace():
            idx += 1
        fields += 1
    idx += 1
    return np.frombuffer(raw[idx:idx + WIDTH * HEIGHT], dtype=np.uint8).reshape(HEIGHT, WIDTH)


def find_target(frames_dir: pathlib.Path):
    """Per-frame target centroid and silhouette area, or None when absent."""
    from scipy import ndimage

    files = sorted(frames_dir.glob("*.pgm"))
    if not files:
        return []
    sample = np.stack([read_pgm(f) for f in files[::10]])
    background = np.median(sample, axis=0).astype(np.int16)
    del sample

    max_area = int(MAX_AREA_FRAC * WIDTH * HEIGHT)
    out = []
    for frame_path in files:
        frame = read_pgm(frame_path).astype(np.int16)
        mask = (background - frame) > DIFF_T
        if mask.sum() < MIN_AREA:
            out.append(None)
            continue
        labels, count = ndimage.label(mask)
        if count == 0:
            out.append(None)
            continue
        best = None
        for sl, k in zip(ndimage.find_objects(labels), range(1, count + 1)):
            if sl is None:
                continue
            area = int((labels[sl] == k).sum())
            if not (MIN_AREA <= area <= max_area):
                continue
            bh = sl[0].stop - sl[0].start
            bw = sl[1].stop - sl[1].start
            if max(bw, bh) / max(1, min(bw, bh)) > MAX_ASPECT:
                continue
            if area / max(1, bw * bh) < MIN_FILL:
                continue
            if best is None or area > best[0]:
                best = (area, k, bw, bh)
        if best is None:
            out.append(None)
            continue
        area, k, bw, bh = best
        cy, cx = ndimage.center_of_mass(mask, labels, k)
        out.append(dict(cx=float(cx), cy=float(cy), area=area,
                        fill=area / max(1, bw * bh)))
    return out


# ------------------------------------------------------------------ geometry --
def camera_basis(heading_deg, elevation_deg, roll_deg):
    """Mirrors pavois++/src/math/pose.cpp camera_basis()."""
    h, e, r = np.radians([heading_deg, elevation_deg, roll_deg])
    fwd = np.array([math.sin(h) * math.cos(e), math.cos(h) * math.cos(e), math.sin(e)])
    right = np.array([math.cos(h), -math.sin(h), 0.0])
    up = np.cross(right, fwd)
    up /= np.linalg.norm(up)
    if r:
        cr, sr = math.cos(r), math.sin(r)
        right, up = right * cr + up * sr, up * cr - right * sr
    return fwd / np.linalg.norm(fwd), right, up


def triangulate(observations, rig, fx):
    """Least-squares closest point to the bearing rays. None if under-determined."""
    if len(observations) < 2:
        return None
    origins, directions = [], []
    for cam, obs in observations:
        pose = rig[cam]
        fwd, right, up = camera_basis(pose["heading"], pose["elevation"], pose["roll"])
        xn = (obs["cx"] - WIDTH * 0.5) / fx
        yn = (obs["cy"] - HEIGHT * 0.5) / fx
        d = fwd + xn * right - yn * up
        directions.append(d / np.linalg.norm(d))
        origins.append(np.array([pose["x"], 0.0, 0.0]))
    A = np.zeros((3, 3))
    b = np.zeros(3)
    for o, d in zip(origins, directions):
        P = np.eye(3) - np.outer(d, d)
        A += P
        b += P @ o
    try:
        point = np.linalg.solve(A + np.eye(3) * 1e-9, b)
    except np.linalg.LinAlgError:
        return None
    # Cheirality and a sane range, matching the gates in the live pipeline.
    for o, d in zip(origins, directions):
        rel = point - o
        depth = float(rel @ d)
        rng = float(np.linalg.norm(rel))
        if depth <= 0 or rng < 0.5 or rng > 60.0:
            return None
    return point


# ------------------------------------------------------------------ features --
# Columns the model is allowed to learn from. All scale-free: they describe how
# the target MOVES and how its silhouette behaves, not how far away a possibly
# mis-calibrated rig thinks it is.
FEATURE_COLUMNS = [
    "ang_speed_mean", "ang_speed_std", "ang_speed_p95",
    "ang_accel_mean", "ang_accel_std",
    "turn_rate_mean", "turn_rate_std",
    "hover_fraction", "straightness", "reversals_per_s",
    "vertical_ratio", "area_cv", "area_trend", "fill_mean", "fill_std",
    "flap_power",
]
# Written for the operator, never trained on: they come from geometry that has
# not been calibrated, so a model fitted to them would learn the rig's error.
CONTEXT_COLUMNS = [
    "altitude_m", "speed_mps", "range_m", "cameras_seen", "geometry_calibrated",
]


def _finite(value, fallback=0.0):
    return float(value) if np.isfinite(value) else fallback


def window_features(times, bearings, areas, fills, points, deg_per_px):
    """Measure one window. bearings/areas are per-frame; points may hold None."""
    t = np.asarray(times, dtype=float)
    if len(t) < 8:
        return None
    xy = np.asarray(bearings, dtype=float) * deg_per_px          # degrees
    dt = np.diff(t)
    dt[dt <= 0] = 1e-3
    step = np.diff(xy, axis=0)
    dist = np.hypot(step[:, 0], step[:, 1])
    ang_speed = dist / dt                                         # deg/s
    ang_accel = np.diff(ang_speed) / dt[1:] if len(ang_speed) > 1 else np.zeros(1)

    # Heading in the image plane, and how fast it turns.
    heading = np.degrees(np.arctan2(step[:, 1], step[:, 0]))
    turn = np.diff(heading)
    turn = (turn + 180.0) % 360.0 - 180.0
    turn_rate = np.abs(turn) / dt[1:] if len(turn) else np.zeros(1)

    path = float(dist.sum())
    net = float(np.hypot(*(xy[-1] - xy[0])))
    straightness = net / path if path > 1e-6 else 0.0

    # Sign changes of the along-track direction: darting versus committed flight.
    if len(step) > 2:
        dots = np.einsum("ij,ij->i", step[:-1], step[1:])
        reversals = int((dots < 0).sum())
    else:
        reversals = 0
    span = max(t[-1] - t[0], 1e-3)

    vert = float(np.abs(step[:, 1]).sum())
    horiz = float(np.abs(step[:, 0]).sum())
    vertical_ratio = vert / (vert + horiz) if (vert + horiz) > 1e-6 else 0.0

    area = np.asarray(areas, dtype=float)
    area_mean = float(area.mean()) if area.size else 0.0
    area_cv = float(area.std() / area_mean) if area_mean > 1e-6 else 0.0
    if area.size > 2 and area_mean > 1e-6:
        area_trend = float(np.polyfit(t - t[0], area, 1)[0] / area_mean)
    else:
        area_trend = 0.0

    # Wingbeat leaves a periodic signature in the silhouette that a rigid
    # airframe does not have. Look for power in a 2-15 Hz band.
    flap_power = 0.0
    if area.size >= 16 and area_mean > 1e-6:
        sig = area - area.mean()
        freqs = np.fft.rfftfreq(sig.size, d=float(np.median(dt)))
        power = np.abs(np.fft.rfft(sig)) ** 2
        band = (freqs >= 2.0) & (freqs <= 15.0)
        total = float(power[1:].sum())
        if total > 1e-9:
            flap_power = float(power[band].sum() / total)

    row = {
        "ang_speed_mean": _finite(ang_speed.mean()),
        "ang_speed_std": _finite(ang_speed.std()),
        "ang_speed_p95": _finite(np.percentile(ang_speed, 95)),
        "ang_accel_mean": _finite(np.abs(ang_accel).mean()),
        "ang_accel_std": _finite(ang_accel.std()),
        "turn_rate_mean": _finite(turn_rate.mean()),
        "turn_rate_std": _finite(turn_rate.std()),
        "hover_fraction": _finite(float((ang_speed < 1.0).mean())),
        "straightness": _finite(straightness),
        "reversals_per_s": _finite(reversals / span),
        "vertical_ratio": _finite(vertical_ratio),
        "area_cv": _finite(area_cv),
        "area_trend": _finite(area_trend),
        "fill_mean": _finite(float(np.mean(fills)) if len(fills) else 0.0),
        "fill_std": _finite(float(np.std(fills)) if len(fills) else 0.0),
        "flap_power": _finite(flap_power),
    }

    solved = [p for p in points if p is not None]
    if len(solved) >= 2:
        pts = np.asarray(solved)
        speeds = np.linalg.norm(np.diff(pts, axis=0), axis=1) / max(span / len(pts), 1e-3)
        row["altitude_m"] = _finite(float(pts[:, 2].mean()))
        row["speed_mps"] = _finite(float(speeds.mean()))
        row["range_m"] = _finite(float(np.linalg.norm(pts, axis=1).mean()))
    else:
        row["altitude_m"] = float("nan")
        row["speed_mps"] = float("nan")
        row["range_m"] = float("nan")
    return row


# ------------------------------------------------------- synthetic negatives --
# Drone-only footage cannot teach a model what is NOT a drone, so generate the
# other classes as TRAJECTORIES and push them through the same window_features()
# as the real flights. Doing it at trajectory level rather than inventing
# feature values means the negatives are measured the same way the positives
# are; if the feature code changes, both move together.
#
# The kinematics follow the bands already encoded in vps/src/fusion-classify.ts
# (airplane fast and committed, bird slow and erratic), which is domain
# knowledge rather than measurement -- so these rows are marked synthetic and a
# model's score against real birds should be treated as unproven until real
# footage exists.
def synth_track(kind: str, rng: np.random.Generator, fps: float = 30.0,
                seconds: float = 6.0):
    n = int(fps * seconds)
    t = np.arange(n) / fps
    if kind == "airplane":
        # Fast, straight, far: small steady angular rate, rigid silhouette.
        rate = rng.uniform(0.4, 2.0)                  # deg/s across the frame
        heading = math.radians(rng.uniform(0, 360))
        drift = rng.normal(0, 0.02, n).cumsum()
        ang = np.stack([np.cos(heading) * rate * t + drift,
                        np.sin(heading) * rate * t * rng.uniform(0.0, 0.3)], axis=1)
        base = rng.uniform(120, 400)
        area = base * (1 + rng.normal(0, 0.03, n))
        fill = np.clip(rng.normal(0.55, 0.05, n), 0.1, 1.0)
    elif kind == "bird":
        # Slow mean drift with darting changes of direction, and a wingbeat
        # that modulates the silhouette at a few Hz.
        rate = rng.uniform(1.5, 8.0)
        ang = np.zeros((n, 2))
        heading = rng.uniform(0, 2 * math.pi)
        for i in range(1, n):
            heading += rng.normal(0, 0.35)
            speed = rate * (1.0 + rng.normal(0, 0.4)) / fps
            ang[i] = ang[i - 1] + [speed * math.cos(heading), speed * math.sin(heading)]
        base = rng.uniform(80, 500)
        flap = rng.uniform(3.0, 10.0)                 # Hz
        area = base * (1 + 0.35 * np.sin(2 * math.pi * flap * t) + rng.normal(0, 0.08, n))
        fill = np.clip(rng.normal(0.42, 0.10, n), 0.1, 1.0)
    else:
        raise ValueError(kind)
    return t, ang, np.maximum(area, 1.0), fill


def synth_rows(kind: str, count: int, seed: int, deg_per_px: float, groups: int = 4):
    """Synthetic windows, spread over several nominal sources.

    The source column is the grouping key for validation. Putting every
    generated row in one group would make leave-one-source-out hold the whole
    class out at once: the fold then has a single class to train on and gets
    skipped, so the class is never actually tested and the headline accuracy
    only reflects the real recordings. Several groups per class keeps every
    class present in both training and test folds.
    """
    rng = np.random.default_rng(seed)
    rows = []
    while len(rows) < count:
        t, ang, area, fill = synth_track(kind, rng)
        # window_features multiplies by deg_per_px, so hand it pixel-equivalents
        row = window_features(t, ang / deg_per_px, area, fill, [None], deg_per_px)
        if row is None:
            continue
        row.update(label=kind, source=f"synthetic-{kind}-{len(rows) % groups}",
                   camera="-", cameras_seen=0, geometry_calibrated=False,
                   altitude_m=float("nan"), speed_mps=float("nan"),
                   range_m=float("nan"))
        rows.append(row)
    return rows


# ----------------------------------------------------------------- pipeline --
def process_recording(recording: pathlib.Path, rig, fov_deg, window_s, stride_s,
                      label, keep_frames):
    cams = [c for c in rig if (recording / f"{c}.mp4").exists()
            or (recording / f"{c}.mjpeg").exists()]
    if not cams:
        raise SystemExit(f"no camera video found in {recording}")
    fx = (WIDTH * 0.5) / math.tan(math.radians(fov_deg) * 0.5)
    deg_per_px = fov_deg / WIDTH

    tracks, stamps = {}, {}
    workdir = pathlib.Path(tempfile.mkdtemp(prefix="pavois-feat-"))
    try:
        for cam in cams:
            video = (recording / f"{cam}.mp4")
            if not video.exists():
                video = recording / f"{cam}.mjpeg"
            frames_dir = workdir / cam
            frames_dir.mkdir(parents=True, exist_ok=True)
            print(f"  {cam}: decoding {video.name}", flush=True)
            decode_to_pgm(video, frames_dir)
            print(f"  {cam}: locating the target", flush=True)
            tracks[cam] = find_target(frames_dir)
            meta = recording / f"{cam}.meta.txt"
            stamps[cam] = [int(l.split("=", 1)[1]) / 1e9
                           for l in meta.read_text().splitlines()
                           if l.startswith("FrameWallClock=")]
            seen = sum(1 for v in tracks[cam] if v)
            print(f"  {cam}: target present in {seen}/{len(tracks[cam])} frames", flush=True)
            if not keep_frames:
                for f in frames_dir.glob("*.pgm"):
                    f.unlink()
    finally:
        if not keep_frames:
            subprocess.run(["rm", "-rf", str(workdir)], check=False)

    rows = []
    for cam in cams:
        track, times = tracks[cam], stamps[cam]
        n = min(len(track), len(times))
        if n < 16:
            continue
        t0, t_end = times[0], times[n - 1]
        start = t0
        while start + window_s <= t_end:
            stop = start + window_s
            idx = [i for i in range(n) if start <= times[i] < stop and track[i]]
            if len(idx) >= 8:
                w_t = [times[i] for i in idx]
                w_b = [[track[i]["cx"], track[i]["cy"]] for i in idx]
                w_a = [track[i]["area"] for i in idx]
                w_f = [track[i]["fill"] for i in idx]
                # 3D where another camera saw it at nearly the same instant
                points = []
                for i in idx:
                    obs = [(cam, track[i])]
                    for other in cams:
                        if other == cam:
                            continue
                        m = min(len(tracks[other]), len(stamps[other]))
                        j = min(range(m), key=lambda k: abs(stamps[other][k] - times[i]))
                        if abs(stamps[other][j] - times[i]) < 0.05 and tracks[other][j]:
                            obs.append((other, tracks[other][j]))
                    points.append(triangulate(obs, rig, fx) if len(obs) >= 2 else None)
                row = window_features(w_t, w_b, w_a, w_f, points, deg_per_px)
                if row is not None:
                    row.update(label=label, source=recording.name, camera=cam,
                               cameras_seen=int(sum(1 for p in points if p is not None) > 0) + 1,
                               geometry_calibrated=False)
                    rows.append(row)
            start += stride_s
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("recordings", nargs="*", type=pathlib.Path)
    ap.add_argument("--label", default="drone", help="class for these recordings")
    ap.add_argument("--out", type=pathlib.Path, required=True, help="dataset .xlsx")
    ap.add_argument("--append", action="store_true",
                    help="add to an existing sheet instead of replacing it")
    ap.add_argument("--window", type=float, default=2.0, help="window seconds")
    ap.add_argument("--stride", type=float, default=1.0, help="window stride seconds")
    ap.add_argument("--fov", type=float, default=DEFAULT_FOV_DEG)
    ap.add_argument("--synth-birds", type=int, default=0)
    ap.add_argument("--synth-airplanes", type=int, default=0)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--keep-frames", action="store_true")
    args = ap.parse_args()

    rows = []
    for recording in args.recordings:
        if not recording.is_dir():
            raise SystemExit(f"not a directory: {recording}")
        print(f"{recording.name}:", flush=True)
        rows += process_recording(recording, DEFAULT_RIG, args.fov,
                                  args.window, args.stride, args.label,
                                  args.keep_frames)
    deg_per_px = args.fov / WIDTH
    if args.synth_birds:
        rows += synth_rows("bird", args.synth_birds, args.seed + 1, deg_per_px)
    if args.synth_airplanes:
        rows += synth_rows("airplane", args.synth_airplanes, args.seed + 2, deg_per_px)
    if not rows:
        raise SystemExit("no windows produced")

    frame = pd.DataFrame(rows)[
        ["label", "source", "camera", *FEATURE_COLUMNS, *CONTEXT_COLUMNS]
    ]
    if args.append and args.out.exists():
        frame = pd.concat([pd.read_excel(args.out), frame], ignore_index=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    frame.to_excel(args.out, index=False)
    print(f"\n{len(frame)} rows -> {args.out}")
    print(frame["label"].value_counts().to_string())


if __name__ == "__main__":
    main()
