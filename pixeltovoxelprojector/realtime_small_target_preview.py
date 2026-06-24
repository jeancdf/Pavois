#!/usr/bin/env python3
"""
Phase 1 + 2 demonstrator: live small-target detection AND tracking on ONE
camera (no PyTorch).

Opens a webcam (or video file / URL), runs the small-target detector
(`small_target_detector.py`), then links detections over time into tracks
(`target_tracker.py`). Only tracks that persist AND move coherently get
"confirmed" — so a faint mover becomes a stable marker, while flickering
clutter (wires/cables) and random speckle are filtered out.

Left pane = live image with sticky markers (confirmed = solid + velocity
arrow + trail; tentative = small grey dot). Right pane = detector response.

Quick start:
  python realtime_small_target_preview.py --device 0
  python realtime_small_target_preview.py --self-test     # no camera needed
  python realtime_small_target_preview.py --source clip.mp4

Bigger test objects (held close to the camera) need a bigger highlighter:
  python realtime_small_target_preview.py --device 0 --tophat 31

Live keys:  q quit   + / - threshold sensitivity   p polarity   b background on/off

Indoor fast-object test:
  python realtime_small_target_preview.py --device 0 --backend DSHOW --profile indoor-fast
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

try:
    import cv2
except ImportError:
    print("pip install opencv-python", file=sys.stderr)
    raise SystemExit(1)

import numpy as np

from camera_backend import open_camera
from camera_preprocess import PreprocessConfig, TemporalState, preprocess_gray
from small_target_detector import (
    FastMotionConfig,
    FastMotionDetector,
    SmallTargetConfig,
    SmallTargetDetector,
    TargetDetection,
    synthesize_frame,
)
from target_tracker import MultiTargetTracker, Track, TrackerConfig

# BGR colours (OpenCV order).
COL_BRIGHT = (90, 230, 255)    # amber-ish for bright targets
COL_DARK = (255, 170, 90)      # blue-ish for dark targets
COL_TRAIL = (120, 220, 120)
COL_TENT = (140, 140, 140)     # tentative (unconfirmed) tracks
COL_TEXT = (240, 240, 240)
COL_HUD_BG = (24, 24, 24)

PROFILE_DEFAULTS = {
    "distant-target": {
        "detector": "tophat",
        "polarity": "dark",
        "tophat_scales": "9,31",
        "motion_threshold": 12.0,
        "motion_min_area": 12,
        "motion_close": 3,
        "gate_radius": 40.0,
        "gate_track": 14.0,
        "gate_speed_k": 2.0,
        "gate_max": 140.0,
        "confirm_hits": 3,
        "confirm_window": 5,
        "min_travel": 6.0,
        "gaussian": 3,
        "heatmap_every": 1,
        "min_area": 1, "max_area": 0, "max_bbox_size": 0, "max_targets": 30,
        "large_blob_peak": False,
        "show_tentative": True, "show_arrows": True, "show_trails": True,
        "display_tracks": 0, "display_max_speed": 0.0, "display_max_misses": 0,
        "fixed_arrow_length": 0.0, "arrow_min_speed": 0.5,
        "max_coast": 8,
    },
    "very-distant-aircraft": {
        "detector": "tophat",
        "polarity": "dark",
        "tophat_scales": "9",
        "motion_threshold": 12.0,
        "motion_min_area": 12,
        "motion_close": 3,
        "gate_radius": 160.0,
        "gate_track": 24.0,
        "gate_speed_k": 2.5,
        "gate_max": 320.0,
        "confirm_hits": 5,
        "confirm_window": 8,
        "min_travel": 3.0,
        "gaussian": 0,
        "heatmap_every": 0,
        "min_area": 1, "max_area": 80, "max_bbox_size": 16, "max_targets": 24,
        "large_blob_peak": True,
        "show_tentative": False, "show_arrows": True, "show_trails": False,
        "display_tracks": 12, "display_max_speed": 0.0, "display_max_misses": 30,
        "fixed_arrow_length": 22.0, "arrow_min_speed": 0.25,
        "max_coast": 30,
    },
    "indoor-fast": {
        "detector": "motion",
        "polarity": "both",
        "tophat_scales": "9,31",
        "motion_threshold": 12.0,
        "motion_min_area": 12,
        "motion_close": 3,
        "gate_radius": 200.0,
        "gate_track": 60.0,
        "gate_speed_k": 2.0,
        "gate_max": 300.0,
        "confirm_hits": 2,
        "confirm_window": 4,
        "min_travel": 10.0,
        "gaussian": 0,
        "heatmap_every": 5,
        "min_area": 1, "max_area": 0, "max_bbox_size": 0, "max_targets": 30,
        "large_blob_peak": False,
        "show_tentative": True, "show_arrows": True, "show_trails": True,
        "display_tracks": 0, "display_max_speed": 0.0, "display_max_misses": 0,
        "fixed_arrow_length": 0.0, "arrow_min_speed": 0.5,
        "max_coast": 8,
    },
}


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------
def draw_tracks(
    frame: np.ndarray,
    tracks: list[Track],
    show_tentative: bool = True,
    show_arrows: bool = True,
    show_trails: bool = True,
    display_tracks: int = 0,
    display_max_speed: float = 0.0,
    display_max_misses: int = 0,
    fixed_arrow_length: float = 0.0,
    arrow_min_speed: float = 0.5,
) -> None:
    if display_tracks > 0:
        active = [
            t for t in tracks
            if t.confirmed
            and t.misses <= display_max_misses
            and (display_max_speed <= 0 or t.speed <= display_max_speed)
        ]
        active.sort(key=lambda t: (t.hits, t.score), reverse=True)
        tracks = active[:display_tracks]
    for t in tracks:
        if not t.confirmed:
            if show_tentative:
                cv2.circle(frame, (int(t.u), int(t.v)), 3, COL_TENT, 1, cv2.LINE_AA)
            continue
        col = COL_BRIGHT if t.polarity == "bright" else COL_DARK
        if show_trails:
            pts = list(t.trail)
            for a, b in zip(pts[:-1], pts[1:]):
                cv2.line(frame, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])),
                         COL_TRAIL, 1, cv2.LINE_AA)
        u, v = int(round(t.u)), int(round(t.v))
        cv2.line(frame, (u - 9, v), (u - 3, v), col, 1, cv2.LINE_AA)
        cv2.line(frame, (u + 3, v), (u + 9, v), col, 1, cv2.LINE_AA)
        cv2.line(frame, (u, v - 9), (u, v - 3), col, 1, cv2.LINE_AA)
        cv2.line(frame, (u, v + 3), (u, v + 9), col, 1, cv2.LINE_AA)
        cv2.circle(frame, (u, v), 11, col, 1, cv2.LINE_AA)
        if show_arrows and t.speed >= arrow_min_speed:
            if fixed_arrow_length > 0:
                du = t.vu / t.speed * fixed_arrow_length
                dv = t.vv / t.speed * fixed_arrow_length
            else:
                du = t.vu * 6.0
                dv = t.vv * 6.0
            tip = (int(round(t.u + du)), int(round(t.v + dv)))
            cv2.arrowedLine(frame, (u, v), tip, col, 1, cv2.LINE_AA, tipLength=0.3)
        label = f"#{t.id} {t.score:.0f}" + ("~" if t.misses > 0 else "")
        cv2.putText(frame, label, (u + 13, v - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, col, 1, cv2.LINE_AA)


def response_heatmap(response: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    m = float(response.max())
    if m <= 1e-6:
        vis = np.zeros(response.shape, dtype=np.uint8)
    else:
        vis = np.clip(response / m * 255.0, 0, 255).astype(np.uint8)
    vis = cv2.applyColorMap(vis, cv2.COLORMAP_INFERNO)
    return cv2.resize(vis, (out_w, out_h), interpolation=cv2.INTER_NEAREST)


def draw_hud(img: np.ndarray, lines: list[str]) -> None:
    font, scale, thick, lh, pad = cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1, 18, 6
    box_w = max((cv2.getTextSize(s, font, scale, thick)[0][0] for s in lines), default=0) + pad * 2
    box_h = lh * len(lines) + pad * 2
    roi = img[0:box_h, 0:box_w]
    if roi.size:
        overlay = roi.copy()
        cv2.rectangle(overlay, (0, 0), (box_w, box_h), COL_HUD_BG, -1)
        cv2.addWeighted(overlay, 0.8, roi, 0.2, 0, dst=roi)
    y = pad + lh - 4
    for s in lines:
        cv2.putText(img, s, (pad, y), font, scale, COL_TEXT, thick, cv2.LINE_AA)
        y += lh


# ---------------------------------------------------------------------------
# Capture
# ---------------------------------------------------------------------------
def open_source(source: str, width: int, height: int, backend: str) -> tuple[cv2.VideoCapture, str]:
    """Webcam index (with MSMF/DSHOW fallback) OR a video file / URL."""
    s = str(source).strip()
    if s.isdigit():
        return open_camera(int(s), width, height, backend)
    cap = cv2.VideoCapture(s)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open source {source!r} (file path or URL).")
    if width > 0:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    if height > 0:
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return cap, f"file/url:{s}"


# ---------------------------------------------------------------------------
# Self-test (no camera): detector locks the faint blob, the tracker confirms a
# coherent mover and follows it, and noise-only frames confirm nothing.
# ---------------------------------------------------------------------------
def _median(xs: list[float]) -> float:
    return float(np.median(xs)) if xs else float("inf")


def run_self_test() -> int:
    # A) detector sub-pixel accuracy on a faint moving blob.
    cfg = SmallTargetConfig(polarity="both", warmup_frames=10)
    det = SmallTargetDetector(cfg)
    rng = np.random.default_rng(1234)
    measured = hits = 0
    errors: list[float] = []
    for t in range(60):
        gray, (tu, tv) = synthesize_frame(t, 320, 240, rng=rng)
        dets, _ = det.update(gray)
        if t <= cfg.warmup_frames:
            continue
        measured += 1
        if not dets:
            continue
        best = min(dets, key=lambda d: math.hypot(d.u - tu, d.v - tv))
        err = math.hypot(best.u - tu, best.v - tv)
        if err <= 3.0:
            hits += 1
            errors.append(err)
    rate = hits / max(1, measured)
    med_err = _median(errors)
    detector_ok = rate >= 0.8 and med_err <= 1.5

    # B) end-to-end: tracker confirms the mover and follows it.
    det2 = SmallTargetDetector(SmallTargetConfig(polarity="both", warmup_frames=10))
    trk = MultiTargetTracker()
    rng2 = np.random.default_rng(99)
    follow: list[float] = []
    ever_confirmed = False
    for t in range(60):
        gray, (tu, tv) = synthesize_frame(t, 320, 240, rng=rng2)
        dets, _ = det2.update(gray)
        tracks = trk.update(dets)
        conf = [x for x in tracks if x.confirmed and x.misses == 0]
        if conf:
            ever_confirmed = True
            best = min(conf, key=lambda c: math.hypot(c.u - tu, c.v - tv))
            follow.append(math.hypot(best.u - tu, best.v - tv))
    track_ok = ever_confirmed and _median(follow) <= 3.0

    # C) noise-only frames -> nothing confirmed.
    det3 = SmallTargetDetector(SmallTargetConfig(polarity="both", warmup_frames=10))
    trk3 = MultiTargetTracker()
    rng3 = np.random.default_rng(7)
    noise_false = 0
    for t in range(60):
        gray, _ = synthesize_frame(t, 320, 240, amp=0.0, rng=rng3)
        dets, _ = det3.update(gray)
        tracks = trk3.update(dets)
        noise_false = max(noise_false, len([x for x in tracks if x.confirmed]))
    noise_ok = noise_false == 0

    # D) indoor-fast tracker profile: an object moving 55 px/frame must keep
    # one identity and confirm instead of respawning every frame.
    fast_tracker = MultiTargetTracker(TrackerConfig(
        gate_radius=200.0,
        gate_track=60.0,
        gate_speed_k=2.0,
        gate_max=300.0,
        confirm_hits=2,
        confirm_window=4,
        confirm_travel=10.0,
    ))
    fast_confirmed = False
    fast_track_ids: set[int] = set()
    for t in range(5):
        fast_dets = [TargetDetection(
            u=30.0 + 55.0 * t,
            v=80.0 + 4.0 * t,
            score=30.0,
            area=40,
            polarity="bright",
            bbox=(0, 0, 8, 5),
        )]
        fast_tracks = fast_tracker.update(fast_dets)
        fast_track_ids.update(x.id for x in fast_tracks if x.hits > 1)
        fast_confirmed = fast_confirmed or any(x.confirmed for x in fast_tracks)
    fast_ok = fast_confirmed and len(fast_track_ids) == 1

    # E) the fast detector sees a nearby object after it changes position and
    # stays quiet on an unchanged frame.
    motion_detector = FastMotionDetector(FastMotionConfig(
        threshold=12.0, min_area=12, close_ksize=3
    ))
    indoor_a = np.full((120, 220), 100, dtype=np.uint8)
    indoor_b = indoor_a.copy()
    cv2.rectangle(indoor_b, (80, 45), (110, 65), 220, -1)
    first_dets, _ = motion_detector.update(indoor_a)
    moving_dets, _ = motion_detector.update(indoor_b)
    static_dets, _ = motion_detector.update(indoor_b)
    fast_detector_ok = not first_dets and bool(moving_dets) and not static_dets

    print(f"detector: hit_rate={rate:.2f} median_err_px={med_err:.2f}")
    print(f"tracker: confirmed_follow={'yes' if ever_confirmed else 'no'} "
          f"follow_err_px={_median(follow):.2f} noise_false_confirmed={noise_false} "
          f"fast_mover_ok={fast_ok} fast_detector_ok={fast_detector_ok}")
    if detector_ok and track_ok and noise_ok and fast_ok and fast_detector_ok:
        print("SMALL_TARGET_SELF_TEST_OK")
        return 0
    print("SMALL_TARGET_SELF_TEST_FAIL", file=sys.stderr)
    return 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Phase 1+2 live small-target preview (no torch).")
    ap.add_argument(
        "--profile",
        choices=tuple(PROFILE_DEFAULTS),
        default="distant-target",
        help="Parameter preset; explicit detector/tracker arguments override it.",
    )
    ap.add_argument("--device", type=int, default=0, help="OpenCV webcam index.")
    ap.add_argument("--source", type=str, default="", help="Video file path or URL (overrides --device).")
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--backend", choices=("AUTO", "MSMF", "DSHOW", "DEFAULT"), default="AUTO")
    # Detector
    ap.add_argument("--detector", choices=("tophat", "motion"), default=None,
                    help="Detection algorithm; overrides the selected profile.")
    ap.add_argument("--polarity", choices=("both", "bright", "dark"), default=None,
                    help="Target contrast; overrides the selected profile.")
    ap.add_argument("--tophat-scales", type=str, default=None,
                    help="Comma list of top-hat sizes (px); overrides the selected profile.")
    ap.add_argument("--tophat", type=int, default=0,
                    help="Single top-hat size (px); overrides --tophat-scales when >0.")
    ap.add_argument("--no-background", action="store_true", help="Disable the slow-background brick (moving camera).")
    ap.add_argument("--bg-alpha", type=float, default=0.02)
    ap.add_argument("--bg-novelty", type=float, default=6.0)
    ap.add_argument("--thresh-sigma", type=float, default=6.0)
    ap.add_argument("--abs-floor", type=float, default=2.0)
    ap.add_argument("--min-area", type=int, default=None)
    ap.add_argument("--max-area", type=int, default=None,
                    help="0 = no upper limit on blob size.")
    ap.add_argument("--max-bbox-size", type=int, default=None,
                    help="Reject detections wider or taller than this; 0=off.")
    ap.add_argument("--max-targets", type=int, default=None)
    ap.add_argument("--warmup", type=int, default=10)
    ap.add_argument("--motion-threshold", type=float, default=None,
                    help="Frame-difference threshold for the motion detector.")
    ap.add_argument("--motion-min-area", type=int, default=None,
                    help="Minimum changed blob area for the motion detector.")
    ap.add_argument("--motion-close", type=int, default=None,
                    help="Morphological close kernel for the motion detector; 0=off.")
    # Tracker (Phase 2)
    ap.add_argument("--gate-radius", type=float, default=None,
                    help="Association gate for a fresh track; overrides the profile.")
    ap.add_argument("--gate-track", type=float, default=None,
                    help="Base gate once velocity is known; overrides the profile.")
    ap.add_argument("--gate-speed-k", type=float, default=None,
                    help="Established gate growth per pixel/frame of target speed.")
    ap.add_argument("--gate-max", type=float, default=None,
                    help="Maximum association gate once velocity is known.")
    ap.add_argument("--confirm-hits", type=int, default=None)
    ap.add_argument("--confirm-window", type=int, default=None)
    ap.add_argument("--min-travel", type=float, default=None,
                    help="Min net displacement to confirm; overrides the profile.")
    ap.add_argument("--max-coast", type=int, default=None)
    ap.add_argument("--no-tentative", action="store_true", help="Hide unconfirmed tracks.")
    ap.add_argument("--trail", type=int, default=30)
    # Preprocess (reused from camera_preprocess)
    ap.add_argument("--gaussian", type=int, default=None,
                    help="Odd Gaussian kernel before detection; 0=off; overrides the profile.")
    ap.add_argument("--bilateral-d", type=int, default=0)
    ap.add_argument("--temporal", type=float, default=0.0)
    # Run control
    ap.add_argument("--no-hud", action="store_true")
    ap.add_argument("--heatmap-every", type=int, default=None,
                    help="Refresh detector response every N frames; 0 hides it.")
    ap.add_argument("--headless", action="store_true", help="No window (timing / CI).")
    ap.add_argument("--frames", type=int, default=0, help="Stop after N processed frames; 0=forever.")
    ap.add_argument("--self-test", action="store_true", help="Run the synthetic self-test and exit.")
    return ap


def main() -> None:
    args = build_arg_parser().parse_args()

    if args.self_test:
        raise SystemExit(run_self_test())

    profile = PROFILE_DEFAULTS[args.profile]
    detector_name = args.detector or profile["detector"]
    polarity = args.polarity or profile["polarity"]
    tophat_scales = args.tophat_scales or profile["tophat_scales"]
    motion_threshold = (
        args.motion_threshold if args.motion_threshold is not None
        else profile["motion_threshold"]
    )
    motion_min_area = (
        args.motion_min_area if args.motion_min_area is not None
        else profile["motion_min_area"]
    )
    motion_close = (
        args.motion_close if args.motion_close is not None
        else profile["motion_close"]
    )
    gate_radius = args.gate_radius if args.gate_radius is not None else profile["gate_radius"]
    gate_track = args.gate_track if args.gate_track is not None else profile["gate_track"]
    gate_speed_k = args.gate_speed_k if args.gate_speed_k is not None else profile["gate_speed_k"]
    gate_max = args.gate_max if args.gate_max is not None else profile["gate_max"]
    confirm_hits = args.confirm_hits if args.confirm_hits is not None else profile["confirm_hits"]
    confirm_window = args.confirm_window if args.confirm_window is not None else profile["confirm_window"]
    min_travel = args.min_travel if args.min_travel is not None else profile["min_travel"]
    gaussian = args.gaussian if args.gaussian is not None else profile["gaussian"]
    heatmap_every = (
        args.heatmap_every if args.heatmap_every is not None
        else profile["heatmap_every"]
    )
    min_area = args.min_area if args.min_area is not None else profile["min_area"]
    max_area = args.max_area if args.max_area is not None else profile["max_area"]
    max_bbox_size = (
        args.max_bbox_size if args.max_bbox_size is not None
        else profile["max_bbox_size"]
    )
    max_targets = (
        args.max_targets if args.max_targets is not None
        else profile["max_targets"]
    )
    max_coast = (
        args.max_coast if args.max_coast is not None
        else profile["max_coast"]
    )

    scales = (args.tophat,) if args.tophat > 0 else tuple(
        int(x) for x in tophat_scales.split(",") if x.strip()
    )
    cfg = SmallTargetConfig(
        polarity=polarity,
        tophat_scales=scales,
        use_background=not args.no_background,
        bg_alpha=args.bg_alpha,
        bg_novelty=args.bg_novelty,
        thresh_sigma=args.thresh_sigma,
        abs_floor=args.abs_floor,
        min_area=min_area,
        max_area=max_area,
        max_bbox_size=max_bbox_size,
        large_blob_peak=profile["large_blob_peak"],
        max_targets=max_targets,
        warmup_frames=args.warmup,
    )
    if detector_name == "motion":
        detector = FastMotionDetector(FastMotionConfig(
            threshold=motion_threshold,
            min_area=motion_min_area,
            max_area=max_area,
            close_ksize=motion_close,
            max_targets=max_targets,
        ))
    else:
        detector = SmallTargetDetector(cfg)
    tracker = MultiTargetTracker(TrackerConfig(
        gate_radius=gate_radius,
        gate_track=gate_track,
        gate_speed_k=gate_speed_k,
        gate_max=gate_max,
        confirm_hits=confirm_hits,
        confirm_window=confirm_window,
        confirm_travel=min_travel,
        max_coast=max_coast,
        trail_len=args.trail,
    ))
    pp_cfg = PreprocessConfig(
        gaussian_ksize=gaussian,
        bilateral_d=args.bilateral_d,
        temporal=args.temporal,
    )
    pp_state = TemporalState()

    src = args.source if args.source else str(args.device)
    try:
        cap, label = open_source(src, args.width, args.height, args.backend)
    except RuntimeError as e:
        print(e, file=sys.stderr)
        raise SystemExit(1)
    print(
        f"source={src} backend={label} profile={args.profile} detector={detector_name} "
        f"gate={gate_radius:g}/{gate_track:g}/{gate_max:g}"
    )

    win = "pavois petite-cible"
    if not args.headless:
        cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    fps, fps_t, frames = 0.0, time.perf_counter(), 0
    cached_heat: np.ndarray | None = None
    try:
        while True:
            ok, bgr = cap.read()
            if not ok or bgr is None or getattr(bgr, "size", 0) == 0:
                break

            gray_u8 = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            if (
                (detector_name == "motion" or detector_name == "tophat")
                and not pp_cfg.gaussian_ksize
                and not pp_cfg.bilateral_d
                and pp_cfg.temporal <= 0
            ):
                gray = gray_u8
            else:
                gray = preprocess_gray(
                    gray_u8.astype(np.float32), pp_state, pp_cfg
                )
            dets, response = detector.update(gray)
            tracks = tracker.update(dets)

            frames += 1
            if frames % 15 == 0:
                now = time.perf_counter()
                fps = 15.0 / max(1e-6, now - fps_t)
                fps_t = now

            if not args.headless:
                overlay = bgr.copy()
                draw_tracks(
                    overlay,
                    tracks,
                    show_tentative=(
                        profile["show_tentative"] and not args.no_tentative
                    ),
                    show_arrows=profile["show_arrows"],
                    show_trails=profile["show_trails"],
                    display_tracks=profile["display_tracks"],
                    display_max_speed=profile["display_max_speed"],
                    display_max_misses=profile["display_max_misses"],
                    fixed_arrow_length=profile["fixed_arrow_length"],
                    arrow_min_speed=profile["arrow_min_speed"],
                )
                h, w = overlay.shape[:2]
                if heatmap_every > 0 and (
                    cached_heat is None or frames % heatmap_every == 0
                ):
                    cached_heat = response_heatmap(response, w, h)
                combo = (
                    np.hstack([overlay, cached_heat])
                    if heatmap_every > 0 and cached_heat is not None
                    else overlay
                )
                if not args.no_hud:
                    n_conf = sum(1 for t in tracks if t.confirmed)
                    n_tent = sum(1 for t in tracks if not t.confirmed)
                    warming = (
                        detector_name == "tophat"
                        and cfg.use_background
                        and detector.frame_count <= cfg.warmup_frames
                    )
                    detector_line = (
                        f"mouvement seuil {motion_threshold:g}  aire {motion_min_area}+"
                        if detector_name == "motion"
                        else f"polarite {cfg.polarity}  fond {'on' if cfg.use_background else 'off'}  "
                             f"sigma {cfg.thresh_sigma:.1f}  "
                             f"tophat {'/'.join(map(str, cfg.tophat_scales))}"
                    )
                    keys_line = (
                        "q quitter | +/- seuil mouvement"
                        if detector_name == "motion"
                        else "q quitter | +/- sensibilite | p polarite | b fond"
                    )
                    draw_hud(combo, [
                        f"profil {args.profile}  detecteur {detector_name}  |  "
                        f"fps {fps:4.1f}  |  detections {len(dets)}  |  {w}x{h}",
                        f"pistes confirmees {n_conf}  |  tentatives {n_tent}"
                        f"{'  (warmup...)' if warming else ''}",
                        detector_line,
                        keys_line,
                    ])
                cv2.setWindowTitle(win, f"PAVOIS petite-cible | {fps:.1f} fps")
                cv2.imshow(win, combo)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                elif key in (ord("+"), ord("=")):
                    if detector_name == "motion":
                        motion_threshold = max(1.0, motion_threshold - 1.0)
                        detector.cfg.threshold = motion_threshold
                    else:
                        cfg.thresh_sigma = max(0.5, cfg.thresh_sigma - 0.5)
                elif key == ord("-"):
                    if detector_name == "motion":
                        motion_threshold += 1.0
                        detector.cfg.threshold = motion_threshold
                    else:
                        cfg.thresh_sigma += 0.5
                elif key == ord("p") and detector_name == "tophat":
                    cfg.polarity = {"both": "bright", "bright": "dark", "dark": "both"}[cfg.polarity]
                elif key == ord("b") and detector_name == "tophat":
                    cfg.use_background = not cfg.use_background
                    if cfg.use_background:
                        detector.reset()  # rebuild the sky model + warmup

            if args.frames > 0 and frames >= args.frames:
                break
    finally:
        cap.release()
        if not args.headless:
            cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
