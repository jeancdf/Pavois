#!/usr/bin/env python3
"""
Build a voxel_grid.bin directly from metadata.json + captured frames.

This is a Python fallback for environments where the C++ ray_voxel binary
or its vendored headers are not available.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError:
    print("Install dependencies: pip install opencv-python numpy", file=sys.stderr)
    raise SystemExit(1)


def deg2rad(degrees: float) -> float:
    return degrees * math.pi / 180.0


def rotation_matrix_ypr(yaw_deg: float, pitch_deg: float, roll_deg: float) -> np.ndarray:
    """Match ray_voxel.cpp / realtime_voxel_preview.py camera convention."""
    y, p, r = deg2rad(yaw_deg), deg2rad(pitch_deg), deg2rad(roll_deg)
    cy, sy = math.cos(y), math.sin(y)
    cr, sr = math.cos(r), math.sin(r)
    cp, sp = math.cos(p), math.sin(p)

    rz = np.array([[cy, -sy, 0.0], [sy, cy, 0.0], [0.0, 0.0, 1.0]], dtype=np.float32)
    ry = np.array([[cr, 0.0, sr], [0.0, 1.0, 0.0], [-sr, 0.0, cr]], dtype=np.float32)
    rx = np.array([[1.0, 0.0, 0.0], [0.0, cp, -sp], [0.0, sp, cp]], dtype=np.float32)
    return rz @ ry @ rx


def ray_aabb_t_batch(
    origins: np.ndarray,
    directions: np.ndarray,
    grid_min: np.ndarray,
    grid_max: np.ndarray,
    eps: float = 1e-7,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Vectorized ray / axis-aligned box intersection."""
    t0 = np.zeros(origins.shape[0], dtype=np.float32)
    t1 = np.full(origins.shape[0], 1e30, dtype=np.float32)

    for axis in range(3):
        origin = origins[:, axis]
        direction = directions[:, axis]
        mn = grid_min[axis]
        mx = grid_max[axis]

        sign = np.where(direction >= 0.0, 1.0, -1.0).astype(np.float32)
        safe = np.where(np.abs(direction) < eps, sign * eps, direction)
        t_near = (mn - origin) / safe
        t_far = (mx - origin) / safe
        lo = np.minimum(t_near, t_far)
        hi = np.maximum(t_near, t_far)
        t0 = np.maximum(t0, lo)
        t1 = np.minimum(t1, hi)

    ok = (t1 >= t0) & (t1 >= 0.0)
    t0 = np.clip(t0, 0.0, None)
    return t0, t1, ok


def load_metadata(metadata_path: Path) -> tuple[list[dict], dict]:
    doc = json.loads(metadata_path.read_text(encoding="utf-8"))
    if isinstance(doc, list):
        frames = doc
        grid = {}
    elif isinstance(doc, dict) and isinstance(doc.get("frames"), list):
        frames = doc["frames"]
        grid = doc.get("voxel_grid") or {}
    else:
        raise ValueError(
            "metadata.json must be a frame array or "
            '{ "frames": [...], "voxel_grid": {...} }'
        )

    if not frames:
        raise ValueError("metadata.json did not contain any frames")
    return frames, grid


def load_gray_image(image_path: Path) -> np.ndarray:
    img = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise FileNotFoundError(f"Could not read image: {image_path}")
    return img.astype(np.float32)


def precompute_world_dirs(
    width: int,
    height: int,
    fov_degrees: float,
    yaw: float,
    pitch: float,
    roll: float,
) -> np.ndarray:
    fov_rad = deg2rad(fov_degrees)
    focal = (width * 0.5) / math.tan(fov_rad * 0.5)
    uu, vv = np.meshgrid(
        np.arange(width, dtype=np.float32),
        np.arange(height, dtype=np.float32),
    )
    xc = uu - 0.5 * width
    yc = -(vv - 0.5 * height)
    zc = np.full_like(xc, -focal, dtype=np.float32)
    dirs_cam = np.stack([xc, yc, zc], axis=-1)
    dirs_cam /= np.linalg.norm(dirs_cam, axis=-1, keepdims=True) + 1e-12
    dirs_cam = dirs_cam.reshape(-1, 3)

    rotation = rotation_matrix_ypr(yaw, pitch, roll)
    return (dirs_cam @ rotation.T).astype(np.float32)


