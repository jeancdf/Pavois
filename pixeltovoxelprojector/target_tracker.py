#!/usr/bin/env python3
"""
Multi-target tracker (Phase 2) — link per-frame detections into tracks.

A single weak detection is unreliable; a *track* (a coherent trajectory over
several frames) is far more trustworthy. This turns the stream of
`TargetDetection`s from `small_target_detector.py` into tracks, and only
"confirms" a track once it has been seen repeatedly AND has actually moved like
an object.

Why this kills the classic false positives (e.g. a flickering wire/cable): a
wire shimmers *in place*, so it never builds up enough travel to be confirmed.
Random sensor speckle lands at random spots, so it never associates into a
stable track either. A real mover associates frame after frame and gets
confirmed. (See documentation/plan-detection-drones.md, Phase 2.)

OpenCV-free / torch-free: pure Python + a tiny alpha-beta filter.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass


@dataclass
class TrackerConfig:
    gate_radius: float = 40.0     # association gate for a fresh track (velocity unknown)
    gate_track: float = 14.0      # base gate once velocity is established...
    gate_speed_k: float = 2.0     # ...widened by this * speed (fast movers need a wider gate)
    gate_max: float = 140.0       # cap on the established gate
    confirm_hits: int = 3         # need this many hits...
    confirm_window: int = 5       # ...within the last N updates (M-of-N)
    confirm_travel: float = 6.0   # ...this much net displacement (rejects in-place flicker)...
    confirm_resid: float = 6.0    # ...this small an avg residual (rejects erratic clutter)...
    confirm_straight: float = 0.5 # ...and net_disp >= this * path_length (rejects wandering)
    max_coast: int = 8            # delete after this many consecutive misses
    alpha: float = 0.5            # position correction gain (alpha-beta filter)
    beta: float = 0.25            # velocity correction gain
    trail_len: int = 30


@dataclass
class Track:
    id: int
    u: float
    v: float
    vu: float
    vv: float
    score: float
    polarity: str
    u0: float
    v0: float
    lu: float
    lv: float
    max_disp: float
    path_len: float
    resid_avg: float
    hits: int
    misses: int
    age: int
    recent: deque
    trail: deque
    confirmed: bool = False

    @property
    def status(self) -> str:
        return "confirmed" if self.confirmed else "tentative"

    @property
    def speed(self) -> float:
        return math.hypot(self.vu, self.vv)


class MultiTargetTracker:
    def __init__(self, cfg: TrackerConfig | None = None) -> None:
        self.cfg = cfg or TrackerConfig()
        self.tracks: list[Track] = []
        self._next_id = 1

    def update(self, dets: list) -> list[Track]:
        """dets: list of objects with .u .v .score .polarity. Returns live tracks."""
        cfg = self.cfg

        # 1) Predict (constant velocity, dt = 1 frame).
        for t in self.tracks:
            t.u += t.vu
            t.v += t.vv
            t.age += 1

        # 2) Associate: greedy nearest pairs within the gate.
        pairs = []
        for ti, t in enumerate(self.tracks):
            if t.hits < 2:
                gate = cfg.gate_radius
            else:
                gate = min(cfg.gate_max, cfg.gate_track + cfg.gate_speed_k * t.speed)
            for di, d in enumerate(dets):
                dist = math.hypot(d.u - t.u, d.v - t.v)
                if dist <= gate:
                    pairs.append((dist, ti, di))
        pairs.sort(key=lambda p: p[0])
        matched_t: set[int] = set()
        matched_d: set[int] = set()
        for _, ti, di in pairs:
            if ti in matched_t or di in matched_d:
                continue
            matched_t.add(ti)
            matched_d.add(di)
            self._update_track(self.tracks[ti], dets[di])

        # 3) Unmatched tracks coast (keep predicting).
        for ti, t in enumerate(self.tracks):
            if ti not in matched_t:
                t.misses += 1
                t.recent.append(0)
                t.trail.append((t.u, t.v))

        # 4) Unmatched detections spawn new tentative tracks.
        for di, d in enumerate(dets):
            if di not in matched_d:
                self._spawn(d)

        # 5) Prune dead tracks.
        self.tracks = [t for t in self.tracks if t.misses <= cfg.max_coast]
        return self.tracks

    def confirmed_tracks(self) -> list[Track]:
        return [t for t in self.tracks if t.confirmed]

    def _spawn(self, d) -> None:
        cfg = self.cfg
        t = Track(
            id=self._next_id, u=d.u, v=d.v, vu=0.0, vv=0.0,
            score=d.score, polarity=d.polarity,
            u0=d.u, v0=d.v, lu=d.u, lv=d.v, max_disp=0.0, path_len=0.0, resid_avg=0.0,
            hits=1, misses=0, age=0,
            recent=deque([1], maxlen=cfg.confirm_window),
            trail=deque([(d.u, d.v)], maxlen=cfg.trail_len),
        )
        self._next_id += 1
        self.tracks.append(t)

    def _update_track(self, t: Track, d) -> None:
        cfg = self.cfg
        ru = d.u - t.u  # residual: measurement - prediction
        rv = d.v - t.v
        if t.hits == 1:
            # Two-point initialisation: snap to the measurement and seed the
            # velocity from the observed one-frame displacement, so a fast mover
            # gets a usable velocity immediately (otherwise the prediction lags
            # and the next detection falls outside the gate).
            t.u, t.v = d.u, d.v
            t.vu, t.vv = ru, rv
        else:
            t.u += cfg.alpha * ru
            t.v += cfg.alpha * rv
            t.vu += cfg.beta * ru
            t.vv += cfg.beta * rv
            t.resid_avg = 0.6 * t.resid_avg + 0.4 * math.hypot(ru, rv)
        t.score = 0.6 * t.score + 0.4 * d.score
        t.polarity = d.polarity
        t.hits += 1
        t.misses = 0
        t.recent.append(1)
        t.trail.append((t.u, t.v))
        t.path_len += math.hypot(t.u - t.lu, t.v - t.lv)
        t.lu, t.lv = t.u, t.v
        t.max_disp = max(t.max_disp, math.hypot(t.u - t.u0, t.v - t.v0))
        straight = t.max_disp >= cfg.confirm_straight * t.path_len
        # Residual tolerance grows with speed: a fast mover's prediction lags
        # while velocity converges, but that residual is small *relative* to its
        # motion (unlike erratic clutter).
        resid_ok = t.resid_avg <= cfg.confirm_resid + 0.5 * t.speed
        if (not t.confirmed
                and sum(t.recent) >= cfg.confirm_hits
                and t.max_disp >= cfg.confirm_travel
                and resid_ok
                and straight):
            t.confirmed = True


# ---------------------------------------------------------------------------
# Self-test (no camera): a coherent mover gets confirmed; in-place flicker and
# random speckle do NOT.
# ---------------------------------------------------------------------------
@dataclass
class _D:
    u: float
    v: float
    score: float = 30.0
    polarity: str = "bright"


def _self_test() -> int:
    import random

    rng = random.Random(0)

    # A) a coherent mover -> one confirmed track that follows it.
    trk = MultiTargetTracker()
    follow_err = []
    confirmed_seen = False
    for t in range(40):
        u, v = 50.0 + 2.0 * t, 60.0 + 1.0 * t
        tracks = trk.update([_D(u + rng.uniform(-0.5, 0.5), v + rng.uniform(-0.5, 0.5))])
        conf = [x for x in tracks if x.confirmed]
        if conf:
            confirmed_seen = True
            best = min(conf, key=lambda c: math.hypot(c.u - u, c.v - v))
            follow_err.append(math.hypot(best.u - u, best.v - v))
    mover_ok = confirmed_seen and follow_err and (sum(follow_err) / len(follow_err) < 3.0)

    # B) a wire flickering in place -> never confirmed (no travel).
    trk2 = MultiTargetTracker()
    flicker_confirmed = 0
    for t in range(60):
        dets = [_D(120.0 + rng.uniform(-1, 1), 90.0 + rng.uniform(-1, 1))] if t % 2 == 0 else []
        tk = trk2.update(dets)
        flicker_confirmed = max(flicker_confirmed, len([x for x in tk if x.confirmed]))
    flicker_ok = flicker_confirmed == 0

    # C) sparse random false alarms (~ the detector's real rate, <=1/frame) ->
    # never confirmed. NOTE: very dense uniform clutter (many strong random
    # detections every frame) can occasionally form a spurious track (~density/3
    # over 60 frames); that regime is a Phase 5 concern (AI clutter rejection).
    trk3 = MultiTargetTracker()
    speckle_confirmed = 0
    for _ in range(60):
        dets = [_D(rng.uniform(0, 320), rng.uniform(0, 240))]
        tk = trk3.update(dets)
        speckle_confirmed = max(speckle_confirmed, len([x for x in tk if x.confirmed]))
    speckle_ok = speckle_confirmed == 0

    # D) indoor-fast profile: more than 40 px between frames must still form
    # one confirmed track instead of spawning a new tentative track each time.
    fast_cfg = TrackerConfig(
        gate_radius=200.0,
        gate_track=60.0,
        gate_speed_k=2.0,
        gate_max=300.0,
        confirm_hits=2,
        confirm_window=4,
        confirm_travel=10.0,
    )
    trk4 = MultiTargetTracker(fast_cfg)
    fast_confirmed = False
    fast_track_ids: set[int] = set()
    for t in range(5):
        tracks = trk4.update([_D(30.0 + 55.0 * t, 80.0 + 4.0 * t)])
        fast_track_ids.update(x.id for x in tracks if x.hits > 1)
        fast_confirmed = fast_confirmed or any(x.confirmed for x in tracks)
    fast_ok = fast_confirmed and len(fast_track_ids) == 1

    print(f"mover_ok={mover_ok} flicker_confirmed={flicker_confirmed} "
          f"speckle_confirmed={speckle_confirmed} fast_mover_ok={fast_ok}")
    if mover_ok and flicker_ok and speckle_ok and fast_ok:
        print("TRACKER_SELF_TEST_OK")
        return 0
    print("TRACKER_SELF_TEST_FAIL")
    return 1


if __name__ == "__main__":
    raise SystemExit(_self_test())
