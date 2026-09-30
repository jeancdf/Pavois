#!/usr/bin/env python3
"""Score the detector against a recorded session. Repeatable, no hardware.

    scripts/pavois_test_recording.py RECORDING_DIR

Replays every camera of a recording through pavois_detect and reports how much
of the target it actually found, measured against an independent ground truth.

The yardstick is NOT the detector. Ground truth comes from a per-pixel temporal
MEDIAN over the whole clip, which is a near-perfect background because the
target moves and therefore vanishes from the median. The live detector cannot
use that -- it only ever has the past -- so the two are genuinely independent
and the detector cannot grade its own homework.

The headline number is what the fusion stage actually needs:

    of the frames where at least two cameras genuinely see the target,
    on how many did at least two cameras detect it?

Per-camera recall is reported too, plus the longest stretches where the target
was visible and missed, which is what turns into a dropped track.

Exit status is 0 when the run clears --min-fusable, 1 otherwise, so it can gate
a change the way ctest does.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import shutil
import subprocess
import sys
import tempfile

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from pavois_extract_features import (DEFAULT_FOV_DEG, DEFAULT_RIG, HEIGHT,  # noqa: E402
                                     WIDTH, decode_to_pgm, find_target)

TOL_PX = 40.0          # a detection this close to truth counts as the target
FPS = 30.0


def repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parent.parent


def build_detector(build_dir: pathlib.Path) -> pathlib.Path:
    subprocess.run(["cmake", "-S", str(repo_root() / "pavois++"), "-B", str(build_dir),
                    "-DCMAKE_BUILD_TYPE=Release"], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["cmake", "--build", str(build_dir), "--parallel",
                    str(max(1, (subprocess.os.cpu_count() or 2))), "--target", "pavois_detect"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    binary = build_dir / "pavois_detect"
    if not binary.exists():
        raise SystemExit("pavois_detect did not build")
    return binary


def camera_videos(recording: pathlib.Path):
    found = {}
    for cam in DEFAULT_RIG:
        for suffix in (".mp4", ".mjpeg"):
            candidate = recording / f"{cam}{suffix}"
            if candidate.exists():
                found[cam] = candidate
                break
    if not found:
        raise SystemExit(f"no camera video in {recording}")
    return found


def common_window(recording: pathlib.Path, cams, start_s: float, duration_s: float):
    """Frame index and timestamp span each camera contributes to the window."""
    stamps = {}
    for cam in cams:
        meta = recording / f"{cam}.meta.txt"
        if not meta.exists():
            raise SystemExit(f"missing {meta.name} (needed to align the cameras)")
        stamps[cam] = [int(l.split("=", 1)[1]) for l in meta.read_text().splitlines()
                       if l.startswith("FrameWallClock=")]
        if not stamps[cam]:
            raise SystemExit(f"{meta.name} has no FrameWallClock lines")
    overlap_start = max(v[0] for v in stamps.values())
    overlap_end = min(v[-1] for v in stamps.values())
    t0 = overlap_start + int(start_s * 1e9)
    t1 = overlap_end if duration_s <= 0 else min(overlap_end, t0 + int(duration_s * 1e9))
    if t1 <= t0:
        raise SystemExit(
            f"empty window: --from {start_s}s is past the end of the "
            f"{(overlap_end - overlap_start) / 1e9:.1f}s of common footage")
    plan = {}
    for cam in cams:
        idx = [i for i, t in enumerate(stamps[cam]) if t0 <= t <= t1]
        plan[cam] = dict(start=idx[0], count=len(idx),
                         timestamps=[stamps[cam][i] // 1000 for i in idx])
    return plan, (overlap_end - overlap_start) / 1e9, (t1 - t0) / 1e9


def prepare_frames(recording, videos, plan, cache_root: pathlib.Path):
    key = hashlib.md5(
        f"{recording}|{sorted(videos)}|{[(c, plan[c]['start'], plan[c]['count']) for c in sorted(plan)]}"
        .encode()).hexdigest()[:12]
    cache = cache_root / key
    if (cache / ".complete").exists():
        return cache, True
    if cache.exists():
        shutil.rmtree(cache)
    for cam, video in videos.items():
        out = cache / cam
        out.mkdir(parents=True, exist_ok=True)
        inputs = (["-f", "mjpeg", "-i", str(video)] if video.suffix == ".mjpeg"
                  else ["-i", str(video)])
        print(f"  {cam}: extracting {plan[cam]['count']} frames", flush=True)
        subprocess.run(
            ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", *inputs,
             "-vf", f"select='gte(n\\,{plan[cam]['start']})',scale={WIDTH}:{HEIGHT},format=gray",
             "-vsync", "0", "-frames:v", str(plan[cam]["count"]),
             "-f", "image2", str(out / "%06d.pgm")], check=True)
        got = len(list(out.glob("*.pgm")))
        want = len(plan[cam]["timestamps"])
        if got != want:
            raise SystemExit(f"{cam}: extracted {got} frames but planned {want}")
        (out / "fps.txt").write_text("30\n")
        # Written last: ReplaySource refuses a timestamps.txt whose length does
        # not match the frames, which is exactly the mistake worth catching.
        (out / "timestamps.txt").write_text(
            "\n".join(str(t) for t in plan[cam]["timestamps"]) + "\n")
    (cache / ".complete").touch()
    return cache, False


def write_config(path: pathlib.Path, frames: pathlib.Path, cams, obs_prefix, fov):
    lines = ["frames=-1", "replay_loop=false", "replay_realtime=false",
             "processing_threads=3", f"observation_log={obs_prefix}",
             "output_host=", "output_port=0",
             "classification.enabled=false", "preview.enabled=false",
             "imu.enabled=false", ""]
    for i, cam in enumerate(cams):
        pose = DEFAULT_RIG[cam]
        lines += [f"camera.{i}.id={cam}",
                  f"camera.{i}.device={frames / cam}",
                  f"camera.{i}.enabled=true",
                  f"camera.{i}.width={WIDTH}", f"camera.{i}.height={HEIGHT}",
                  f"camera.{i}.fov_deg={fov}",
                  f"camera.{i}.x={pose['x']}", f"camera.{i}.y=0.0", f"camera.{i}.z=0.0",
                  f"camera.{i}.heading_deg={pose['heading']}",
                  f"camera.{i}.elevation_deg={pose['elevation']}",
                  f"camera.{i}.roll_deg={pose['roll']}", ""]
    path.write_text("\n".join(lines))


def load_observations(prefix: pathlib.Path, cam: str):
    """Per-frame: was anything confirmed, and where were all the candidates."""
    path = pathlib.Path(f"{prefix}.{cam}.csv")
    if not path.exists():
        return []
    rows = []
    with path.open() as fh:
        next(fh, None)
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            head, _, blobs = line.partition(";")
            fields = head.split(",")
            if len(fields) < 11:
                continue
            candidates = []
            if blobs:
                for blob in blobs.split(";"):
                    parts = blob.split(":")
                    if len(parts) == 3:
                        try:
                            candidates.append((float(parts[0]), float(parts[1])))
                        except ValueError:
                            pass
            try:
                rows.append((int(fields[3]), candidates))
            except ValueError:
                continue
    return rows


def score(truth, observed, cams):
    """Per-camera recall, and the joint result the fusion stage depends on."""
    n = min(min(len(truth[c]), len(observed[c])) for c in cams)
    visible, detected, report = {}, {}, {}
    for cam in cams:
        vis = np.zeros(n, bool)
        hit = np.zeros(n, bool)
        top = np.zeros(n, bool)
        for i in range(n):
            target = truth[cam][i]
            confirmed, candidates = observed[cam][i]
            if target is None:
                continue
            vis[i] = True
            if not confirmed or not candidates:
                continue
            dists = [math.hypot(cx - target["cx"], cy - target["cy"])
                     for cx, cy in candidates]
            hit[i] = min(dists) < TOL_PX
            top[i] = dists[0] < TOL_PX
        visible[cam], detected[cam] = vis, hit
        report[cam] = dict(
            visible=int(vis.sum()),
            found=int(hit[vis].sum()),
            recall=float(hit[vis].mean()) if vis.any() else float("nan"),
            top_is_target=float(top[vis].mean()) if vis.any() else float("nan"),
        )

    V = np.stack([visible[c] for c in cams])
    D = np.stack([visible[c] & detected[c] for c in cams])
    gt2 = V.sum(axis=0) >= 2
    ok2 = D.sum(axis=0) >= 2
    missed = gt2 & ~ok2

    runs = []
    if missed.any():
        idx = np.where(missed)[0]
        start = idx[0]
        for a, b in zip(idx, idx[1:]):
            if b != a + 1:
                runs.append((start, a))
                start = b
        runs.append((start, idx[-1]))
        runs.sort(key=lambda r: r[1] - r[0], reverse=True)
    return report, dict(
        frames=n,
        two_cam_visible=int(gt2.sum()),
        two_cam_detected=int((gt2 & ok2).sum()),
        fusable=float((gt2 & ok2).sum() / gt2.sum()) if gt2.any() else float("nan"),
        missed=int(missed.sum()),
        runs=[(int(a), int(b)) for a, b in runs[:6]],
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("recording", type=pathlib.Path)
    ap.add_argument("--from", dest="start", type=float, default=0.0,
                    help="seconds into the common window to start")
    ap.add_argument("--duration", type=float, default=0.0, help="0 = to the end")
    ap.add_argument("--fov", type=float, default=DEFAULT_FOV_DEG)
    ap.add_argument("--min-fusable", type=float, default=0.95,
                    help="exit non-zero below this two-camera detection rate")
    ap.add_argument("--work-dir", type=pathlib.Path,
                    default=pathlib.Path.home() / ".cache/pavois/test-recording")
    ap.add_argument("--json", type=pathlib.Path, help="also write the result as JSON")
    args = ap.parse_args()

    recording = args.recording.resolve()
    if not recording.is_dir():
        raise SystemExit(f"not a directory: {recording}")
    videos = camera_videos(recording)
    cams = sorted(videos)
    print(f"recording : {recording.name}")
    print(f"cameras   : {', '.join(cams)}")

    plan, overlap_s, window_s = common_window(recording, cams, args.start, args.duration)
    print(f"footage   : {overlap_s:.1f}s common, replaying {window_s:.1f}s")

    args.work_dir.mkdir(parents=True, exist_ok=True)
    frames, cached = prepare_frames(recording, videos, plan, args.work_dir / "frames")
    print(f"frames    : {'cached' if cached else 'extracted'} at {frames}")

    binary = build_detector(args.work_dir / "build")
    run_dir = pathlib.Path(tempfile.mkdtemp(prefix="pavois-test-"))
    try:
        config = run_dir / "test.conf"
        obs_prefix = run_dir / "obs"
        write_config(config, frames, cams, obs_prefix, args.fov)
        print("detector  : replaying", flush=True)
        subprocess.run([str(binary), "--config", str(config)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        observed = {c: load_observations(obs_prefix, c) for c in cams}
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)

    print("truth     : locating the target offline", flush=True)
    truth = {c: find_target(frames / c) for c in cams}

    per_cam, joint = score(truth, observed, cams)

    print(f"\n{'camera':8} {'visible':>8} {'found':>8} {'recall':>8} {'top-ranked':>11}")
    for cam in cams:
        r = per_cam[cam]
        print(f"{cam:8} {r['visible']:8d} {r['found']:8d} {r['recall']:8.3f} {r['top_is_target']:11.3f}")

    print(f"\nframes where >=2 cameras see the target : {joint['two_cam_visible']}"
          f" ({100 * joint['two_cam_visible'] / max(1, joint['frames']):.1f}% of {joint['frames']})")
    print(f"  of those, >=2 also detected it        : {joint['two_cam_detected']}"
          f"  ({100 * joint['fusable']:.2f}%)   <-- fusable")
    print(f"  missed                                : {joint['missed']}")
    if joint["runs"]:
        print("  longest misses:")
        for a, b in joint["runs"]:
            print(f"    frames {a}-{b}  {b - a + 1:5d} ({(b - a + 1) / FPS:.1f}s)")

    if args.json:
        args.json.write_text(json.dumps(
            {"recording": recording.name, "window_s": window_s,
             "per_camera": per_cam, "joint": joint}, indent=2) + "\n")
        print(f"\njson -> {args.json}")

    ok = joint["fusable"] >= args.min_fusable
    print(f"\n{'PASS' if ok else 'FAIL'}: fusable {100 * joint['fusable']:.2f}% "
          f"vs threshold {100 * args.min_fusable:.0f}%")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
