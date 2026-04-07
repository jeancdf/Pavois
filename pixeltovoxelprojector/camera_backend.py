"""
OpenCV VideoCapture helpers. On Windows, MSMF sometimes opens but fails to
grab (-1072875772); try DirectShow (DSHOW) as fallback.
"""

from __future__ import annotations

import sys
import time

import cv2


def _make_cap(device: int, api: int | None) -> cv2.VideoCapture:
    if api is None:
        return cv2.VideoCapture(device)
    return cv2.VideoCapture(device, api)


def _try_open(
    device: int,
    api: int | None,
    width: int,
    height: int,
    warm_grabs: int = 3,
) -> cv2.VideoCapture | None:
    cap = _make_cap(device, api)
    if not cap.isOpened():
        cap.release()
        return None
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    time.sleep(0.08)
    for _ in range(warm_grabs):
        cap.grab()
    ok, frame = cap.read()
    if ok and frame is not None and getattr(frame, "size", 0) > 0:
        return cap
    cap.release()
    return None


def open_camera(
    device: int,
    width: int,
    height: int,
    backend: str = "AUTO",
) -> tuple[cv2.VideoCapture, str]:
    """
    Open camera and verify a frame can be read.
    Returns (capture, backend_label for logging).

    backend:
      AUTO   — Windows: try MSMF then DSHOW. Else: default OpenCV backend.
      MSMF   — Media Foundation (Windows).
      DSHOW  — DirectShow (Windows).
      DEFAULT — cv2.VideoCapture(index) only.
    """
    b = backend.strip().upper()
    if b not in ("AUTO", "MSMF", "DSHOW", "DEFAULT"):
        raise ValueError(f"Unknown backend {backend!r}")

    if b == "AUTO":
        if sys.platform == "win32":
            for api, label in ((cv2.CAP_MSMF, "MSMF"), (cv2.CAP_DSHOW, "DSHOW")):
                cap = _try_open(device, api, width, height)
                if cap is not None:
                    return cap, label
        else:
            cap = _try_open(device, None, width, height)
            if cap is not None:
                return cap, "default"
        raise RuntimeError(
            f"Could not read frames from camera {device}. "
            "Close other apps using the camera; try --backend DSHOW or MSMF."
        )

    if b == "MSMF":
        cap = _try_open(device, cv2.CAP_MSMF, width, height)
        if cap is None:
            raise RuntimeError("MSMF: camera open or read failed.")
        return cap, "MSMF"

    if b == "DSHOW":
        cap = _try_open(device, cv2.CAP_DSHOW, width, height)
        if cap is None:
            raise RuntimeError("DSHOW: camera open or read failed.")
        return cap, "DSHOW"

    cap = _try_open(device, None, width, height)
    if cap is None:
        raise RuntimeError("DEFAULT: camera open or read failed.")
    return cap, "default"
