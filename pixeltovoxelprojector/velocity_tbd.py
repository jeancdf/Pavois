#!/usr/bin/env python3
"""
Velocity-matched Track-Before-Detect (TBD) — the principled mover detector.

Instead of thresholding each frame and then cleaning up clutter with heuristics,
this integrates the detector's response map over the last N frames ALONG a bank
of constant-velocity hypotheses, and thresholds only once at the end.

Why it beats per-frame detection + background subtraction for our case:
  - A real target (an aircraft) translates at a near-constant velocity. Shifted
    and summed at its true velocity, its energy lands on the same pixel every
    frame and ADDS UP -> a sharp peak, even if it is faint in any single frame.
  - A contrail / cloud is static (or merely shimmers in place). Shifted at any
    non-zero velocity it lands on DIFFERENT pixels each frame -> it SMEARS out
    and never forms a peak. We exclude the near-zero velocities, so static
    structure (and the moon) is rejected by construction -- no special-case code.

This is the standard IRST / EO dim-target method (3-D / velocity-matched
filtering). It reuses the top-hat response from `small_target_detector.py` as its
front-end and emits the same `TargetDetection` objects, so the existing tracker
links them into smooth tracks unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None  # type: ignore

from small_target_detector import TargetDetection


@dataclass
class VelocityTBDConfig:
    n_frames: int = 8           # frames integrated together (integration gain ~ this)
    proc_scale: float = 0.5     # integrate at this fraction of input resolution (speed)
    v_min: float = 1.0          # px/frame (at proc scale): exclude near-static (rejects clutter)
    v_max: float = 5.0          # px/frame (at proc scale): fastest mover to integrate
    v_step: float = 1.0         # velocity-bank spacing
    thresh_sigma: float = 9.0   # detection threshold on the integrated map = median + k*MAD
    abs_floor: float = 1.0      # absolute floor on that threshold
    min_area: int = 1           # drop sub-pixel speckle in the integrated map
    nms_radius: int = 5         # merge integrated peaks closer than this (proc-scale px)
    max_targets: int = 20


class VelocityTBD:
    def __init__(self, cfg: VelocityTBDConfig | None = None) -> None:
        if cv2 is None:
            raise RuntimeError("opencv-python is required (pip install opencv-python)")
        self.cfg = cfg or VelocityTBDConfig()
        self._build_bank()
        self.reset()

    def _build_bank(self) -> None:
        cfg = self.cfg
        bank: list[tuple[float, float]] = []
        n = int(round(cfg.v_max / cfg.v_step))
        for iy in range(-n, n + 1):
            for ix in range(-n, n + 1):
                vx, vy = ix * cfg.v_step, iy * cfg.v_step
                sp = (vx * vx + vy * vy) ** 0.5
                if cfg.v_min <= sp <= cfg.v_max + 1e-6:
                    bank.append((vx, vy))
        self.bank = bank

    def reset(self) -> None:
        self.buf: list[np.ndarray] = []
        self.last_map: np.ndarray | None = None  # integrated map (for visualisation)

    def update(self, response_full: np.ndarray) -> list[TargetDetection]:
        """response_full: HxW float (the top-hat response). Returns detections of
        coherent movers (with the contrail / static clutter rejected)."""
        cfg = self.cfg
        scale = cfg.proc_scale
        R = (
            response_full.astype(np.float32)
            if scale >= 0.999
            else cv2.resize(
                response_full.astype(np.float32), None,
                fx=scale, fy=scale, interpolation=cv2.INTER_AREA,
            )
        )
        self.buf.append(R)
        if len(self.buf) > cfg.n_frames:
            self.buf.pop(0)
        if len(self.buf) < cfg.n_frames:
            return []

        # --- velocity-matched integration: align each past frame to the current
        # one assuming the target moved at velocity v, and sum. Keep the best
        # (max) integration over all NON-ZERO velocity hypotheses at every pixel.
        h, w = R.shape
        i0 = self.buf[-1].copy()                  # zero-velocity (static) integration
        for k in range(1, cfg.n_frames):
            i0 += self.buf[-1 - k]
        best = np.full((h, w), -np.inf, dtype=np.float32)
        for vx, vy in self.bank:
            acc = self.buf[-1].copy()
            for k in range(1, cfg.n_frames):
                dx, dy = int(round(k * vx)), int(round(k * vy))
                acc += np.roll(np.roll(self.buf[-1 - k], dy, axis=0), dx, axis=1)
            np.maximum(best, acc, out=best)
        # Moving energy = best moving integration ABOVE the static integration.
        # A static line (even one parallel to a velocity hypothesis) and the moon
        # integrate just as well at v=0, so they cancel; only a real translating
        # target has best >> static and survives.
        best = best - i0
        self.last_map = best

        # --- robust threshold on the integrated map (median + k * MAD) ---------
        flat = best[::4, ::4].ravel()
        med = float(np.median(flat))
        mad = 1.4826 * float(np.median(np.abs(flat - med)))
        thresh = max(cfg.abs_floor, med + cfg.thresh_sigma * mad)
        mask = (best > thresh).astype(np.uint8)
        if not mask.any():
            return []

        inv = 1.0 / scale
        n_lab, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        dets: list[TargetDetection] = []
        for i in range(1, n_lab):
            area = int(stats[i, cv2.CC_STAT_AREA])
            if area < cfg.min_area:
                continue
            x = int(stats[i, cv2.CC_STAT_LEFT])
            y = int(stats[i, cv2.CC_STAT_TOP])
            bw = int(stats[i, cv2.CC_STAT_WIDTH])
            bh = int(stats[i, cv2.CC_STAT_HEIGHT])
            sub = best[y:y + bh, x:x + bw]
            wmask = (labels[y:y + bh, x:x + bw] == i)
            wts = np.where(wmask, sub, 0.0).astype(np.float64)
            wsum = float(wts.sum())
            if wsum <= 1e-9:
                continue
            ys, xs = np.mgrid[0:bh, 0:bw]
            cu = (x + float((xs * wts).sum() / wsum)) * inv  # back to full-res coords
            cv_ = (y + float((ys * wts).sum() / wsum)) * inv
            score = float(sub[wmask].max())
            dets.append(TargetDetection(
                u=cu, v=cv_, score=score, area=int(area * inv * inv),
                polarity="bright", bbox=(int(x * inv), int(y * inv),
                                         int(bw * inv), int(bh * inv)),
            ))
        dets.sort(key=lambda d: d.score, reverse=True)
        return dets[: cfg.max_targets]


# ---------------------------------------------------------------------------
# Self-test (no camera): a coherent mover is detected; a static bright line
# (a fake contrail) and a static blob are NOT.
# ---------------------------------------------------------------------------
def _self_test() -> int:
    cfg = VelocityTBDConfig(n_frames=8, proc_scale=1.0, v_min=1.0, v_max=4.0,
                            v_step=1.0, thresh_sigma=6.0)
    tbd = VelocityTBD(cfg)
    rng = np.random.default_rng(0)
    H, W = 120, 200
    mover_hits = 0
    static_false = 0
    measured = 0
    for t in range(40):
        resp = rng.normal(2.0, 0.5, size=(H, W)).astype(np.float32)
        resp = np.clip(resp, 0, None)
        # static "contrail": a fixed bright diagonal line
        for s in range(0, 80):
            yy, xx = 20 + s // 2, 30 + s
            if 0 <= yy < H and 0 <= xx < W:
                resp[yy, xx] += 25.0
        # static bright blob (a "moon")
        resp[80:86, 150:156] += 30.0
        # a coherent mover at v=(2,1)
        mx, my = 20 + 2 * t, 40 + 1 * t
        if 0 <= my < H and 0 <= mx < W:
            resp[my - 1:my + 2, mx - 1:mx + 2] += 22.0
        dets = tbd.update(resp)
        if t < cfg.n_frames:
            continue
        measured += 1
        # mover detected near its true position?
        if any(abs(d.u - mx) < 4 and abs(d.v - my) < 4 for d in dets):
            mover_hits += 1
        # any detection on the static line or blob = false alarm
        for d in dets:
            on_line = abs((d.v - 20) - (d.u - 30) / 2.0) < 3 and 30 <= d.u <= 110
            on_blob = abs(d.u - 152) < 6 and abs(d.v - 82) < 6
            if on_line or on_blob:
                static_false += 1
    mover_rate = mover_hits / max(1, measured)
    ok = mover_rate >= 0.7 and static_false == 0
    print(f"tbd: mover_detect_rate={mover_rate:.2f} static_false_alarms={static_false} ok={ok}")
    if ok:
        print("VELOCITY_TBD_SELF_TEST_OK")
        return 0
    print("VELOCITY_TBD_SELF_TEST_FAIL")
    return 1


if __name__ == "__main__":
    raise SystemExit(_self_test())
