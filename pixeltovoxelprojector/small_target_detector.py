#!/usr/bin/env python3
"""
Small-target detector (Phase 1) — the reusable detection core.

Finds faint, tiny spots (e.g. a distant drone) that the old motion-diff
pipeline throws away (`--motion-min-area` deletes small blobs). It does the
opposite: it *hunts* for the small weak point and reports its sub-pixel
position. OpenCV + numpy only, no PyTorch.

Three bricks (see documentation/plan-detection-drones.md, Phase 1):
  1. Slow background model (running average): what stands out from the slowly
     changing sky is "new". Rejects fixed clutter. Only meaningful for a fixed
     camera, so it is optional/toggleable.
  2. Top-hat highlighter: morphological white/black top-hat removes the smooth
     background and makes small bright/dark spots pop. Works even handheld.
  3. Sub-pixel centroid: intensity-weighted centre of each spot, "between the
     pixels" — precision is what matters for distant targets.

Later phases (tracking, triangulation) build on `SmallTargetDetector.update()`.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover - callers print an install hint
    cv2 = None  # type: ignore


@dataclass
class SmallTargetConfig:
    polarity: str = "both"          # "bright" | "dark" | "both"
    tophat_scales: tuple = (9,)     # SE sizes (px); response = max over scales. Mission default
    #                                 is the small scale only (distant target = a few pixels);
    #                                 add bigger scales (e.g. 9,31) for close/large test objects,
    #                                 at the cost of more cloud/background false positives.
    use_background: bool = True     # brick 1; meaningful only for a fixed camera
    bg_alpha: float = 0.02          # running-average rate (small = slow sky)
    bg_novelty: float = 6.0         # min |frame - background| to count as "new"
    thresh_sigma: float = 6.0       # detection threshold = median + k*sigma(MAD)
    abs_floor: float = 2.0          # absolute floor on the response threshold
    min_area: int = 1               # drop blobs smaller than this (kills 1px speckle if >1)
    max_area: int = 0               # 0 = no upper limit; set >0 to keep only tiny targets
    max_bbox_size: int = 0          # 0 = no limit; reject elongated clutter
    large_blob_peak: bool = False   # reduce elongated blobs to their strongest point
    # Motion gate (FIXED camera): the single principled clutter filter. A contrail
    # / cloud / fixed object is STATIC, so once seen it becomes background; a real
    # flying target (aircraft, fast particle) MOVES, so it stays foreground. We
    # keep only detections that coincide with moving foreground (OpenCV MOG2
    # background subtraction). This replaces the old collinear / persistence / tip
    # heuristics with one standard "detect movers on a fixed camera" mechanism.
    motion_gate: bool = True
    motion_history: int = 120       # frames of background memory (static clutter absorbed over ~this)
    motion_var_threshold: float = 16.0  # MOG2 sensitivity (lower = more foreground)
    motion_dilate: int = 6          # tolerance (px) matching a detection to the foreground mask
    max_targets: int = 30           # cap returned detections (strongest first)
    warmup_frames: int = 10         # build the background before detecting


@dataclass
class TargetDetection:
    u: float                          # sub-pixel column
    v: float                          # sub-pixel row
    score: float                      # peak top-hat response
    area: int                         # blob area in pixels
    polarity: str                     # "bright" or "dark"
    bbox: tuple[int, int, int, int]   # x, y, w, h


@dataclass
class FastMotionConfig:
    threshold: float = 12.0          # minimum absolute change between frames
    min_area: int = 12               # reject isolated sensor/compression noise
    max_area: int = 0                # 0 = no upper limit
    close_ksize: int = 3             # connect nearby changed pixels; 0/1 = off
    max_targets: int = 30


def _odd(k: int) -> int:
    k = max(1, int(k))
    return k if k % 2 == 1 else k + 1


class FastMotionDetector:
    """Cheap frame-difference detector for nearby, fast-moving objects."""

    def __init__(self, cfg: FastMotionConfig | None = None) -> None:
        if cv2 is None:
            raise RuntimeError("opencv-python is required (pip install opencv-python)")
        self.cfg = cfg or FastMotionConfig()
        self._close_ksize = -1
        self._close_se: np.ndarray | None = None
        self.reset()

    def reset(self) -> None:
        self.prev: np.ndarray | None = None
        self.frame_count = 0

    def update(self, gray: np.ndarray) -> tuple[list[TargetDetection], np.ndarray]:
        cfg = self.cfg
        g = (
            gray
            if gray.dtype == np.uint8
            else np.clip(gray, 0, 255).astype(np.uint8)
        )
        self.frame_count += 1
        if self.prev is None or self.prev.shape != g.shape:
            self.prev = g.copy()
            return [], np.zeros_like(g)

        response = cv2.absdiff(g, self.prev)
        self.prev = g.copy()
        _, mask = cv2.threshold(response, cfg.threshold, 255, cv2.THRESH_BINARY)
        if cfg.close_ksize > 1:
            k = _odd(cfg.close_ksize)
            if k != self._close_ksize:
                self._close_ksize = k
                self._close_se = cv2.getStructuringElement(
                    cv2.MORPH_ELLIPSE, (k, k)
                )
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, self._close_se)
        if not cv2.countNonZero(mask):
            return [], response

        n, _, stats, centroids = cv2.connectedComponentsWithStats(
            mask, connectivity=8
        )
        dets: list[TargetDetection] = []
        for i in range(1, n):
            area = int(stats[i, cv2.CC_STAT_AREA])
            if area < cfg.min_area:
                continue
            if cfg.max_area and area > cfg.max_area:
                continue
            x = int(stats[i, cv2.CC_STAT_LEFT])
            y = int(stats[i, cv2.CC_STAT_TOP])
            bw = int(stats[i, cv2.CC_STAT_WIDTH])
            bh = int(stats[i, cv2.CC_STAT_HEIGHT])
            score = float(response[y:y + bh, x:x + bw].max())
            dets.append(TargetDetection(
                u=float(centroids[i, 0]),
                v=float(centroids[i, 1]),
                score=score,
                area=area,
                polarity="bright",
                bbox=(x, y, bw, bh),
            ))

        dets.sort(key=lambda d: (d.area, d.score), reverse=True)
        return dets[: cfg.max_targets], response


class SmallTargetDetector:
    def __init__(self, cfg: SmallTargetConfig | None = None) -> None:
        if cv2 is None:
            raise RuntimeError("opencv-python is required (pip install opencv-python)")
        self.cfg = cfg or SmallTargetConfig()
        self._build_ses()
        self.reset()

    def _build_ses(self) -> None:
        self._scales = tuple(self.cfg.tophat_scales)
        self._ses = [
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (_odd(k), _odd(k)))
            for k in self._scales
        ]

    def reset(self) -> None:
        self.bg: np.ndarray | None = None
        self._fgmask: np.ndarray | None = None
        cfg = self.cfg
        self._bgsub = (
            cv2.createBackgroundSubtractorMOG2(
                history=cfg.motion_history,
                varThreshold=cfg.motion_var_threshold,
                detectShadows=False,
            )
            if cfg.motion_gate
            else None
        )
        self.frame_count = 0

    def _ensure_ses(self) -> None:
        # Rebuild the structuring elements if the scales changed at runtime.
        if tuple(self.cfg.tophat_scales) != self._scales:
            self._build_ses()

    def update(self, gray_f32: np.ndarray) -> tuple[list[TargetDetection], np.ndarray]:
        """gray_f32: HxW float32 (~0..255). Returns (detections, response map)."""
        cfg = self.cfg
        self._ensure_ses()
        # Morphology on uint8 is substantially faster than float32 in OpenCV.
        # Keep a float copy only for the slow running-average background.
        g_u8 = (
            gray_f32
            if gray_f32.dtype == np.uint8
            else np.clip(gray_f32, 0, 255).astype(np.uint8)
        )

        # --- Motion model: update the moving-foreground mask every frame ------
        # Must run before any early return so the background model stays current.
        if self._bgsub is not None:
            self._fgmask = self._bgsub.apply(g_u8)

        # --- Brick 2: multi-scale top-hat highlighter ------------------------
        # Run the top-hat at several structuring-element sizes and keep the max
        # response, so both tiny far targets and bigger/closer ones pop without
        # hand-tuning the kernel size.
        need_bright = cfg.polarity in ("bright", "both")
        need_dark = cfg.polarity in ("dark", "both")
        wth = bth = None
        for se in self._ses:
            if need_bright:
                w = cv2.morphologyEx(g_u8, cv2.MORPH_TOPHAT, se)
                wth = w if wth is None else cv2.max(wth, w)
            if need_dark:
                b = cv2.morphologyEx(g_u8, cv2.MORPH_BLACKHAT, se)
                bth = b if bth is None else cv2.max(bth, b)
        if cfg.polarity == "bright":
            response = wth
        elif cfg.polarity == "dark":
            response = bth
        else:
            response = cv2.max(wth, bth)

        # --- Brick 1: slow background (temporal novelty gate) ----------------
        self.frame_count += 1
        novelty_mask: np.ndarray | None = None
        if cfg.use_background:
            if self.bg is None:
                self.bg = g_u8.astype(np.float32)
            novelty_mask = cv2.absdiff(g_u8, cv2.convertScaleAbs(self.bg)) > cfg.bg_novelty
            # Update the running average AFTER measuring novelty.
            cv2.accumulateWeighted(g_u8, self.bg, cfg.bg_alpha)
            if self.frame_count <= cfg.warmup_frames:
                return [], response  # still learning the sky

        # --- Adaptive robust threshold (median + k * sigma via MAD) ----------
        # Subsample for speed; MAD shrugs off the few bright target pixels.
        flat = response[::4, ::4].ravel()
        med = float(np.median(flat))
        sigma = 1.4826 * float(np.median(np.abs(flat - med)))
        thresh = max(cfg.abs_floor, med + cfg.thresh_sigma * sigma)
        mask = (response > thresh).astype(np.uint8)
        if novelty_mask is not None:
            mask &= novelty_mask.astype(np.uint8)
        if not mask.any():
            return [], response

        # --- Brick 3: blobs + sub-pixel intensity-weighted centroid ----------
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        dets: list[TargetDetection] = []
        for i in range(1, n):
            area = int(stats[i, cv2.CC_STAT_AREA])
            if area < cfg.min_area:
                continue
            x = int(stats[i, cv2.CC_STAT_LEFT])
            y = int(stats[i, cv2.CC_STAT_TOP])
            bw = int(stats[i, cv2.CC_STAT_WIDTH])
            bh = int(stats[i, cv2.CC_STAT_HEIGHT])
            oversized = (
                (cfg.max_area and area > cfg.max_area)
                or (cfg.max_bbox_size and max(bw, bh) > cfg.max_bbox_size)
            )
            if oversized and not cfg.large_blob_peak:
                continue
            sub_lab = labels[y:y + bh, x:x + bw] == i
            sub_resp = response[y:y + bh, x:x + bw]

            # A distant aircraft and its contrail can become one long connected
            # component. Tracking that component's centroid follows the trail,
            # not the aircraft. Collapse it to a compact weighted neighbourhood
            # around its strongest response instead.
            if oversized and cfg.large_blob_peak:
                local = np.where(sub_lab, sub_resp, 0)
                pj, pi = np.unravel_index(int(np.argmax(local)), local.shape)
                r = 3
                y0, y1 = max(0, pj - r), min(bh, pj + r + 1)
                x0, x1 = max(0, pi - r), min(bw, pi + r + 1)
                peak_lab = sub_lab[y0:y1, x0:x1]
                peak_resp = sub_resp[y0:y1, x0:x1]
                weights = np.where(peak_lab, peak_resp, 0.0).astype(np.float64)
                wsum = float(weights.sum())
                if wsum <= 1e-9:
                    continue
                ys, xs = np.mgrid[y0:y1, x0:x1]
                cu = x + float((xs * weights).sum() / wsum)
                cv_ = y + float((ys * weights).sum() / wsum)
                score = float(sub_resp[pj, pi])
                dets.append(TargetDetection(
                    cu, cv_, score, int(peak_lab.sum()), cfg.polarity,
                    (x + x0, y + y0, x1 - x0, y1 - y0),
                ))
                continue

            w = np.where(sub_lab, sub_resp, 0.0).astype(np.float64)
            wsum = float(w.sum())
            if wsum <= 1e-9:
                continue
            ys, xs = np.mgrid[0:bh, 0:bw]
            cu = x + float((xs * w).sum() / wsum)
            cv_ = y + float((ys * w).sum() / wsum)
            # Peak (and polarity) at the strongest pixel of the blob.
            local = np.where(sub_lab, sub_resp, -np.inf)
            pj, pi = np.unravel_index(int(np.argmax(local)), local.shape)
            score = float(sub_resp[pj, pi])
            if cfg.polarity == "both":
                pol = "bright" if wth[y + pj, x + pi] >= bth[y + pj, x + pi] else "dark"
            else:
                pol = cfg.polarity
            dets.append(TargetDetection(cu, cv_, score, area, pol, (x, y, bw, bh)))

        # The single clutter filter: keep only detections that coincide with
        # moving foreground. Static structure (a settled contrail, clouds, fixed
        # objects) is background and drops out; movers (aircraft, fast particles)
        # stay. Replaces the old collinear / persistence / tip heuristics.
        if cfg.motion_gate and self._fgmask is not None:
            dets = self._motion_gate(dets)
        dets.sort(key=lambda d: d.score, reverse=True)
        return dets[: cfg.max_targets], response

    def _motion_gate(self, dets: list[TargetDetection]) -> list[TargetDetection]:
        """Keep detections that sit on (or within motion_dilate px of) moving
        foreground. A real flying target moves, so it is foreground; a static
        contrail/cloud is absorbed into the background and gated out."""
        fg = self._fgmask
        h, w = fg.shape
        r = self.cfg.motion_dilate
        kept: list[TargetDetection] = []
        for d in dets:
            x, y = int(round(d.u)), int(round(d.v))
            x0, x1 = max(0, x - r), min(w, x + r + 1)
            y0, y1 = max(0, y - r), min(h, y + r + 1)
            window = fg[y0:y1, x0:x1]
            if window.size and int(window.max()) > 0:
                kept.append(d)
        return kept


def synthesize_frame(
    t: int,
    w: int = 320,
    h: int = 240,
    amp: float = 20.0,
    sigma_px: float = 1.3,
    noise: float = 2.5,
    rng: "np.random.Generator | None" = None,
) -> tuple[np.ndarray, tuple[float, float]]:
    """Synthetic test frame for the self-test.

    A slowly drifting low-frequency background ("sky") + sensor noise + one
    faint moving Gaussian blob at a known position. Returns
    (gray_f32, (true_u, true_v)).
    """
    if rng is None:
        rng = np.random.default_rng(0)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    phase = t * 0.03
    bg = (
        128.0
        + 30.0 * np.sin(xs / w * np.pi + phase)
        + 20.0 * np.cos(ys / h * np.pi - phase * 0.7)
    )
    img = bg + rng.normal(0.0, noise, size=(h, w)).astype(np.float32)
    frac = (t % 100) / 100.0
    tu = 0.18 * w + 0.64 * w * frac
    tv = 0.30 * h + 0.40 * h * frac
    blob = amp * np.exp(-(((xs - tu) ** 2 + (ys - tv) ** 2) / (2.0 * sigma_px ** 2)))
    img = img + blob
    return np.clip(img, 0.0, 255.0).astype(np.float32), (float(tu), float(tv))