def write_voxel_sidecar_meta(
    output_bin: Path,
    n: int,
    voxel_size: float,
    grid_center: np.ndarray,
) -> None:
    meta_path = output_bin.with_name(output_bin.stem + "_meta.json")
    payload = {
        "N": int(n),
        "voxel_size": float(voxel_size),
        "grid_center": [float(v) for v in grid_center.tolist()],
    }
    meta_path.write_text(json.dumps(payload), encoding="utf-8")


def write_voxel_grid(output_bin: Path, n: int, voxel_size: float, voxel_flat: np.ndarray) -> None:
    output_bin.parent.mkdir(parents=True, exist_ok=True)
    with open(output_bin, "wb") as f:
        np.array([n], dtype=np.int32).tofile(f)
        np.array([voxel_size], dtype=np.float32).tofile(f)
        voxel_flat.astype(np.float32, copy=False).tofile(f)


def build_voxel_grid(
    metadata_path: Path,
    image_folder: Path,
    output_bin: Path,
    motion_threshold: float = 2.0,
    ray_steps: int = 48,
    max_rays_per_frame: int = 12000,
) -> Path:
    frames, grid_cfg = load_metadata(metadata_path)

    n = int(grid_cfg.get("N", 72))
    voxel_size = float(grid_cfg.get("voxel_size", 0.35))
    grid_center = np.asarray(
        grid_cfg.get("grid_center", [0.0, 10.0, 5.0]),
        dtype=np.float32,
    )
    if grid_center.shape != (3,):
        raise ValueError("voxel_grid.grid_center must contain 3 values")

    half = 0.5 * n * voxel_size
    grid_min = grid_center - half
    grid_max = grid_center + half
    voxel_flat = np.zeros(n * n * n, dtype=np.float32)
    t_lin = np.linspace(0.0, 1.0, max(2, ray_steps), dtype=np.float32)

    frames_by_camera: dict[int, list[dict]] = defaultdict(list)
    for frame in frames:
        frames_by_camera[int(frame.get("camera_index", 0))].append(frame)
    for cam_frames in frames_by_camera.values():
        cam_frames.sort(key=lambda item: int(item.get("frame_index", 0)))

    dirs_cache: dict[tuple[object, ...], np.ndarray] = {}
    total_pairs = sum(max(0, len(cam_frames) - 1) for cam_frames in frames_by_camera.values())
    processed_pairs = 0

    for cam_index, cam_frames in sorted(frames_by_camera.items()):
        prev_gray: np.ndarray | None = None
        prev_shape: tuple[int, int] | None = None

        for frame in cam_frames:
            image_file = frame.get("image_file")
            if not image_file:
                raise ValueError("Each frame entry must include image_file")
            image_path = image_folder / image_file
            gray = load_gray_image(image_path)

            if prev_gray is None:
                prev_gray = gray
                prev_shape = gray.shape
                continue

            if prev_shape != gray.shape:
                raise ValueError(
                    f"Frame size changed inside camera {cam_index}: "
                    f"{prev_shape} -> {gray.shape}"
                )

            diff = np.abs(gray - prev_gray)
            motion_idx = np.flatnonzero((diff > motion_threshold).ravel())
            if max_rays_per_frame > 0 and motion_idx.size > max_rays_per_frame:
                step = int(math.ceil(motion_idx.size / max_rays_per_frame))
                motion_idx = motion_idx[::step][:max_rays_per_frame]

            if motion_idx.size > 0:
                height, width = gray.shape
                dir_key = (
                    width,
                    height,
                    float(frame.get("fov_degrees", 60.0)),
                    float(frame.get("yaw", 0.0)),
                    float(frame.get("pitch", 0.0)),
                    float(frame.get("roll", 0.0)),
                )
                dirs_world = dirs_cache.get(dir_key)
                if dirs_world is None:
                    dirs_world = precompute_world_dirs(*dir_key)
                    dirs_cache[dir_key] = dirs_world

                directions = dirs_world[motion_idx]
                origin = np.asarray(frame.get("camera_position", [0.0, 0.0, 1.5]), dtype=np.float32)
                if origin.shape != (3,):
                    raise ValueError("camera_position must contain 3 values")
                origins = np.repeat(origin[None, :], directions.shape[0], axis=0)

                t0, t1, ok = ray_aabb_t_batch(origins, directions, grid_min, grid_max)
                if ok.any():
                    directions = directions[ok]
                    origins = origins[ok]
                    t0 = t0[ok]
                    t1 = t1[ok]
                    diff_vals = diff.ravel()[motion_idx][ok].astype(np.float32)

                    tt = t0[:, None] + t_lin[None, :] * (t1 - t0)[:, None]
                    points = origins[:, None, :] + tt[:, :, None] * directions[:, None, :]
                    ix = ((points[..., 0] - grid_min[0]) / voxel_size).astype(np.int32)
                    iy = ((points[..., 1] - grid_min[1]) / voxel_size).astype(np.int32)
                    iz = ((points[..., 2] - grid_min[2]) / voxel_size).astype(np.int32)
                    inside = (
                        (ix >= 0)
                        & (ix < n)
                        & (iy >= 0)
                        & (iy < n)
                        & (iz >= 0)
                        & (iz < n)
                    )
                    if inside.any():
                        flat_idx = (ix * (n * n) + iy * n + iz)[inside]
                        weights = np.broadcast_to(diff_vals[:, None], inside.shape)[inside]
                        np.add.at(voxel_flat, flat_idx, weights)

            prev_gray = gray
            processed_pairs += 1
            print(
                f"[voxelgrid_builder] camera {cam_index} frame-pair "
                f"{processed_pairs}/{total_pairs}",
                flush=True,
            )

    write_voxel_grid(output_bin, n, voxel_size, voxel_flat)
    write_voxel_sidecar_meta(output_bin, n, voxel_size, grid_center)
    print(f"[voxelgrid_builder] wrote {output_bin}", flush=True)
    return output_bin


