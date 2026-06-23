#!/usr/bin/env python3
"""
Realtime multi-camera motion-to-voxel preview.

This is the two-or-more camera version of realtime_voxel_preview.py. Each
camera/phone contributes moving-pixel rays into one shared voxel grid; where
multiple cameras see the same moving object, the rays accumulate into a
brighter 3D cluster.

DroidCam examples:
  python realtime_multi_voxel_preview.py ^
    --camera name=left,source=http://192.168.1.10:4747/video,x=0,y=0,z=1.5,yaw=0,pitch=90,roll=0,fov=60 ^
    --camera name=right,source=http://192.168.1.11:4747/video,x=2,y=0,z=1.5,yaw=0,pitch=90,roll=0,fov=60

Use --self-test to validate the triangulation path without cameras.
"""

from __future__ import annotations

import argparse
import math
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

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
from realtime_voxel_preview import (
    draw_stats_hud,
    ray_aabb_t_batch,
    rotation_matrix_ypr,
)


@dataclass
class CameraConfig:
    name: str
    source: str
    x: float
    y: float
    z: float
    yaw: float
    pitch: float
    roll: float
    fov: float


@dataclass
class CameraRuntime:
    cfg: CameraConfig
    cap: "ThreadedCapture | None" = None
    pp_state: TemporalState = field(default_factory=TemporalState)
    prev_motion_gray: np.ndarray | None = None
    bgs: Any | None = None
    width: int = 0
    height: int = 0
    dirs_t: torch.Tensor | None = None
    cam_t: torch.Tensor | None = None
    last_overlay: np.ndarray | None = None
    last_motion: np.ndarray | None = None
    motion_px: int = 0
    cand_px: int = 0
    rays_px: int = 0
    rays_ok: int = 0
    scatter_samples: int = 0
    is_live: bool = False


class ThreadedCapture:
    def __init__(
        self,
        source: str,
        width: int,
        height: int,
        local_backend: str,
        url_backend: str,
    ) -> None:
        self.source = source
        self.width = width
        self.height = height
        self.local_backend = local_backend
        self.url_backend = url_backend
        self.lock = threading.Lock()
        self.frame: np.ndarray | None = None
        self.timestamp = 0.0
        self.ok_count = 0
        self.fail_count = 0
        self.eof = False
        self.last_error = ""
        self.stop_event = threading.Event()
        self.backend_label = ""
        self._ffmpeg_proc: subprocess.Popen[bytes] | None = None
        self._cap = self._open()
        self.thread = threading.Thread(target=self._read_loop, daemon=True)
        self.thread.start()

    def _source_value(self) -> int | str:
        s = self.source.strip()
        return int(s) if s.isdigit() else s

    def _open(self) -> cv2.VideoCapture:
        src = self._source_value()
        if isinstance(src, int):
            cap, label = open_camera(src, self.width, self.height, self.local_backend)
            self.backend_label = label
            return cap

        if str(src).lower().startswith("dshow:"):
            dshow_name = str(src).split(":", 1)[1]
            cap = cv2.VideoCapture(f"video={dshow_name}", cv2.CAP_DSHOW)
            if not cap.isOpened():
                raise RuntimeError(
                    f"Could not open DirectShow device name {dshow_name!r}"
                )
            self.backend_label = f"DSHOW:{dshow_name}"
            return cap

        if str(src).lower().startswith("ffmpeg-dshow:"):
            dshow_name = str(src).split(":", 1)[1]
            ffmpeg = shutil.which("ffmpeg")
            if ffmpeg is None:
                raise RuntimeError(
                    "ffmpeg not found on PATH; install ffmpeg or use numeric camera indexes."
                )
            cmd = [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "dshow",
                "-video_size",
                f"{self.width}x{self.height}",
                "-i",
                f"video={dshow_name}",
                "-an",
                "-pix_fmt",
                "bgr24",
                "-f",
                "rawvideo",
                "pipe:1",
            ]
            self._ffmpeg_proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE
            )
            self.backend_label = f"FFMPEG-DSHOW:{dshow_name}"
            return cv2.VideoCapture()

        backend_names = (
            ["FFMPEG", "DEFAULT"]
            if self.url_backend.upper() == "FFMPEG"
            else ["DEFAULT", "FFMPEG"]
        )
        cap = None
        label = ""
        tried: list[str] = []
        for candidate_url in discover_video_urls(str(src)):
            tried.append(candidate_url)
            for backend_name in backend_names:
                api = cv2.CAP_FFMPEG if backend_name == "FFMPEG" else 0
                candidate = (
                    cv2.VideoCapture(candidate_url, api)
                    if api
                    else cv2.VideoCapture(candidate_url)
                )
                if candidate.isOpened():
                    cap = candidate
                    label = f"{backend_name}:{candidate_url}"
                    break
                candidate.release()
            if cap is not None:
                break
        if cap is None:
            http_hint = probe_http_hint(str(src))
            raise RuntimeError(
                f"Could not open video source {self.source!r}. "
                f"Tried: {tried}. {http_hint}"
            )
        if self.width > 0:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        if self.height > 0:
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except cv2.error:
            pass
        self.backend_label = label
        return cap

    def _read_loop(self) -> None:
        if self._ffmpeg_proc is not None:
            self._read_ffmpeg_loop()
            return

        while not self.stop_event.is_set():
            ok, frame = self._cap.read()
            if ok and frame is not None and getattr(frame, "size", 0) > 0:
                with self.lock:
                    self.frame = frame
                    self.timestamp = time.perf_counter()
                    self.ok_count += 1
            else:
                self.fail_count += 1
                time.sleep(0.02)

    def _read_ffmpeg_loop(self) -> None:
        assert self._ffmpeg_proc is not None
        assert self._ffmpeg_proc.stdout is not None
        frame_bytes = self.width * self.height * 3
        while not self.stop_event.is_set():
            data = self._ffmpeg_proc.stdout.read(frame_bytes)
            if len(data) != frame_bytes:
                self.fail_count += 1
                time.sleep(0.02)
                if self._ffmpeg_proc.poll() is not None:
                    self.eof = True
                    self.last_error = self._ffmpeg_stderr_tail()
                    break
                continue
            frame = np.frombuffer(data, dtype=np.uint8).reshape(
                (self.height, self.width, 3)
            )
            with self.lock:
                self.frame = frame.copy()
                self.timestamp = time.perf_counter()
                self.ok_count += 1

    def latest(self) -> tuple[np.ndarray | None, float]:
        with self.lock:
            if self.frame is None:
                return None, 0.0
            return self.frame.copy(), self.timestamp

    def close(self) -> None:
        self.stop_event.set()
        self.thread.join(timeout=1.0)
        if self._ffmpeg_proc is not None:
            self._ffmpeg_proc.terminate()
            try:
                self._ffmpeg_proc.wait(timeout=1.0)
            except subprocess.TimeoutExpired:
                self._ffmpeg_proc.kill()
        else:
            self._cap.release()

    def _ffmpeg_stderr_tail(self) -> str:
        if self._ffmpeg_proc is None or self._ffmpeg_proc.stderr is None:
            return ""
        try:
            data = self._ffmpeg_proc.stderr.read()
        except Exception:
            return ""
        text = data.decode("utf-8", errors="replace")
        lines = [line for line in text.splitlines() if line.strip()]
        return "\n".join(lines[-20:])

    def status_text(self) -> str:
        if self._ffmpeg_proc is not None and self._ffmpeg_proc.poll() is not None:
            err = self.last_error or self._ffmpeg_stderr_tail()
            return f"ffmpeg exited code={self._ffmpeg_proc.returncode}\n{err}"
        return f"frames={self.ok_count} fails={self.fail_count}"

    def wait_for_first_frame(self, timeout_s: float) -> bool:
        deadline = time.perf_counter() + timeout_s
        while time.perf_counter() < deadline:
            frame, _ = self.latest()
            if frame is not None:
                return True
            if self.eof:
                return False
            time.sleep(0.05)
        return False


