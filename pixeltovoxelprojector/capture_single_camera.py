#!/usr/bin/env python3
"""
Capture consecutive frames from one USB / laptop camera and write metadata
for ray_voxel (wrapped JSON with a room-scale voxel_grid section).

Single-camera runs smear energy along rays; this is for pipeline testing.

Example:
  pip install opencv-python
  python capture_single_camera.py --out single_cam_run --frames 40

Then (after building ray_voxel):
  ray_voxel single_cam_run/metadata.json single_cam_run single_cam_run/voxel_grid.bin
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

try:
    import cv2
    import numpy as np
except ImportError:
    print("Install OpenCV: pip install opencv-python", file=sys.stderr)
    raise SystemExit(1)

from camera_backend import open_camera
from camera_preprocess import PreprocessConfig, TemporalState, preprocess_gray


def main() -> None:
    p = argparse.ArgumentParser(description="Capture frames for ray_voxel (1 camera).")
    p.add_argument(
        "--out",
        type=Path,
        default=Path("single_cam_run"),
        help="Output folder for images + metadata.json",
    )
    p.add_argument("--device", type=int, default=0, help="OpenCV camera index")
    p.add_argument("--frames", type=int, default=35, help="Number of frames (>=2)")
    p.add_argument("--width", type=int, default=640)
    p.add_argument("--height", type=int, default=480)
    p.add_argument("--interval", type=float, default=0.15, help="Seconds between frames")
    p.add_argument("--fov", type=float, default=60.0, help="Horizontal FOV degrees")
    p.add_argument("--yaw", type=float, default=0.0)
    p.add_argument("--pitch", type=float, default=90.0, help="90 = horizon in +Y (see PLAN.md)")
    p.add_argument("--roll", type=float, default=0.0)
    p.add_argument("--cam-x", type=float, default=0.0)
    p.add_argument("--cam-y", type=float, default=0.0)
    p.add_argument("--cam-z", type=float, default=1.5)
    p.add_argument("--grid-n", type=int, default=72, help="Voxel grid resolution N (NxNxN)")
    p.add_argument(
        "--voxel-size",
        type=float,
        default=0.35,
        help="Meters per voxel (volume is N * voxel_size wide)",
    )
    p.add_argument(
        "--grid-center",
        type=float,
        nargs=3,
        metavar=("X", "Y", "Z"),
        default=[0.0, 10.0, 5.0],
        help="World meters: ENU-style (X east, Y north, Z up)",
    )
    p.add_argument(
        "--gaussian",
        type=int,
        default=0,
        metavar="K",
        help="Odd blur kernel (3,5,7); 0=off. Reduces high-frequency noise.",
    )
    p.add_argument(
        "--bilateral-d",
        type=int,
        default=0,
        help="Bilateral diameter (5,7,9); 0=off. Slower but preserves edges.",
    )
    p.add_argument("--bilateral-sigma-color", type=float, default=55.0)
    p.add_argument("--bilateral-sigma-space", type=float, default=55.0)
    p.add_argument(
        "--temporal",
        type=float,
        default=0.0,
        help="0..0.9 blend with previous frame (reduces flicker). 0=off.",
    )
    p.add_argument(
        "--backend",
        type=str,
        default="AUTO",
        choices=("AUTO", "MSMF", "DSHOW", "DEFAULT"),
        help="Windows: AUTO tries MSMF then DSHOW if grab fails.",
    )
    args = p.parse_args()

    if args.frames < 2:
        print("--frames must be at least 2 (motion needs pairs).", file=sys.stderr)
        raise SystemExit(1)

    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        cap, cap_be = open_camera(
            args.device, args.width, args.height, args.backend
        )
    except RuntimeError as e:
        print(e, file=sys.stderr)
        raise SystemExit(1)
    print(f"OpenCV camera backend: {cap_be}")

    pp_cfg = PreprocessConfig(
        gaussian_ksize=args.gaussian,
        bilateral_d=args.bilateral_d,
        bilateral_sigma_color=args.bilateral_sigma_color,
        bilateral_sigma_space=args.bilateral_sigma_space,
        temporal=args.temporal,
    )
    pp_state = TemporalState()

    frame_entries = []

    for i in range(args.frames):
        ok, bgr = cap.read()
        if not ok:
            print(f"Frame {i}: read failed", file=sys.stderr)
            break
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
        gray = preprocess_gray(gray, pp_state, pp_cfg)
        out_u8 = np.clip(gray, 0, 255).astype(np.uint8)
        bgr_save = cv2.cvtColor(out_u8, cv2.COLOR_GRAY2BGR)
        name = f"frame_{i:04d}.jpg"
        path = out_dir / name
        cv2.imwrite(str(path), bgr_save)
        frame_entries.append(
            {
                "camera_index": 0,
                "frame_index": i,
                "camera_position": [args.cam_x, args.cam_y, args.cam_z],
                "yaw": args.yaw,
                "pitch": args.pitch,
                "roll": args.roll,
                "fov_degrees": args.fov,
                "image_file": name,
            }
        )
        if i + 1 < args.frames and args.interval > 0:
            time.sleep(args.interval)

    cap.release()

    if len(frame_entries) < 2:
        print("Need at least 2 saved frames.", file=sys.stderr)
        raise SystemExit(1)

    doc = {
        "frames": frame_entries,
        "voxel_grid": {
            "N": args.grid_n,
            "voxel_size": args.voxel_size,
            "grid_center": list(args.grid_center),
        },
    }
    meta_path = out_dir / "metadata.json"
    meta_path.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    print(f"Wrote {len(frame_entries)} frames and {meta_path}")


if __name__ == "__main__":
    main()
