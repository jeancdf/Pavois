#!/usr/bin/env python3
"""
Scan OpenCV camera indexes and print which ones return frames.

Use this when DroidCam/virtual cameras do not map to the indexes you expect:
  python camera_scan.py --max-index 8
  python camera_scan.py --backend DSHOW --max-index 8
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys

try:
    import cv2
except ImportError:
    print("pip install opencv-python", file=sys.stderr)
    raise SystemExit(1)


def api_for_backend(name: str) -> int | None:
    b = name.upper()
    if b == "DEFAULT":
        return None
    if b == "MSMF":
        return cv2.CAP_MSMF
    if b == "DSHOW":
        return cv2.CAP_DSHOW
    raise ValueError(f"Unknown backend {name!r}")


def main() -> None:
    p = argparse.ArgumentParser(description="Scan OpenCV camera indexes.")
    p.add_argument("--max-index", type=int, default=8)
    p.add_argument("--width", type=int, default=640)
    p.add_argument("--height", type=int, default=480)
    p.add_argument(
        "--backend",
        choices=("DEFAULT", "MSMF", "DSHOW"),
        default="DEFAULT",
    )
    p.add_argument(
        "--list-dshow-names",
        action="store_true",
        help="Use ffmpeg to list DirectShow video device names, if ffmpeg is installed.",
    )
    args = p.parse_args()

    if args.list_dshow_names:
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg is None:
            print("ffmpeg not found on PATH; install ffmpeg or use OBS/Windows camera list.")
        else:
            cmd = [ffmpeg, "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            text = proc.stderr + proc.stdout
            print(text)
        return

    api = api_for_backend(args.backend)
    print(f"Scanning indexes 0..{args.max_index} using {args.backend}")
    for idx in range(args.max_index + 1):
        cap = cv2.VideoCapture(idx) if api is None else cv2.VideoCapture(idx, api)
        if not cap.isOpened():
            print(f"{idx}: closed")
            cap.release()
            continue
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
        for _ in range(3):
            cap.grab()
        ok, frame = cap.read()
        if ok and frame is not None and getattr(frame, "size", 0) > 0:
            h, w = frame.shape[:2]
            fps = cap.get(cv2.CAP_PROP_FPS)
            backend_name = cap.getBackendName() if hasattr(cap, "getBackendName") else "?"
            print(f"{idx}: OK {w}x{h} fps={fps:.1f} backend={backend_name}")
        else:
            print(f"{idx}: opened but no frame")
        cap.release()


if __name__ == "__main__":
    main()
