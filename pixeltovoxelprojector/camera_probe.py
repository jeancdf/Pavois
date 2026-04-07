#!/usr/bin/env python3
"""
Probe OpenCV webcam: try common resolutions and print actual frame sizes.

OpenCV does not list supported modes; we set (w,h), grab a frame, and read
shape. Use this to pick --width/--height for capture and realtime scripts.

  python camera_probe.py
  python camera_probe.py --device 1
"""

from __future__ import annotations

import argparse
import sys
import time

try:
    import cv2
except ImportError:
    print("pip install opencv-python", file=sys.stderr)
    raise SystemExit(1)

# Typical USB webcam modes (width, height)
CANDIDATES = [
    (320, 240),
    (424, 240),
    (640, 360),
    (640, 480),
    (800, 600),
    (848, 480),
    (960, 540),
    (1024, 576),
    (1280, 720),
    (1280, 960),
    (1600, 896),
    (1600, 900),
    (1920, 1080),
    (2560, 1440),
    (3840, 2160),
]


def _make_capture(device: int, api: int) -> cv2.VideoCapture:
    if api:
        return cv2.VideoCapture(device, api)
    return cv2.VideoCapture(device)


def try_resolution_fresh(device: int, api: int, w: int, h: int) -> tuple[int, int] | None:
    """
    Open a new capture for each (w,h). MSMF often corrupts buffers if we only
    call set() in a loop on one long-lived VideoCapture (cv2.error on read).
    """
    cap = _make_capture(device, api)
    if not cap.isOpened():
        return None
    try:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
        time.sleep(0.12)
        for _ in range(4):
            cap.grab()
        try:
            ok, frame = cap.read()
        except cv2.error:
            return None
        if not ok or frame is None or getattr(frame, "size", 0) == 0:
            return None
        if len(frame.shape) < 2:
            return None
        fh, fw = frame.shape[:2]
        if fw <= 0 or fh <= 0:
            return None
        return (fw, fh)
    finally:
        cap.release()


def main() -> None:
    p = argparse.ArgumentParser(description="Probe webcam resolutions (OpenCV).")
    p.add_argument("--device", type=int, default=0, help="Camera index")
    p.add_argument(
        "--backend",
        type=str,
        default="",
        help="Windows: try DSHOW if MSMF crashes or mis-reports. Empty = default.",
    )
    args = p.parse_args()

    api = 0
    if args.backend:
        m = {
            "MSMF": cv2.CAP_MSMF,
            "DSHOW": cv2.CAP_DSHOW,
            "FFMPEG": cv2.CAP_FFMPEG,
            "V4L2": cv2.CAP_V4L2,
        }
        if args.backend.upper() not in m:
            print(f"Unknown backend {args.backend}; use one of {list(m)}", file=sys.stderr)
            raise SystemExit(1)
        api = m[args.backend.upper()]

    cap = _make_capture(args.device, api)
    if not cap.isOpened():
        print(f"Cannot open camera {args.device}", file=sys.stderr)
        raise SystemExit(1)

    print(f"Camera index {args.device} opened.")
    if api:
        print(f"Backend API: {args.backend}")
    elif sys.platform == "win32":
        print("(Windows default is often MSMF; use --backend DSHOW if probing fails.)")

    def prop(c: cv2.VideoCapture, name: str, pid: int) -> None:
        print(f"  {name}: {c.get(pid)}")

    print("\nCAP properties (first open; may not match captured frame):")
    prop(cap, "FRAME_WIDTH", cv2.CAP_PROP_FRAME_WIDTH)
    prop(cap, "FRAME_HEIGHT", cv2.CAP_PROP_FRAME_HEIGHT)
    prop(cap, "FPS", cv2.CAP_PROP_FPS)
    prop(cap, "BRIGHTNESS", cv2.CAP_PROP_BRIGHTNESS)
    prop(cap, "CONTRAST", cv2.CAP_PROP_CONTRAST)
    prop(cap, "SATURATION", cv2.CAP_PROP_SATURATION)
    prop(cap, "GAIN", cv2.CAP_PROP_GAIN)
    prop(cap, "AUTO_EXPOSURE", cv2.CAP_PROP_AUTO_EXPOSURE)
    prop(cap, "EXPOSURE", cv2.CAP_PROP_EXPOSURE)
    cap.release()

    print("\nRequested -> actual (fresh open per size; avoids MSMF buffer bugs):")
    seen: set[tuple[int, int]] = set()
    working: list[tuple[int, int, int, int]] = []

    for w, h in CANDIDATES:
        got = try_resolution_fresh(args.device, api, w, h)
        if got is None:
            print(f"  {w:4}x{h:4}  ->  (no frame / error)")
            continue
        aw, ah = got
        key = (aw, ah)
        if key not in seen:
            seen.add(key)
            working.append((w, h, aw, ah))
        print(f"  {w:4}x{h:4}  ->  {aw:4}x{ah:4}")

    if working:
        # Prefer largest pixel count among unique actual sizes
        def pixels(t: tuple[int, int, int, int]) -> int:
            return t[2] * t[3]

        best = max(working, key=pixels)
        print(
            "\nLargest working mode seen: "
            f"request {best[0]}x{best[1]} -> actual {best[2]}x{best[3]}"
        )
        print(
            "Use e.g.:  --width "
            f"{best[2]} --height {best[3]}"
        )
    else:
        print("\nNo candidate resolution returned a frame; try another --device.")


if __name__ == "__main__":
    main()
