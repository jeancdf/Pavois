"""
Grayscale preprocessing for noisy webcams: optional Gaussian blur, bilateral
filter, and temporal exponential smoothing (reduces pepper noise between
frames).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

try:
    import cv2
except ImportError:
    cv2 = None  # type: ignore


@dataclass
class PreprocessConfig:
    gaussian_ksize: int = 0
    bilateral_d: int = 0
    bilateral_sigma_color: float = 55.0
    bilateral_sigma_space: float = 55.0
    temporal: float = 0.0


@dataclass
class TemporalState:
    prev_smoothed: np.ndarray | None = None


def preprocess_gray(
    gray_f32: np.ndarray,
    state: TemporalState,
    cfg: PreprocessConfig,
) -> np.ndarray:
    """
    gray_f32: HxW float32 roughly 0..255.
    Returns processed float32 same shape; updates state.prev_smoothed.
    """
    if cv2 is None:
        raise RuntimeError("opencv required")

    g = gray_f32
    k = cfg.gaussian_ksize
    if k and k >= 3 and k % 2 == 1:
        g = cv2.GaussianBlur(g, (k, k), 0)

    if cfg.bilateral_d and cfg.bilateral_d >= 3:
        u8 = np.clip(g, 0, 255).astype(np.uint8)
        u8 = cv2.bilateralFilter(
            u8,
            cfg.bilateral_d,
            cfg.bilateral_sigma_color,
            cfg.bilateral_sigma_space,
        )
        g = u8.astype(np.float32)

    t = cfg.temporal
    if t > 0 and state.prev_smoothed is not None:
        if state.prev_smoothed.shape == g.shape:
            g = (1.0 - t) * g + t * state.prev_smoothed

    state.prev_smoothed = g.copy()
    return g