def maybe_build_default_voxel_grid(output_bin: Path) -> bool:
    metadata_path = output_bin.parent / "metadata.json"
    image_folder = output_bin.parent
    if not metadata_path.is_file():
        return False
    try:
        source_label = metadata_path.relative_to(Path.cwd())
    except ValueError:
        source_label = metadata_path
    print(
        f"[voxelgrid_builder] {output_bin.name} missing; building from "
        f"{source_label}",
        flush=True,
    )
    build_voxel_grid(metadata_path, image_folder, output_bin)
    return output_bin.is_file()


def main() -> None:
    ap = argparse.ArgumentParser(description="Build voxel_grid.bin from metadata + frames.")
    ap.add_argument("metadata_json", type=Path, help="Path to metadata.json")
    ap.add_argument("image_folder", type=Path, help="Folder containing frame_XXXX images")
    ap.add_argument("output_bin", type=Path, help="Output voxel_grid.bin path")
    ap.add_argument("--motion-threshold", type=float, default=2.0)
    ap.add_argument("--ray-steps", type=int, default=48)
    ap.add_argument("--max-rays-per-frame", type=int, default=12000)
    args = ap.parse_args()

    build_voxel_grid(
        args.metadata_json,
        args.image_folder,
        args.output_bin,
        motion_threshold=args.motion_threshold,
        ray_steps=args.ray_steps,
        max_rays_per_frame=args.max_rays_per_frame,
    )


if __name__ == "__main__":
    main()