class _MediaLinkParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__()
        self.base_url = base_url
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {k.lower(): v for k, v in attrs if v}
        for key in ("src", "href", "data-src"):
            val = attr_map.get(key)
            if val:
                self.links.append(urljoin(self.base_url, val))


def _root_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, "", "", ""))


def discover_video_urls(url: str) -> list[str]:
    if not url.lower().startswith(("http://", "https://")):
        return [url]

    root = _root_url(url)
    urls = [
        url,
        root + "/video",
        root + "/video/640x480",
        root + "/video/1280x720",
        root + "/video/1920x1080",
        root + "/videofeed",
        root + "/mjpegfeed",
        root + "/mjpegfeed?640x480",
        root + "/shot.jpg",
    ]
    for page_url in (url, root):
        try:
            req = urllib.request.Request(
                page_url, headers={"User-Agent": "pavois-opencv-discover"}
            )
            with urllib.request.urlopen(req, timeout=2) as resp:
                ctype = resp.headers.get("Content-Type", "")
                if "html" not in ctype.lower():
                    continue
                html = resp.read(200_000).decode("utf-8", errors="replace")
            parser = _MediaLinkParser(page_url)
            parser.feed(html)
            urls.extend(parser.links)
        except Exception:
            pass

    seen: set[str] = set()
    out: list[str] = []
    for item in urls:
        clean = re.sub(r"\s+", "", item)
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    return out


def probe_http_hint(url: str) -> str:
    if not url.lower().startswith(("http://", "https://")):
        return ""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pavois-opencv-probe"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            content_type = resp.headers.get("Content-Type", "unknown")
            return (
                f"HTTP is reachable, status={resp.status}, "
                f"content-type={content_type!r}; OpenCV could not decode it. "
                "Try --url-backend FFMPEG or check the DroidCam video endpoint."
            )
    except Exception as exc:
        return (
            f"HTTP probe also failed ({type(exc).__name__}: {exc}). "
            "Check that the phone and PC are on the same network and that the URL "
            "opens in a browser."
        )


def parse_camera_spec(spec: str, index: int) -> CameraConfig:
    values: dict[str, str] = {}
    for part in spec.split(","):
        if not part.strip():
            continue
        if "=" not in part:
            raise ValueError(
                f"Invalid --camera segment {part!r}; use key=value pairs."
            )
        k, v = part.split("=", 1)
        values[k.strip().lower()] = v.strip()

    def f(key: str, default: float) -> float:
        return float(values.get(key, default))

    if "source" not in values:
        raise ValueError("--camera requires source=... (index or DroidCam URL)")

    return CameraConfig(
        name=values.get("name", f"cam{index}"),
        source=re.sub(r"\s+", "", values["source"]),
        x=f("x", float(index) * 2.0),
        y=f("y", 0.0),
        z=f("z", 1.5),
        yaw=f("yaw", 0.0),
        pitch=f("pitch", 90.0),
        roll=f("roll", 0.0),
        fov=f("fov", 60.0),
    )


def pick_device(no_cuda: bool) -> torch.device:
    if torch.cuda.is_available() and not no_cuda:
        return torch.device("cuda")
    return torch.device("cpu")


def build_dirs_for_camera(
    cfg: CameraConfig,
    width: int,
    height: int,
    dev: torch.device,
) -> tuple[torch.Tensor, torch.Tensor]:
    fov_rad = math.radians(cfg.fov)
    focal = (width * 0.5) / math.tan(fov_rad * 0.5)
    us = np.arange(width, dtype=np.float32)
    vs = np.arange(height, dtype=np.float32)
    uu, vv = np.meshgrid(us, vs)
    xc = uu - 0.5 * width
    yc = -(vv - 0.5 * height)
    zc = np.full_like(xc, -focal, dtype=np.float32)
    dirs_cam = np.stack([xc, yc, zc], axis=-1)
    dirs_cam /= np.linalg.norm(dirs_cam, axis=-1, keepdims=True) + 1e-12
    R = rotation_matrix_ypr(cfg.yaw, cfg.pitch, cfg.roll)
    dirs_world = (dirs_cam.reshape(-1, 3) @ R.T).astype(np.float32)
    dirs_t = torch.tensor(dirs_world, device=dev)
    cam_t = torch.tensor([[cfg.x, cfg.y, cfg.z]], device=dev, dtype=torch.float32)
    return dirs_t, cam_t


def motion_mask_for_frame(
    cam: CameraRuntime,
    bgr: np.ndarray,
    args: argparse.Namespace,
    pp_cfg: PreprocessConfig,
) -> tuple[np.ndarray | None, np.ndarray | None, np.ndarray]:
    gray_raw = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gray_proc = preprocess_gray(gray_raw, cam.pp_state, pp_cfg)
    if args.motion_from == "processed":
        gray_motion = gray_proc
    else:
        gray_motion = gray_raw
        if args.motion_blur >= 3 and args.motion_blur % 2 == 1:
            gray_motion = cv2.GaussianBlur(
                gray_motion, (args.motion_blur, args.motion_blur), 0
            )

    if cam.prev_motion_gray is None:
        cam.prev_motion_gray = gray_motion.copy()
        return None, None, bgr.copy()

    h, w = gray_motion.shape[:2]
    mot_scale = float(min(1.0, max(0.25, args.motion_scale)))
    if mot_scale < 0.999:
        ws = max(2, int(round(w * mot_scale)))
        hs = max(2, int(round(h * mot_scale)))
        cur_s = cv2.resize(gray_motion, (ws, hs), interpolation=cv2.INTER_AREA)
        prev_s = cv2.resize(
            cam.prev_motion_gray, (ws, hs), interpolation=cv2.INTER_AREA
        )
        diff = np.abs(cur_s - prev_s)
    else:
        diff = np.abs(gray_motion - cam.prev_motion_gray)
    cam.prev_motion_gray = gray_motion.copy()

    if args.motion_diff_median >= 3 and args.motion_diff_median % 2 == 1:
        d8 = np.clip(diff, 0.0, 255.0).astype(np.uint8)
        diff = cv2.medianBlur(d8, args.motion_diff_median).astype(np.float32)

    motion = diff > args.motion
    if args.motion_votes > 0:
        support = cv2.filter2D(
            motion.astype(np.float32),
            ddepth=-1,
            kernel=np.ones((3, 3), dtype=np.float32),
        )
        motion = motion & (support >= float(args.motion_votes))

    if cam.bgs is not None:
        fg = cam.bgs.apply(bgr)
        fg_bin = (fg > args.foreground_thresh).astype(np.uint8) * 255
        if mot_scale < 0.999:
            fg_bin = cv2.resize(
                fg_bin, (motion.shape[1], motion.shape[0]), interpolation=cv2.INTER_NEAREST
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
        k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        for _ in range(args.motion_close):
            mc = cv2.morphologyEx(mc, cv2.MORPH_CLOSE, k5)
        motion = mc > 127

    min_area = args.motion_min_area
    if min_area > 0 and mot_scale < 0.999:
        min_area = max(4, int(min_area * mot_scale * mot_scale))
    if min_area > 0:
        mb = motion.astype(np.uint8) * 255
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mb, connectivity=8)
        keep = np.zeros_like(mb)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] >= min_area:
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
        diff_w = cv2.resize(diff, (w, h), interpolation=cv2.INTER_LINEAR).astype(
            np.float32
        )
    else:
        diff_w = diff

    overlay = bgr.copy()
    overlay[motion] = (255, 255, 255)
    return motion, diff_w, overlay


