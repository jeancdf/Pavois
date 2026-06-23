#!/usr/bin/env python3
"""
Live camera + motion-to-voxel preview (same camera / world convention as
ray_voxel.cpp). Uses PyTorch on CUDA when available for voxel scatter;
falls back to CPU PyTorch otherwise.

Windows:
  pip install opencv-python torch  # GPU: install CUDA wheel from pytorch.org

Controls: q = quit

Only moving pixels are sent to the voxel scatter (see --max-rays). Static
pixels are never accumulated. --motion-stride further thins candidates for
speed; --preview-motion-only blacks out static pixels on the left (still full-res
motion mask); combine with --motion-stride to cut voxel work.

Lag / smear: use --motion-from raw (default) so diff is not delayed by
--temporal or heavy blur. Uniform skin/tongue shows mostly edges in pure
frame-diff; try --foreground and/or --motion-close. Shorter voxel trails:
lower --decay (e.g. 0.65).
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

try:
    import numpy as np
    import torch
except ImportError:
    print("pip install torch numpy", file=sys.stderr)
    raise SystemExit(1)

from camera_backend import open_camera
from camera_preprocess import PreprocessConfig, TemporalState, preprocess_gray


def deg2rad(d: float) -> float:
    return d * math.pi / 180.0


def rotation_matrix_ypr(yaw_deg: float, pitch_deg: float, roll_deg: float):
    """R = Rz(yaw) @ Ry(roll) @ Rx(pitch), row vectors: v_world = v_cam @ R.T."""
    y, p, r = deg2rad(yaw_deg), deg2rad(pitch_deg), deg2rad(roll_deg)
    cy, sy = math.cos(y), math.sin(y)
    Rz = np.array([[cy, -sy, 0.0], [sy, cy, 0.0], [0.0, 0.0, 1.0]])
    cr, sr = math.cos(r), math.sin(r)
    Ry = np.array([[cr, 0.0, sr], [0.0, 1.0, 0.0], [-sr, 0.0, cr]])
    cp, sp = math.cos(p), math.sin(p)
    Rx = np.array([[1.0, 0.0, 0.0], [0.0, cp, -sp], [0.0, sp, cp]])
    return (Rz @ Ry @ Rx).astype(np.float32)


def ray_aabb_t_batch(
    orig: torch.Tensor,
    d: torch.Tensor,
    gmin: torch.Tensor,
    gmax: torch.Tensor,
    eps: float = 1e-7,
):
    """Axis-aligned box; orig,d [B,3], gmin,gmax [3]. Returns t0,t1 [B], ok."""
    device, dtype = orig.device, orig.dtype
    b = orig.shape[0]
    t0 = torch.zeros(b, device=device, dtype=dtype)
    t1 = torch.full((b,), 1e30, device=device, dtype=dtype)
    for ax in range(3):
        o = orig[:, ax]
        di = d[:, ax]
        mn, mx = gmin[ax], gmax[ax]
        sgn = torch.where(di >= 0, 1.0, -1.0)
        safe = torch.where(di.abs() < eps, sgn * eps, di)
        t_near = (mn - o) / safe
        t_far = (mx - o) / safe
        lo = torch.minimum(t_near, t_far)
        hi = torch.maximum(t_near, t_far)
        t0 = torch.maximum(t0, lo)
        t1 = torch.minimum(t1, hi)
    ok = (t1 >= t0) & (t1 >= 0)
    t0 = torch.clamp(t0, min=0.0)
    return t0, t1, ok


def draw_stats_hud(
    img: np.ndarray,
    lines: list[str],
    x0: int = 8,
    y0: int = 8,
    font_scale: float = 0.5,
    line_px: int = 18,
    pad: int = 6,
) -> None:
    """Semi-opaque panel + text (BGR uint8 image, modified in place)."""
    if not lines:
        return
    font = cv2.FONT_HERSHEY_SIMPLEX
    thickness = 1
    max_w = 0
    for ln in lines:
        (tw, _), _ = cv2.getTextSize(ln, font, font_scale, thickness)
        max_w = max(max_w, tw)
    box_w = max_w + pad * 2
    box_h = line_px * len(lines) + pad * 2
    x1, y1 = x0 + box_w, y0 + box_h
    roi = img[y0:y1, x0:x1]
    if roi.size == 0:
        return
    overlay = roi.copy()
    cv2.rectangle(overlay, (0, 0), (box_w, box_h), (24, 24, 24), -1)
    cv2.addWeighted(overlay, 0.82, roi, 0.18, 0, dst=roi)
    cv2.rectangle(img, (x0, y0), (x1, y1), (90, 90, 90), 1)
    y = y0 + pad + line_px - 4
    for ln in lines:
        cv2.putText(
            img,
            ln,
            (x0 + pad, y),
            font,
            font_scale,
            (245, 245, 245),
            thickness,
            cv2.LINE_AA,
        )
        y += line_px


def pick_device(force_cuda: bool, no_cuda: bool) -> torch.device:
    if no_cuda:
        return torch.device("cpu")
    if force_cuda and not torch.cuda.is_available():
        print("CUDA requested but not available; using CPU.", file=sys.stderr)
    if torch.cuda.is_available() and not no_cuda:
        return torch.device("cuda")
    return torch.device("cpu")


def main() -> None:
    ap = argparse.ArgumentParser(description="Live motion -> voxel preview.")
    ap.add_argument("--device", type=int, default=0, help="OpenCV camera index")
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--fov", type=float, default=60.0)
    ap.add_argument("--yaw", type=float, default=0.0)
    ap.add_argument("--pitch", type=float, default=90.0)
    ap.add_argument("--roll", type=float, default=0.0)
    ap.add_argument("--cam-x", type=float, default=0.0)
    ap.add_argument("--cam-y", type=float, default=0.0)
    ap.add_argument("--cam-z", type=float, default=1.5)
    ap.add_argument("--grid-n", type=int, default=64)
    ap.add_argument("--voxel-size", type=float, default=0.35)
    ap.add_argument(
        "--grid-center",
        type=float,
        nargs=3,
        default=[0.0, 10.0, 5.0],
        metavar=("X", "Y", "Z"),
    )
    ap.add_argument("--motion", type=float, default=8.0, help="Gray diff thresh")
    ap.add_argument(
        "--motion-votes",
        type=int,
        default=0,
        metavar="N",
        help="3x3 support: keep pixel only if N neighbors also exceed --motion "
        "(removes isolated speckle; try 2–3 instead of raising --motion). 0=off.",
    )
    ap.add_argument(
        "--decay",
        type=float,
        default=0.88,
        help="Voxel memory per frame (lower=faster fade, less trail on right).",
    )
    ap.add_argument(
        "--motion-from",
        type=str,
        choices=("raw", "processed"),
        default="raw",
        help="raw=instant frame-diff; processed=after blur/temporal (can smear/lag).",
    )
    ap.add_argument(
        "--motion-blur",
        type=int,
        default=0,
        metavar="K",
        help="Odd Gaussian on raw motion only (3); 0=off. Light noise vs speed.",
    )
    ap.add_argument(
        "--motion-close",
        type=int,
        default=0,
        help="Morph close iterations: glue edge fragments (tongue/face interior).",
    )
    ap.add_argument(
        "--foreground",
        action="store_true",
        help="Add MOG2 background mask OR frame-diff (fills moving blobs better).",
    )
    ap.add_argument(
        "--foreground-thresh",
        type=int,
        default=200,
        help="MOG2 mask threshold 0-255 when --foreground.",
    )
    ap.add_argument(
        "--motion-diff-median",
        type=int,
        default=3,
        metavar="K",
        help="Odd median on |diff| before thresh (kills speckle); 0=off.",
    )
    ap.add_argument(
        "--motion-open",
        type=int,
        default=1,
        help="Morph open iterations: remove thin/salt noise on mask; 0=off.",
    )
    ap.add_argument(
        "--motion-min-area",
        type=int,
        default=2,
        help="Drop connected blobs smaller than this (pixels); 0=off.",
    )
    ap.add_argument(
        "--ray-steps",
        type=int,
        default=28,
        help="Samples along each ray (lower=faster; try 28–36 for 30 fps).",
    )
    ap.add_argument(
        "--max-rays",
        type=int,
        default=1800,
        help="Cap motion pixels / frame (lower=faster).",
    )
    ap.add_argument(
        "--motion-scale",
        type=float,
        default=0.5,
        help="Run diff/morph on scaled frame (0.5=4x fewer pixels); 1.0=full res.",
    )
    ap.add_argument(
        "--voxel-viz-every",
        type=int,
        default=2,
        help="Refresh right voxel panel every N frames (1=every frame).",
    )
    ap.add_argument(
        "--hud-vox-interval",
        type=int,
        default=6,
        help="Recompute voxel max for HUD every N frames (less GPU sync).",
    )
    ap.add_argument(
        "--motion-stride",
        type=int,
        default=1,
        help="Keep 1 of every N pixels on a grid for motion+voxels (2–4 = faster).",
    )
    ap.add_argument(
        "--preview-motion-only",
        action="store_true",
        help="Left pane: static areas black; moving pixels use --motion-fill.",
    )
    ap.add_argument(
        "--motion-fill",
        type=str,
        choices=("white", "red", "camera"),
        default="white",
        help="Moving pixels: solid white (no sensor color noise), red, or camera.",
    )
    ap.add_argument("--cuda", action="store_true", help="Prefer CUDA if available")
    ap.add_argument("--no-cuda", action="store_true", help="Force CPU")
    ap.add_argument(
        "--gaussian",
        type=int,
        default=0,
        metavar="K",
        help="Odd Gaussian kernel (3,5,7); 0=off",
    )
    ap.add_argument(
        "--bilateral-d",
        type=int,
        default=0,
        help="Bilateral diameter (5,7,9); 0=off",
    )
    ap.add_argument("--bilateral-sigma-color", type=float, default=55.0)
    ap.add_argument("--bilateral-sigma-space", type=float, default=55.0)
    ap.add_argument(
        "--temporal",
        type=float,
        default=0.0,
        help="Temporal blend 0..0.9 (reduces flicker); 0=off",
    )
    ap.add_argument(
        "--backend",
        type=str,
        default="AUTO",
        choices=("AUTO", "MSMF", "DSHOW", "DEFAULT"),
        help="Windows: AUTO tries MSMF then DSHOW if grab fails.",
    )
    ap.add_argument(
        "--no-hud",
        action="store_true",
        help="Hide the on-screen processing statistics panel.",
    )
    args = ap.parse_args()

    try:
        cv2.setUseOptimized(True)
    except cv2.error:
        pass

    if args.temporal > 0 and args.motion_from == "processed":
        print(
            "Note: --temporal with --motion-from processed causes visible lag/smear; "
            "prefer --motion-from raw.",
            file=sys.stderr,
        )

    print(f"Python: {sys.executable}")
    print(f"PyTorch {torch.__version__} | cuda.is_available()={torch.cuda.is_available()}")
    dev = pick_device(args.cuda, args.no_cuda)
    if dev.type == "cuda":
        print(f"Using GPU: {torch.cuda.get_device_name(0)}")
    else:
        print(
            "Using CPU. For GPU: pip install torch torchvision "
            "--index-url https://download.pytorch.org/whl/cu124 "
            "(use the same venv as this Python).",
            file=sys.stderr,
        )

    N = args.grid_n
    vs = args.voxel_size
    gc = np.array(args.grid_center, dtype=np.float32)
    half = 0.5 * N * vs
    grid_min_np = gc - half
    grid_max_np = gc + half

    R = rotation_matrix_ypr(args.yaw, args.pitch, args.roll)
    cam_pos = np.array([[args.cam_x, args.cam_y, args.cam_z]], dtype=np.float32)

    try:
        cap, cap_be = open_camera(
            args.device, args.width, args.height, args.backend
        )
    except RuntimeError as e:
        print(e, file=sys.stderr)
        raise SystemExit(1)
    print(f"OpenCV camera backend: {cap_be}")
    hud_backend = cap_be
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except cv2.error:
        pass

    ok0, frm0 = cap.read()
    if ok0 and frm0 is not None and frm0.size > 0:
        h, w = frm0.shape[:2]
        print(f"Camera frame size (actual): {w}x{h}")
    else:
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        print(f"Camera frame size (driver report): {w}x{h}")

    stride_m = max(1, args.motion_stride)
    if stride_m > 1:
        yy, xx = np.mgrid[0:h, 0:w]
        stride_grid = (xx % stride_m == 0) & (yy % stride_m == 0)
        print(
            f"Motion/voxel stride: {stride_m} "
            f"(up to ~{100.0 / (stride_m * stride_m):.0f}% for voxels)"
        )
    else:
        stride_grid = None

    mot_scale = float(min(1.0, max(0.25, args.motion_scale)))
    ws = max(2, int(round(w * mot_scale)))
    hs = max(2, int(round(h * mot_scale)))
    if mot_scale < 0.999:
        print(
            f"Motion pipeline: {ws}x{hs} ({mot_scale:.2f}x) -> upscaled mask"
        )
    min_a_base = args.motion_min_area
    if min_a_base > 0 and mot_scale < 0.999:
        min_a_eff = max(4, int(min_a_base * mot_scale * mot_scale))
    else:
        min_a_eff = min_a_base

    pp_cfg = PreprocessConfig(
        gaussian_ksize=args.gaussian,
        bilateral_d=args.bilateral_d,
        bilateral_sigma_color=args.bilateral_sigma_color,
        bilateral_sigma_space=args.bilateral_sigma_space,
        temporal=args.temporal,
    )
    pp_state = TemporalState()
    fov_rad = deg2rad(args.fov)
    focal = (w * 0.5) / math.tan(fov_rad * 0.5)

    # Precompute pixel dirs in camera space (matches ray_voxel.cpp)
    us = np.arange(w, dtype=np.float32)
    vs_pix = np.arange(h, dtype=np.float32)
    uu, vv = np.meshgrid(us, vs_pix)
    xc = uu - 0.5 * w
    yc = -(vv - 0.5 * h)
    zc = np.full_like(xc, -focal, dtype=np.float32)
    dirs_cam = np.stack([xc, yc, zc], axis=-1)
    ln = np.linalg.norm(dirs_cam, axis=-1, keepdims=True) + 1e-12
    dirs_cam = (dirs_cam / ln).reshape(-1, 3)
    dirs_world = (dirs_cam @ R.T).astype(np.float32)

    gmin_t = torch.tensor(grid_min_np, device=dev, dtype=torch.float32)
    gmax_t = torch.tensor(grid_max_np, device=dev, dtype=torch.float32)
    dirs_t = torch.tensor(dirs_world, device=dev)
    cam_t = torch.tensor(cam_pos, device=dev, dtype=torch.float32)

    voxel_flat = torch.zeros(N * N * N, device=dev, dtype=torch.float32)
    prev_motion_gray: np.ndarray | None = None
    t_lin = torch.linspace(0.0, 1.0, args.ray_steps, device=dev)
    bgs = (
        cv2.createBackgroundSubtractorMOG2(
            history=240, varThreshold=24, detectShadows=False
        )
        if args.foreground
        else None
    )
    if bgs is not None:
        print("MOG2 foreground mask enabled (needs ~1s warmup).")
    if (
        args.motion_diff_median > 0
        or args.motion_open > 0
        or args.motion_min_area > 0
    ):
        print(
            "Motion denoise: "
            f"diff_median={args.motion_diff_median}, "
            f"open={args.motion_open}, min_area={args.motion_min_area}"
        )

    cv2.namedWindow("pavois", cv2.WINDOW_NORMAL)

    fps_t = time.perf_counter()
    frames = 0
    proc_frames = 0
    current_fps = 0.0
    last_right_panel: np.ndarray | None = None
    last_vox_max = 0.0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break

        gray_raw = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
        gray_proc = preprocess_gray(gray_raw, pp_state, pp_cfg)

        if args.motion_from == "processed":
            gray_motion = gray_proc
        else:
            gray_motion = gray_raw
            kb = args.motion_blur
            if kb >= 3 and kb % 2 == 1:
                gray_motion = cv2.GaussianBlur(gray_motion, (kb, kb), 0)

        if prev_motion_gray is None:
            prev_motion_gray = gray_motion.copy()
            continue

        proc_frames += 1
        if mot_scale < 0.999:
            cur_s = cv2.resize(
                gray_motion, (ws, hs), interpolation=cv2.INTER_AREA
            )
            prev_s = cv2.resize(
                prev_motion_gray, (ws, hs), interpolation=cv2.INTER_AREA
            )
            diff = np.abs(cur_s - prev_s)
        else:
            diff = np.abs(gray_motion - prev_motion_gray)
        prev_motion_gray = gray_motion.copy()

        kmed = args.motion_diff_median
        if kmed >= 3 and kmed % 2 == 1:
            d8 = np.clip(diff, 0.0, 255.0).astype(np.uint8)
            d8 = cv2.medianBlur(d8, kmed)
            diff = d8.astype(np.float32)

        motion = diff > args.motion
        if args.motion_votes > 0:
            m = motion.astype(np.float32)
            sup = cv2.filter2D(m, ddepth=-1, kernel=np.ones((3, 3), dtype=np.float32))
            # AND: never turn on pixels that failed threshold; only thin speckle.
            motion = motion & (sup >= float(args.motion_votes))
        if bgs is not None:
            fg = bgs.apply(bgr)
            fg_bin = (fg > args.foreground_thresh).astype(np.uint8) * 255
            if mot_scale < 0.999:
                fg_bin = cv2.resize(
                    fg_bin, (ws, hs), interpolation=cv2.INTER_NEAREST
                )
            motion = motion | (fg_bin > 127)

        if args.motion_open > 0:
            mo = motion.astype(np.uint8) * 255
            k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            for _ in range(args.motion_open):
                mo = cv2.morphologyEx(mo, cv2.MORPH_OPEN, k3)
            motion = mo > 127

        if args.motion_close > 0:
            mc = motion.astype(np.uint8) * 255
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            for _ in range(args.motion_close):
                mc = cv2.morphologyEx(mc, cv2.MORPH_CLOSE, k)
            motion = mc > 127

        if min_a_eff > 0:
            mb = motion.astype(np.uint8) * 255
            n, labels, stats, _ = cv2.connectedComponentsWithStats(
                mb, connectivity=8
            )
            keep = np.zeros_like(mb)
            for i in range(1, n):
                if stats[i, cv2.CC_STAT_AREA] >= min_a_eff:
                    keep[labels == i] = 255
            motion = keep > 127

        if mot_scale < 0.999:
            motion = (
                cv2.resize(
                    motion.astype(np.uint8) * 255,
                    (w, h),
                    interpolation=cv2.INTER_NEAREST,
                )
                > 127
            )
            diff_w = cv2.resize(
                diff, (w, h), interpolation=cv2.INTER_LINEAR
            ).astype(np.float32)
        else:
            diff_w = diff

        if stride_grid is not None:
            mask = motion & stride_grid
        else:
            mask = motion
        cand_n = int(np.count_nonzero(mask))
        idx_m = np.flatnonzero(mask.ravel())
        subsampled = idx_m.size > args.max_rays
        if subsampled:
            sel = np.random.choice(idx_m.size, args.max_rays, replace=False)
            idx_m = idx_m[sel]
        rays_after_aabb = 0
        scatter_samples = 0
        voxel_flat *= args.decay

        wht = (255, 255, 255)
        red = (0, 0, 255)
        mf = args.motion_fill
        if args.preview_motion_only:
            overlay = np.zeros_like(bgr)
            if mf == "camera":
                overlay[motion] = bgr[motion]
            elif mf == "red":
                overlay[motion] = red
            else:
                overlay[motion] = wht
        else:
            overlay = bgr.copy()
            if mf == "camera":
                pass
            elif mf == "red":
                overlay[motion] = red
            else:
                overlay[motion] = wht

        if idx_m.size > 0:
            d_sel = dirs_t[idx_m]
            o_sel = cam_t.expand(d_sel.shape[0], -1)
            t0, t1, ok_ray = ray_aabb_t_batch(o_sel, d_sel, gmin_t, gmax_t)
            if ok_ray.any():
                diff_np = diff_w.ravel()[idx_m]
                diff_vals = torch.tensor(
                    diff_np[ok_ray.cpu().numpy()],
                    device=dev,
                    dtype=torch.float32,
                )
                o_sel = o_sel[ok_ray]
                d_sel = d_sel[ok_ray]
                t0, t1 = t0[ok_ray], t1[ok_ray]
                tt = t0[:, None] + t_lin[None, :] * (t1 - t0)[:, None]
                pts = o_sel[:, None, :] + tt[:, :, None] * d_sel[:, None, :]
                ix = ((pts[..., 0] - gmin_t[0]) / vs).long()
                iy = ((pts[..., 1] - gmin_t[1]) / vs).long()
                iz = ((pts[..., 2] - gmin_t[2]) / vs).long()
                inside = (
                    (ix >= 0)
                    & (ix < N)
                    & (iy >= 0)
                    & (iy < N)
                    & (iz >= 0)
                    & (iz < N)
                )
                flat = ix * (N * N) + iy * N + iz
                wgt = diff_vals[:, None].expand(-1, args.ray_steps).clone()
                wgt[~inside] = 0.0
                flat_f = flat.reshape(-1)
                wgt_f = wgt.reshape(-1)
                m = wgt_f > 0
                rays_after_aabb = int(ok_ray.sum().item())
                scatter_samples = int(m.sum().item())
                voxel_flat.scatter_add_(0, flat_f[m].long(), wgt_f[m])

        if proc_frames <= 1 or proc_frames % max(1, args.hud_vox_interval) == 0:
            last_vox_max = float(voxel_flat.max().item())
        vox_max = last_vox_max
        diff_max = float(np.max(diff_w))
        motion_px = int(np.count_nonzero(motion))

        if (
            proc_frames % max(1, args.voxel_viz_every) == 0
            or last_right_panel is None
        ):
            with torch.inference_mode():
                g3 = voxel_flat.view(N, N, N)
                xy = g3.max(dim=2).values
                xz = g3.max(dim=1).values
                yz = g3.max(dim=0).values

            def to_bgr(proj: torch.Tensor) -> np.ndarray:
                t = proj.detach().float().cpu().numpy()
                if t.max() <= 1e-6:
                    return np.zeros((*t.shape, 3), dtype=np.uint8)
                t = (t / (t.max() + 1e-6) * 255.0).clip(0, 255).astype(np.uint8)
                return cv2.applyColorMap(t, cv2.COLORMAP_INFERNO)

            pxy = to_bgr(xy)
            pxz = cv2.resize(to_bgr(xz), (pxy.shape[1], pxy.shape[0]))
            pyz = cv2.resize(to_bgr(yz), (pxy.shape[1], pxy.shape[0]))
            top = np.hstack([pxy, pxz])
            pyz_wide = cv2.resize(pyz, (top.shape[1], pyz.shape[0]))
            right = np.vstack([top, pyz_wide])

            rh, rw = right.shape[:2]
            tgt_w = max(bgr.shape[1], 320)
            scale = min(tgt_w / rw, bgr.shape[0] / rh, 2.0)
            right = cv2.resize(
                right,
                (int(rw * scale), int(rh * scale)),
                interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR,
            )
            pad_h = max(overlay.shape[0] - right.shape[0], 0)
            if pad_h > 0:
                right = cv2.copyMakeBorder(
                    right, 0, pad_h, 0, 0, cv2.BORDER_CONSTANT, value=0
                )
            last_right_panel = right
        else:
            right = last_right_panel

        combo = np.hstack([overlay, right])

        frames += 1
        if frames % 15 == 0:
            dt = time.perf_counter() - fps_t
            current_fps = 15.0 / dt if dt > 0 else 0.0
            fps_t = time.perf_counter()
            cv2.setWindowTitle(
                "pavois",
                f"pavois | {current_fps:.1f} fps | {dev.type} | f{proc_frames}",
            )

        if not args.no_hud:
            cap_txt = "cuda" if dev.type == "cuda" else "cpu"
            sub_txt = f"cap@{args.max_rays}" if subsampled else "no_cap"
            hud_lines = [
                f"frame {proc_frames}  |  fps {current_fps:5.1f}  |  {w}x{h}",
                f"motion px {motion_px}  |  cand {cand_n}  |  "
                f"rays {idx_m.size} ({sub_txt})",
                f"voxel RaysOK {rays_after_aabb}  |  "
                f"scatter {scatter_samples}  |  vox_max {vox_max:.1f}",
                f"diff_max {diff_max:.1f}  thr {args.motion}  |  "
                f"decay {args.decay}  stride {args.motion_stride}",
                f"motion {args.motion_from}  fill {args.motion_fill}  "
                f"med {args.motion_diff_median} open {args.motion_open} "
                f"votes {args.motion_votes}  minA {args.motion_min_area}",
                f"grid N={N} vox={vs}m  steps={args.ray_steps}  "
                f"{cap_txt}  {hud_backend}",
                f"perf mot_scale={mot_scale}  viz/{args.voxel_viz_every}f  "
                f"max_rays={args.max_rays}",
            ]
            if args.gaussian or args.bilateral_d or args.temporal > 0:
                hud_lines.append(
                    f"preproc gauss={args.gaussian} bilat_d={args.bilateral_d} "
                    f"temp={args.temporal}"
                )
            if args.foreground:
                hud_lines.append(f"MOG2 fg on  thr {args.foreground_thresh}")
            if args.motion_close > 0:
                hud_lines.append(f"close_iter {args.motion_close}")
            draw_stats_hud(combo, hud_lines)

        cv2.imshow("pavois", combo)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