def scatter_camera_motion(
    cam: CameraRuntime,
    motion: np.ndarray,
    diff_w: np.ndarray,
    voxel_flat: torch.Tensor,
    support_flat: torch.Tensor | None,
    gmin_t: torch.Tensor,
    gmax_t: torch.Tensor,
    voxel_size: float,
    grid_n: int,
    ray_steps: int,
    max_rays_per_camera: int,
    motion_stride: int,
    rng: np.random.Generator,
) -> None:
    cam.motion_px = int(np.count_nonzero(motion))
    if motion_stride > 1:
        h, w = motion.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        mask = motion & (xx % motion_stride == 0) & (yy % motion_stride == 0)
    else:
        mask = motion

    idx = np.flatnonzero(mask.ravel())
    cam.cand_px = int(idx.size)
    if idx.size > max_rays_per_camera:
        idx = rng.choice(idx, max_rays_per_camera, replace=False)
    cam.rays_px = int(idx.size)
    cam.rays_ok = 0
    cam.scatter_samples = 0
    if idx.size == 0 or cam.dirs_t is None or cam.cam_t is None:
        return

    d_sel = cam.dirs_t[idx]
    o_sel = cam.cam_t.expand(d_sel.shape[0], -1)
    t0, t1, ok_ray = ray_aabb_t_batch(o_sel, d_sel, gmin_t, gmax_t)
    if not ok_ray.any():
        return

    diff_vals = torch.tensor(
        diff_w.ravel()[idx][ok_ray.detach().cpu().numpy()],
        device=voxel_flat.device,
        dtype=torch.float32,
    )
    o_sel = o_sel[ok_ray]
    d_sel = d_sel[ok_ray]
    t0 = t0[ok_ray]
    t1 = t1[ok_ray]
    t_lin = torch.linspace(0.0, 1.0, ray_steps, device=voxel_flat.device)
    tt = t0[:, None] + t_lin[None, :] * (t1 - t0)[:, None]
    pts = o_sel[:, None, :] + tt[:, :, None] * d_sel[:, None, :]
    ix = ((pts[..., 0] - gmin_t[0]) / voxel_size).long()
    iy = ((pts[..., 1] - gmin_t[1]) / voxel_size).long()
    iz = ((pts[..., 2] - gmin_t[2]) / voxel_size).long()
    inside = (
        (ix >= 0)
        & (ix < grid_n)
        & (iy >= 0)
        & (iy < grid_n)
        & (iz >= 0)
        & (iz < grid_n)
    )
    flat = ix * (grid_n * grid_n) + iy * grid_n + iz
    weights = diff_vals[:, None].expand(-1, ray_steps).clone()
    weights[~inside] = 0.0
    flat_f = flat.reshape(-1)
    weights_f = weights.reshape(-1)
    keep = weights_f > 0
    cam.rays_ok = int(ok_ray.sum().item())
    cam.scatter_samples = int(keep.sum().item())
    hit_voxels = flat_f[keep].long()
    voxel_flat.scatter_add_(0, hit_voxels, weights_f[keep])
    if support_flat is not None and hit_voxels.numel() > 0:
        # Count each camera at most once per voxel for this frame. This is the
        # actual multi-camera agreement signal; duplicate rays from one camera
        # should not masquerade as stereo support.
        support_flat[torch.unique(hit_voxels)] += 1


def voxel_panel(voxel_flat: torch.Tensor, grid_n: int) -> np.ndarray:
    with torch.inference_mode():
        g3 = voxel_flat.view(grid_n, grid_n, grid_n)
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
    return np.vstack([np.hstack([pxy, pxz]), cv2.resize(pyz, (pxy.shape[1] * 2, pxy.shape[0]))])


def voxel_points_3d_panel(
    values_flat: torch.Tensor,
    grid_n: int,
    title: str,
    width: int,
    height: int,
    yaw_deg: float,
    pitch_deg: float,
    max_points: int,
    min_value: float,
    binary: bool = False,
) -> np.ndarray:
    img = np.zeros((height, width, 3), dtype=np.uint8)
    with torch.inference_mode():
        values = values_flat.detach()
        if binary:
            idx = torch.nonzero(values >= min_value, as_tuple=False).flatten()
            point_values = torch.ones_like(idx, dtype=torch.float32)
        else:
            vmax = float(values.max().item())
            if vmax <= 1e-6:
                idx = torch.empty(0, device=values.device, dtype=torch.long)
                point_values = torch.empty(0, device=values.device, dtype=torch.float32)
            else:
                thresh = max(float(min_value), vmax * 0.08)
                idx = torch.nonzero(values >= thresh, as_tuple=False).flatten()
                point_values = values[idx].float()

        if idx.numel() > max_points:
            if binary:
                pick = torch.linspace(
                    0,
                    idx.numel() - 1,
                    max_points,
                    device=idx.device,
                ).long()
            else:
                _, pick = torch.topk(point_values, max_points)
            idx = idx[pick]
            point_values = point_values[pick]

        if idx.numel() == 0:
            cv2.putText(
                img,
                f"{title}: no active voxels",
                (14, 28),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (210, 210, 210),
                1,
                cv2.LINE_AA,
            )
            return img

        ix = (idx // (grid_n * grid_n)).float()
        iy = ((idx // grid_n) % grid_n).float()
        iz = (idx % grid_n).float()
        pts = torch.stack(
            [
                (ix / max(1, grid_n - 1)) * 2.0 - 1.0,
                (iy / max(1, grid_n - 1)) * 2.0 - 1.0,
                (iz / max(1, grid_n - 1)) * 2.0 - 1.0,
            ],
            dim=1,
        ).detach().cpu().numpy()
        vals = point_values.detach().cpu().numpy().astype(np.float32)

    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    rz = np.array([[cy, -sy, 0.0], [sy, cy, 0.0], [0.0, 0.0, 1.0]], dtype=np.float32)
    rx = np.array([[1.0, 0.0, 0.0], [0.0, cp, -sp], [0.0, sp, cp]], dtype=np.float32)
    rot = rz @ rx
    p = pts @ rot.T
    depth = p[:, 1] + 3.0
    perspective = 1.6 / np.maximum(0.6, depth)
    sx = (p[:, 0] * perspective * 0.42 + 0.5) * width
    sy2 = (0.5 - p[:, 2] * perspective * 0.42) * height
    order = np.argsort(depth)[::-1]
    if vals.size and vals.max() > 1e-6:
        norm = vals / (vals.max() + 1e-6)
    else:
        norm = np.ones_like(vals)

    for i in order:
        x = int(round(sx[i]))
        y = int(round(sy2[i]))
        if x < 0 or x >= width or y < 0 or y >= height:
            continue
        intensity = int(80 + 175 * float(norm[i]))
        depth_tint = int(np.clip((p[i, 1] + 1.4) / 2.8 * 120, 0, 120))
        color = (depth_tint, intensity, 255) if binary else (20, intensity, 255)
        cv2.circle(img, (x, y), 2, color, -1, lineType=cv2.LINE_AA)

    # Draw a simple bounding cube for orientation.
    corners = np.array(
        [[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)],
        dtype=np.float32,
    )
    pc = corners @ rot.T
    dc = pc[:, 1] + 3.0
    sc = 1.6 / np.maximum(0.6, dc)
    cx = (pc[:, 0] * sc * 0.42 + 0.5) * width
    cy2 = (0.5 - pc[:, 2] * sc * 0.42) * height
    edges = [
        (0, 1), (0, 2), (0, 4), (3, 1), (3, 2), (3, 7),
        (5, 1), (5, 4), (5, 7), (6, 2), (6, 4), (6, 7),
    ]
    for a, b in edges:
        cv2.line(
            img,
            (int(cx[a]), int(cy2[a])),
            (int(cx[b]), int(cy2[b])),
            (70, 70, 70),
            1,
            cv2.LINE_AA,
        )

    cv2.putText(
        img,
        f"{title}: {len(order)} voxels",
        (14, 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (240, 240, 240),
        1,
        cv2.LINE_AA,
    )
    return img


def shared_voxel_panel(
    support_flat: torch.Tensor,
    grid_n: int,
    min_support: int,
    view_mode: str,
    width: int,
    height: int,
    yaw: float,
    pitch: float,
    max_points: int,
) -> np.ndarray:
    if view_mode == "3d":
        return voxel_points_3d_panel(
            support_flat,
            grid_n,
            "shared 3d",
            width,
            height,
            yaw,
            pitch,
            max_points,
            float(min_support),
            binary=True,
        )

    with torch.inference_mode():
        mask = support_flat.view(grid_n, grid_n, grid_n) >= min_support
        xy = mask.any(dim=2).detach().cpu().numpy().astype(np.uint8) * 255
        xz = mask.any(dim=1).detach().cpu().numpy().astype(np.uint8) * 255
        yz = mask.any(dim=0).detach().cpu().numpy().astype(np.uint8) * 255

    pxy = cv2.cvtColor(xy, cv2.COLOR_GRAY2BGR)
    pxz = cv2.cvtColor(xz, cv2.COLOR_GRAY2BGR)
    pyz = cv2.cvtColor(yz, cv2.COLOR_GRAY2BGR)
    pxz = cv2.resize(pxz, (pxy.shape[1], pxy.shape[0]), interpolation=cv2.INTER_NEAREST)
    pyz = cv2.resize(pyz, (pxy.shape[1], pxy.shape[0]), interpolation=cv2.INTER_NEAREST)
    out = np.vstack([np.hstack([pxy, pxz]), cv2.resize(pyz, (pxy.shape[1] * 2, pxy.shape[0]), interpolation=cv2.INTER_NEAREST)])
    count = int((support_flat >= min_support).sum().item())
    cv2.putText(
        out,
        f"shared voxels  count {count}  support>={min_support}",
        (8, 24),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.45,
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )
    return out


# ---------------------------------------------------------------------------
# Debug dashboard (dark theme) + enriched 3D scene (point + camera rays).
# All BGR colors (OpenCV order).
# ---------------------------------------------------------------------------
FONT = cv2.FONT_HERSHEY_SIMPLEX
COL_BG = (22, 19, 17)        # near-black background
COL_PANEL = (40, 35, 31)     # card background
COL_PANEL_HI = (54, 47, 41)  # header / lighter card
COL_TEXT = (235, 235, 235)
COL_MUTED = (150, 150, 150)
COL_ACCENT = (210, 180, 70)  # teal accent
COL_OK = (90, 210, 110)      # green
COL_WARN = (60, 165, 245)    # orange
COL_BAD = (70, 70, 235)      # red
COL_RAY = (120, 230, 255)    # bright camera rays
COL_OBJECT = (90, 110, 255)  # detected object marker

# Crisp anti-aliased text via Pillow. OpenCV's Hershey font looks pixelated,
# especially once the window is scaled; Pillow draws real TrueType glyphs.
# Falls back to cv2.putText if Pillow is unavailable.
try:
    from PIL import Image as _PILImage, ImageDraw as _PILDraw, ImageFont as _PILFont
    _HAS_PIL = True
except Exception:
    _HAS_PIL = False

_FONT_REGULAR = [
    r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
_FONT_BOLD = [
    r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]
_FONT_CACHE: dict = {}


def _font(size: int, bold: bool):
    key = (size, bold)
    f = _FONT_CACHE.get(key)
    if f is None and _HAS_PIL:
        for path in (_FONT_BOLD if bold else _FONT_REGULAR):
            try:
                f = _PILFont.truetype(path, size)
                break
            except Exception:
                continue
        if f is None:
            f = _PILFont.load_default()
        _FONT_CACHE[key] = f
    return f


@dataclass
class Detection:
    detected: bool
    world: tuple[float, float, float] | None
    n_agree: int
    count: int
    confidence: float
    tentative: bool


@dataclass
class View3DState:
    yaw: float
    pitch: float
    last_x: int = 0
    last_y: int = 0
    dragging: bool = False


def make_mouse_handler(state: View3DState):
    """Drag with the left button to orbit the 3D scene."""

    def on_mouse(event: int, x: int, y: int, flags: int, _param: Any) -> None:
        if event == cv2.EVENT_LBUTTONDOWN:
            state.dragging = True
            state.last_x, state.last_y = x, y
        elif event == cv2.EVENT_MOUSEMOVE and state.dragging:
            state.yaw += (x - state.last_x) * 0.5
            state.pitch = float(
                np.clip(state.pitch + (y - state.last_y) * 0.3, -89.0, 89.0)
            )
            state.last_x, state.last_y = x, y
        elif event == cv2.EVENT_LBUTTONUP:
            state.dragging = False

    return on_mouse


def project_norm(
    norm_xyz: np.ndarray, yaw_deg: float, pitch_deg: float, width: int, height: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Project points in the normalized [-1,1] grid cube to screen pixels.

    Same weak-perspective camera for voxels, cameras and the detected point so
    everything lines up in one view.
    """
    pts = np.asarray(norm_xyz, dtype=np.float32).reshape(-1, 3)
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)
    rz = np.array([[cy, -sy, 0.0], [sy, cy, 0.0], [0.0, 0.0, 1.0]], dtype=np.float32)
    rx = np.array([[1.0, 0.0, 0.0], [0.0, cp, -sp], [0.0, sp, cp]], dtype=np.float32)
    rot = rz @ rx
    p = pts @ rot.T
    depth = p[:, 1] + 3.0
    perspective = 1.6 / np.maximum(0.6, depth)
    sx = (p[:, 0] * perspective * 0.42 + 0.5) * width
    sy2 = (0.5 - p[:, 2] * perspective * 0.42) * height
    return sx, sy2, depth


def compute_detection(
    support_flat: torch.Tensor,
    voxel_flat: torch.Tensor,
    grid_n: int,
    gmin_np: np.ndarray,
    voxel_size: float,
    min_cameras: int,
) -> Detection:
    """Reduce the lit voxels to a single object position (intensity-weighted centroid)."""
    with torch.inference_mode():
        support = support_flat.reshape(-1)
        idx = torch.nonzero(support >= min_cameras, as_tuple=False).flatten()
        tentative = False
        if idx.numel() == 0:
            vmax = float(voxel_flat.max().item())
            if vmax <= 1e-6:
                return Detection(False, None, 0, 0, 0.0, False)
            top = torch.topk(voxel_flat, min(64, voxel_flat.numel())).indices
            idx = top[voxel_flat[top] >= vmax * 0.6]
            tentative = True
        ix = (idx // (grid_n * grid_n)).float()
        iy = ((idx // grid_n) % grid_n).float()
        iz = (idx % grid_n).float()
        w = voxel_flat[idx].float()
        if float(w.sum().item()) <= 1e-6:
            w = torch.ones_like(w)
        wsum = w.sum()
        cx = float((ix * w).sum() / wsum)
        cy = float((iy * w).sum() / wsum)
        cz = float((iz * w).sum() / wsum)
        n_agree = 1 if tentative else int(support[idx].max().item())
        count = int(idx.numel())
    world = (
        float(gmin_np[0] + cx * voxel_size),
        float(gmin_np[1] + cy * voxel_size),
        float(gmin_np[2] + cz * voxel_size),
    )
    if tentative:
        confidence = 0.25
    else:
        cam_term = min(1.0, (n_agree - 1) / max(1, min_cameras))
        size_term = min(1.0, count / 25.0)
        confidence = max(0.1, 0.55 * cam_term + 0.45 * size_term)
    return Detection(True, world, n_agree, count, float(confidence), tentative)


def scene3d_panel(
    support_flat: torch.Tensor,
    voxel_flat: torch.Tensor,
    grid_n: int,
    gmin_np: np.ndarray,
    gmax_np: np.ndarray,
    voxel_size: float,
    cam_positions: list[np.ndarray],
    cam_names: list[str],
    detection: Detection,
    yaw: float,
    pitch: float,
    width: int,
    height: int,
    min_cameras: int,
    max_points: int,
) -> np.ndarray:
    img = np.full((height, width, 3), COL_BG, dtype=np.uint8)
    span = np.asarray(gmax_np, np.float32) - np.asarray(gmin_np, np.float32)
    span = np.where(np.abs(span) < 1e-6, 1.0, span).astype(np.float32)

    def to_norm(world_xyz: np.ndarray) -> np.ndarray:
        return (np.asarray(world_xyz, np.float32) - gmin_np) / span * 2.0 - 1.0

    # Bounding cube for orientation.
    corners = np.array(
        [[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)],
        dtype=np.float32,
    )
    csx, csy, _ = project_norm(corners, yaw, pitch, width, height)
    edges = [
        (0, 1), (0, 2), (0, 4), (3, 1), (3, 2), (3, 7),
        (5, 1), (5, 4), (5, 7), (6, 2), (6, 4), (6, 7),
    ]
    for a, b in edges:
        cv2.line(img, (int(csx[a]), int(csy[a])), (int(csx[b]), int(csy[b])),
                 (60, 54, 48), 1, cv2.LINE_AA)

    # Shared voxel cloud (where cameras agree).
    with torch.inference_mode():
        support = support_flat.reshape(-1)
        vidx = torch.nonzero(support >= min_cameras, as_tuple=False).flatten()
        if vidx.numel() == 0:
            vmax = float(voxel_flat.max().item())
            if vmax > 1e-6:
                vidx = torch.nonzero(
                    voxel_flat >= vmax * 0.25, as_tuple=False
                ).flatten()
        if vidx.numel() > max_points:
            vidx = vidx[torch.topk(voxel_flat[vidx], max_points).indices]
        vidx_np = vidx.detach().cpu().numpy()
    if vidx_np.size:
        ix = vidx_np // (grid_n * grid_n)
        iy = (vidx_np // grid_n) % grid_n
        iz = vidx_np % grid_n
        world = np.stack(
            [
                gmin_np[0] + ix * voxel_size,
                gmin_np[1] + iy * voxel_size,
                gmin_np[2] + iz * voxel_size,
            ],
            axis=1,
        )
        sx, sy, depth = project_norm(to_norm(world), yaw, pitch, width, height)
        for i in np.argsort(depth)[::-1]:
            x, y = int(sx[i]), int(sy[i])
            if 0 <= x < width and 0 <= y < height:
                cv2.circle(img, (x, y), 2, (150, 130, 60), -1, cv2.LINE_AA)

    # Detected point + one ray per camera.
    if detection.detected and detection.world is not None:
        ox, oy, _ = project_norm(
            to_norm(np.array(detection.world, np.float32))[None, :],
            yaw, pitch, width, height,
        )
        opx = (int(ox[0]), int(oy[0]))
        for pos in cam_positions:
            cxp, cyp, _ = project_norm(to_norm(pos)[None, :], yaw, pitch, width, height)
            cv2.line(img, (int(cxp[0]), int(cyp[0])), opx, COL_RAY, 1, cv2.LINE_AA)
        col = COL_WARN if detection.tentative else COL_OBJECT
        cv2.circle(img, opx, 9, tuple(c // 3 for c in col), -1, cv2.LINE_AA)
        cv2.circle(img, opx, 5, col, -1, cv2.LINE_AA)
        cv2.circle(img, opx, 9, col, 1, cv2.LINE_AA)
        x, y, z = detection.world
        _draw_text(img, f"x={x:.1f} y={y:.1f} z={z:.1f} m",
                   (max(6, opx[0] + 12), max(18, opx[1] - 10)), 0.5, COL_TEXT, 1)

    # Camera markers.
    for pos, name in zip(cam_positions, cam_names):
        cxp, cyp, _ = project_norm(to_norm(pos)[None, :], yaw, pitch, width, height)
        cx = int(np.clip(cxp[0], 6, width - 6))
        cy = int(np.clip(cyp[0], 6, height - 6))
        cv2.rectangle(img, (cx - 5, cy - 5), (cx + 5, cy + 5), COL_ACCENT, -1)
        _draw_text(img, name, (cx + 9, cy + 5), 0.45, COL_ACCENT, 1)

    _draw_text(img, "VUE 3D - glisser pour tourner", (12, 22), 0.5, COL_MUTED, 1)
    return img


def _draw_text(img: np.ndarray, text: str, org: tuple[int, int],
               scale: float = 0.5, color: tuple = COL_TEXT, thick: int = 1) -> None:
    """Draw crisp anti-aliased text. `org` is a left/baseline anchor (like cv2)."""
    if not _HAS_PIL:
        cv2.putText(img, text, org, FONT, scale, color, thick, cv2.LINE_AA)
        return
    size = max(11, int(round(scale * 30)))
    fill = (int(color[0]), int(color[1]), int(color[2]))  # BGR bytes, written positionally
    pim = _PILImage.fromarray(img)
    draw = _PILDraw.Draw(pim)
    try:
        draw.text((int(org[0]), int(org[1])), text, font=_font(size, thick >= 2),
                  fill=fill, anchor="ls")
    except Exception:
        draw.text((int(org[0]), int(org[1]) - size), text,
                  font=_font(size, thick >= 2), fill=fill)
    img[:, :, :] = np.asarray(pim)


def _status_dot(img: np.ndarray, x: int, y: int, ok: bool) -> None:
    cv2.circle(img, (x, y), 6, COL_OK if ok else COL_BAD, -1, cv2.LINE_AA)


def _confidence_gauge(img: np.ndarray, x: int, y: int, conf: float, slots: int = 4) -> None:
    filled = int(round(float(np.clip(conf, 0.0, 1.0)) * slots))
    for i in range(slots):
        cv2.circle(img, (x + i * 16, y), 5,
                   COL_OK if i < filled else (70, 70, 70), -1, cv2.LINE_AA)


def build_hints(
    cameras: list[CameraRuntime], detection: Detection, min_cameras: int
) -> list[str]:
    offline = [c.cfg.name for c in cameras if not getattr(c, "is_live", False)]
    moving = [c for c in cameras if c.motion_px > 0]
    if offline:
        return [f"camera {', '.join(offline)} : pas de flux, verifie l'URL / le Wi-Fi"]
    if detection.detected and not detection.tentative:
        return [f"OK : objet detecte, {detection.n_agree} cameras d'accord"]
    if len(moving) == 0:
        return ["aucun mouvement : bouge un objet devant les cameras"]
    if len(moving) == 1:
        return [f"seule {moving[0].cfg.name} voit du mouvement : oriente l'autre camera"]
    if not detection.detected:
        return ["les cameras ne se croisent pas : verifie position x/y/z et FOV"]
    return ["signal faible (1 camera) : pas encore de croisement net"]


def render_dashboard(
    cameras: list[CameraRuntime],
    scene_img: np.ndarray,
    detection: Detection,
    fps: float,
    device_type: str,
    hints: list[str],
    grid_n: int,
    voxel_size: float,
    preview_width: int,
) -> np.ndarray:
    pad = 10
    title_h = 36
    det_h = 88
    scene_h, scene_w = scene_img.shape[:2]

    pane_imgs: list[np.ndarray] = []
    for cam in cameras:
        if cam.last_overlay is None:
            pane = np.full((180, preview_width, 3), COL_PANEL, dtype=np.uint8)
        else:
            ov = cam.last_overlay
            scale = preview_width / max(1, ov.shape[1])
            pane = cv2.resize(ov, (preview_width, max(1, int(ov.shape[0] * scale))))
        header = np.full((30, preview_width, 3), COL_BG, dtype=np.uint8)
        live = bool(getattr(cam, "is_live", False))
        _status_dot(header, 14, 15, live)
        _draw_text(header, cam.cfg.name, (28, 20), 0.55, COL_TEXT, 1)
        _draw_text(header, f"{'live' if live else 'hors-ligne'} | {fps:4.1f} fps | "
                   f"mouvement {cam.motion_px} px", (120, 20), 0.42,
                   COL_OK if live else COL_MUTED, 1)
        pane_imgs.append(
            cv2.copyMakeBorder(np.vstack([header, pane]), 0, 8, 0, 0,
                               cv2.BORDER_CONSTANT, value=COL_BG)
        )

    if pane_imgs:
        col_w = max(p.shape[1] for p in pane_imgs)
        pane_imgs = [
            cv2.copyMakeBorder(p, 0, 0, 0, col_w - p.shape[1], cv2.BORDER_CONSTANT,
                               value=COL_BG)
            if p.shape[1] < col_w else p
            for p in pane_imgs
        ]
        left_col = np.vstack(pane_imgs)
    else:
        left_col = np.full((scene_h, preview_width, 3), COL_BG, dtype=np.uint8)

    content_h = max(left_col.shape[0], scene_h)
    if left_col.shape[0] < content_h:
        left_col = cv2.copyMakeBorder(left_col, 0, content_h - left_col.shape[0], 0, 0,
                                      cv2.BORDER_CONSTANT, value=COL_BG)
    scene_pad = scene_img
    if scene_h < content_h:
        scene_pad = cv2.copyMakeBorder(scene_img, 0, content_h - scene_h, 0, 0,
                                       cv2.BORDER_CONSTANT, value=COL_BG)

    body = np.hstack([
        left_col,
        np.full((content_h, pad, 3), COL_BG, dtype=np.uint8),
        scene_pad,
    ])
    total_w = body.shape[1]

    title = np.full((title_h, total_w, 3), COL_PANEL_HI, dtype=np.uint8)
    cv2.rectangle(title, (0, 0), (6, title_h), COL_ACCENT, -1)
    _draw_text(title, "PAVOIS - debug temps reel", (16, 24), 0.62, COL_TEXT, 1)
    _draw_text(title, f"{fps:4.1f} fps | {device_type} | grille N={grid_n} vox={voxel_size}m",
               (max(16, total_w - 360), 24), 0.45, COL_MUTED, 1)

    det = np.full((det_h, total_w, 3), COL_PANEL, dtype=np.uint8)
    cv2.rectangle(det, (0, 0), (6, det_h), COL_ACCENT, -1)
    if detection.detected:
        mark = "OBJET DETECTE"
        mcol = COL_WARN if detection.tentative else COL_OK
    else:
        mark, mcol = "AUCUN OBJET", COL_MUTED
    _draw_text(det, mark, (16, 28), 0.6, mcol, 2)
    if detection.detected and detection.world is not None:
        x, y, z = detection.world
        _draw_text(det, f"position   x={x:.1f}   y={y:.1f}   z={z:.1f}  m",
                   (16, 54), 0.5, COL_TEXT, 1)
        _draw_text(det, f"cameras d'accord : {detection.n_agree}   "
                   f"({detection.count} voxels)", (16, 76), 0.45, COL_MUTED, 1)
        _draw_text(det, "confiance", (max(16, total_w - 360), 26), 0.45, COL_MUTED, 1)
        _confidence_gauge(det, max(110, total_w - 270), 22, detection.confidence)
    if hints:
        _draw_text(det, hints[0], (max(16, total_w - 360), 56), 0.42, COL_WARN, 1)

    return np.vstack([
        title,
        np.full((pad, total_w, 3), COL_BG, dtype=np.uint8),
        body,
        np.full((pad, total_w, 3), COL_BG, dtype=np.uint8),
        det,
    ])


def run_self_test(args: argparse.Namespace) -> None:
    dev = pick_device(args.no_cuda)
    cfgs = [
        CameraConfig("left", "synthetic", 0.0, 0.0, 1.5, 0.0, 90.0, 0.0, 60.0),
        CameraConfig("right", "synthetic", 2.0, 0.0, 1.5, 0.0, 90.0, 0.0, 60.0),
    ]
    cams = [CameraRuntime(cfg) for cfg in cfgs]
    for cam in cams:
        cam.width = 640
        cam.height = 480
        cam.dirs_t, cam.cam_t = build_dirs_for_camera(cam.cfg, 640, 480, dev)

    n = args.grid_n
    vs = args.voxel_size
    gc = np.array(args.grid_center, dtype=np.float32)
    half = 0.5 * n * vs
    gmin = torch.tensor(gc - half, device=dev)
    gmax = torch.tensor(gc + half, device=dev)
    vox = torch.zeros(n * n * n, device=dev)
    rng = np.random.default_rng(123)

    # Synthetic triangulation target near the grid center. Pick each camera's
    # center pixel so both rays intersect near +Y from the cameras.
    for cam in cams:
        motion_u8 = np.zeros((480, 640), dtype=np.uint8)
        diff = np.zeros((480, 640), dtype=np.float32)
        cx = 320 if cam.cfg.name == "left" else 260
        cy = 240
        cv2.circle(motion_u8, (cx, cy), 8, 255, -1)
        cv2.circle(diff, (cx, cy), 8, 80.0, -1)
        motion = motion_u8 > 127
        scatter_camera_motion(
            cam,
            motion,
            diff,
            vox,
            None,
            gmin,
            gmax,
            vs,
            n,
            args.ray_steps,
            args.max_rays_per_camera,
            1,
            rng,
        )

    peak = int(torch.argmax(vox).item())
    peak_val = float(vox[peak].item())
    ix = peak // (n * n)
    iy = (peak // n) % n
    iz = peak % n
    world = (gc - half) + np.array([ix, iy, iz], dtype=np.float32) * vs
    print(
        "SELF_TEST_OK "
        f"device={dev.type} peak={peak_val:.1f} "
        f"voxel=({ix},{iy},{iz}) world=({world[0]:.2f},{world[1]:.2f},{world[2]:.2f})"
    )

    if args.headless:
        return

    # Visual self-test: show the dashboard with a synthetic detection so the 3D
    # view can be checked (and rotated) without any camera.
    min_cams = max(2, args.shared_min_cameras)
    support_t = torch.zeros_like(vox, dtype=torch.uint8)
    support_t[vox >= max(1e-6, 0.5 * peak_val)] = min_cams
    detection = compute_detection(support_t, vox, n, (gc - half).astype(np.float32), vs, min_cams)
    cam_positions = [np.array([c.x, c.y, c.z], np.float32) for c in cfgs]
    cam_names = [c.name for c in cfgs]
    placeholder = np.full((240, 320, 3), COL_PANEL, dtype=np.uint8)
    _draw_text(placeholder, "flux synthetique", (24, 124), 0.6, COL_MUTED, 1)
    for cam in cams:
        cam.last_overlay = placeholder.copy()
        cam.is_live = True
        cam.motion_px = 120
    view_state = View3DState(yaw=float(args.view3d_yaw), pitch=float(args.view3d_pitch))
    cv2.namedWindow("pavois multi", cv2.WINDOW_NORMAL)
    cv2.setMouseCallback("pavois multi", make_mouse_handler(view_state))
    print("Self-test visuel : glisser pour tourner, 'q' pour quitter.")
    try:
        while True:
            scene_img = scene3d_panel(
                support_t, vox, n, (gc - half).astype(np.float32),
                (gc + half).astype(np.float32), vs, cam_positions, cam_names,
                detection, view_state.yaw, view_state.pitch,
                args.view3d_width, args.view3d_height, min_cams, args.view3d_max_points,
            )
            hints = build_hints(cams, detection, min_cams)
            combo = render_dashboard(
                cams, scene_img, detection, 0.0, dev.type, hints,
                n, vs, min(420, max(240, args.preview_width)),
            )
            cv2.imshow("pavois multi", combo)
            if cv2.waitKey(30) & 0xFF == ord("q"):
                break
    finally:
        cv2.destroyAllWindows()


def main() -> None:
    ap = argparse.ArgumentParser(description="Realtime multi-camera voxel preview.")
    ap.add_argument(
        "--camera",
        action="append",
        default=[],
        help=(
            "Repeat for each source: "
            "name=left,source=http://PHONE:4747/video,x=0,y=0,z=1.5,"
            "yaw=0,pitch=90,roll=0,fov=60"
        ),
    )
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--backend", choices=("AUTO", "MSMF", "DSHOW", "DEFAULT"), default="AUTO")
    ap.add_argument("--url-backend", choices=("DEFAULT", "FFMPEG"), default="DEFAULT")
    ap.add_argument("--grid-n", type=int, default=64)
    ap.add_argument("--voxel-size", type=float, default=0.35)
    ap.add_argument("--grid-center", type=float, nargs=3, default=[1.0, 10.0, 5.0])
    ap.add_argument("--motion", type=float, default=8.0)
    ap.add_argument("--motion-from", choices=("raw", "processed"), default="raw")
    ap.add_argument("--motion-blur", type=int, default=0)
    ap.add_argument("--motion-diff-median", type=int, default=3)
    ap.add_argument("--motion-open", type=int, default=1)
    ap.add_argument("--motion-close", type=int, default=0)
    ap.add_argument("--motion-min-area", type=int, default=32)
    ap.add_argument("--motion-votes", type=int, default=0)
    ap.add_argument("--motion-scale", type=float, default=0.5)
    ap.add_argument("--motion-stride", type=int, default=1)
    ap.add_argument("--foreground", action="store_true")
    ap.add_argument("--foreground-thresh", type=int, default=200)
    ap.add_argument("--gaussian", type=int, default=0)
    ap.add_argument("--bilateral-d", type=int, default=0)
    ap.add_argument("--bilateral-sigma-color", type=float, default=55.0)
    ap.add_argument("--bilateral-sigma-space", type=float, default=55.0)
    ap.add_argument("--temporal", type=float, default=0.0)
    ap.add_argument("--decay", type=float, default=0.88)
    ap.add_argument("--ray-steps", type=int, default=28)
    ap.add_argument("--max-rays-per-camera", type=int, default=1400)
    ap.add_argument("--voxel-viz-every", type=int, default=2)
    ap.add_argument(
        "--shared-min-cameras",
        type=int,
        default=2,
        help="Third panel: show voxels touched by at least this many cameras in the current frame.",
    )
    ap.add_argument(
        "--preview-width",
        type=int,
        default=640,
        help="Display width for each camera preview pane.",
    )
    ap.add_argument(
        "--voxel-view",
        choices=("3d", "projections"),
        default="3d",
        help="Right panel render mode for accumulated voxels.",
    )
    ap.add_argument(
        "--show-heatmap",
        action="store_true",
        help="Show the accumulated voxel heat panel on the right.",
    )
    ap.add_argument(
        "--shared-view",
        choices=("3d", "projections"),
        default="3d",
        help="Middle panel render mode for voxels touched by multiple cameras.",
    )
    ap.add_argument("--view3d-width", type=int, default=560)
    ap.add_argument("--view3d-height", type=int, default=560)
    ap.add_argument("--view3d-yaw", type=float, default=-35.0)
    ap.add_argument("--view3d-pitch", type=float, default=28.0)
    ap.add_argument("--view3d-max-points", type=int, default=4500)
    ap.add_argument("--no-cuda", action="store_true")
    ap.add_argument("--no-hud", action="store_true")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--frames", type=int, default=0, help="Stop after N processed frames; 0=forever.")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        run_self_test(args)
        return

    if len(args.camera) < 2:
        print("Need at least two --camera entries for triangulation.", file=sys.stderr)
        raise SystemExit(2)

    cfgs = [parse_camera_spec(spec, i) for i, spec in enumerate(args.camera)]
    dev = pick_device(args.no_cuda)
    print(f"Python: {sys.executable}")
    print(f"PyTorch {torch.__version__} | cuda.is_available()={torch.cuda.is_available()}")
    print(f"Using device: {dev.type}")

    pp_cfg = PreprocessConfig(
        gaussian_ksize=args.gaussian,
        bilateral_d=args.bilateral_d,
        bilateral_sigma_color=args.bilateral_sigma_color,
        bilateral_sigma_space=args.bilateral_sigma_space,
        temporal=args.temporal,
    )

    cameras: list[CameraRuntime] = []
    try:
        for cfg in cfgs:
            cam = CameraRuntime(cfg)
            cam.cap = ThreadedCapture(
                cfg.source,
                args.width,
                args.height,
                args.backend,
                args.url_backend,
            )
            if args.foreground:
                cam.bgs = cv2.createBackgroundSubtractorMOG2(
                    history=240, varThreshold=24, detectShadows=False
                )
            cameras.append(cam)
            print(
                f"{cfg.name}: source={cfg.source} backend={cam.cap.backend_label} "
                f"pos=({cfg.x},{cfg.y},{cfg.z}) ypr=({cfg.yaw},{cfg.pitch},{cfg.roll}) fov={cfg.fov}"
            )

        for cam in cameras:
            assert cam.cap is not None
            if not cam.cap.wait_for_first_frame(5.0):
                raise RuntimeError(
                    f"{cam.cfg.name}: no frames received from {cam.cfg.source!r}.\n"
                    f"{cam.cap.status_text()}"
                )

        n = args.grid_n
        vs = args.voxel_size
        gc = np.array(args.grid_center, dtype=np.float32)
        half = 0.5 * n * vs
        gmin_t = torch.tensor(gc - half, device=dev, dtype=torch.float32)
        gmax_t = torch.tensor(gc + half, device=dev, dtype=torch.float32)
        grid_min_np = (gc - half).astype(np.float32)
        grid_max_np = (gc + half).astype(np.float32)
        min_cams = max(2, args.shared_min_cameras)
        voxel_flat = torch.zeros(n * n * n, device=dev, dtype=torch.float32)
        rng = np.random.default_rng()

        view_state = View3DState(yaw=float(args.view3d_yaw), pitch=float(args.view3d_pitch))
        if not args.headless:
            cv2.namedWindow("pavois multi", cv2.WINDOW_NORMAL)
            cv2.setMouseCallback("pavois multi", make_mouse_handler(view_state))

        frame_i = 0
        last_fps_t = time.perf_counter()
        fps = 0.0
        while True:
            voxel_flat *= args.decay
            support_flat = torch.zeros(
                n * n * n,
                device=dev,
                dtype=torch.uint8,
            )
            active = 0
            for cam in cameras:
                assert cam.cap is not None
                bgr, ts = cam.cap.latest()
                cam.is_live = bgr is not None
                if bgr is None:
                    continue
                active += 1
                h, w = bgr.shape[:2]
                if cam.width != w or cam.height != h or cam.dirs_t is None:
                    cam.width = w
                    cam.height = h
                    cam.dirs_t, cam.cam_t = build_dirs_for_camera(cam.cfg, w, h, dev)
                    print(f"{cam.cfg.name}: actual frame size {w}x{h}")

                motion, diff_w, overlay = motion_mask_for_frame(cam, bgr, args, pp_cfg)
                cam.last_overlay = overlay
                if motion is None or diff_w is None:
                    continue
                cam.last_motion = motion
                scatter_camera_motion(
                    cam,
                    motion,
                    diff_w,
                    voxel_flat,
                    support_flat,
                    gmin_t,
                    gmax_t,
                    vs,
                    n,
                    args.ray_steps,
                    args.max_rays_per_camera,
                    max(1, args.motion_stride),
                    rng,
                )

            if active == 0:
                time.sleep(0.03)
                continue

            frame_i += 1
            if frame_i % 15 == 0:
                now = time.perf_counter()
                fps = 15.0 / max(1e-6, now - last_fps_t)
                last_fps_t = now

            detection = compute_detection(
                support_flat, voxel_flat, n, grid_min_np, vs, min_cams
            )
            cam_positions = [
                cam.cam_t[0].detach().cpu().numpy()
                for cam in cameras
                if cam.cam_t is not None
            ]
            cam_names = [cam.cfg.name for cam in cameras if cam.cam_t is not None]
            scene_img = scene3d_panel(
                support_flat, voxel_flat, n, grid_min_np, grid_max_np, vs,
                cam_positions, cam_names, detection,
                view_state.yaw, view_state.pitch,
                args.view3d_width, args.view3d_height, min_cams, args.view3d_max_points,
            )
            hints = build_hints(cameras, detection, min_cams)
            combo = render_dashboard(
                cameras, scene_img, detection, fps, dev.type, hints,
                n, vs, min(420, max(240, args.preview_width)),
            )

            if not args.headless:
                cv2.setWindowTitle("pavois multi", f"PAVOIS | {fps:.1f} fps | {dev.type}")
                cv2.imshow("pavois multi", combo)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            if args.frames > 0 and frame_i >= args.frames:
                break
    finally:
        for cam in cameras:
            if cam.cap is not None:
                cam.cap.close()
        if not args.headless:
            cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
