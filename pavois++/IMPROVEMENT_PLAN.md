# Pavois++ Detection Accuracy Overhaul

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done

## Problem summary (baseline)

The baseline pipeline detects "so badly" because every stage uses the weakest
possible primitive:

1. **Detection is raw 2-frame differencing** (`src/frame_diff.cpp`): one global
   threshold, no background model, no denoise, no morphology, no temporal
   persistence. A stopped target vanishes; a moving target produces a ghost blob;
   phone auto-exposure / JPEG noise lights up the whole frame.
2. **Blob selection is "largest area"** (`camera_worker.cpp`) and the centroid is
   the centroid of *changed pixels* (motion silhouette), which is biased toward
   the moving edge, not the object center. `border_ignore_px`,
   `min_blob_fill_ratio`, `max_blob_area_ratio` are parsed but never used.
3. **Camera geometry is wrong** (`pose.cpp`): `yaw = heading` mixes compass
   convention (CW from North) with math convention (CCW), so world rays are
   mirrored in the North axis. `pitch`/`roll` are never set, so every ray is
   forced horizontal and altitude is unconstrained. No intrinsic calibration, no
   lens distortion.
4. **Fusion has no real tracker and no time sync** (`fusion_engine.cpp`): it
   triangulates each camera's *latest* blob against other cameras' stale blobs
   (up to `fusion_window_ms` apart), timestamps are taken at detect time not
   capture time, the geometry sanity checks were removed, there is no outlier
   rejection, association gate is 20 m, tracks are never deleted, and it emits
   once per incoming frame per camera.

## Target architecture

```
FrameSource (v4l2 | ffmpeg-network | replay-dir)
      │  GrayFrame + captured_us
      ▼
MotionDetector  (per camera)
  running-average background  →  adaptive foreground mask
  box blur  →  morphology open/close
  connected components  →  blob filters (area, fill, aspect, border)
  blob scoring + temporal continuity  →  2D Kalman on centroid
  M-of-N confirmation
      │  Observation (pixel centroid + quality + intrinsics + pose)
      ▼
FusionEngine (shared)
  per-camera ring buffer of recent observations
  time-align to common fusion timestamp (interpolate pixel track)
  undistort + intrinsic back-projection  →  world rays
  pairwise parallax gate + cheirality gate
  weighted least-squares triangulation + RANSAC (3+ cameras)
  reprojection residual gate
      │  world point + covariance
      ▼
Tracker (shared)
  constant-velocity Kalman filter per track
  Mahalanobis gating + M-of-N confirmation
  coast + delete after K misses + max-speed sanity
      │  TrackUpdate (confirmed only, fixed cadence)
      ▼
event_bus  →  stdout / UDP  (local ENU or GPS CSV)
```

## Phases

### Phase 0 — Foundations & observability
- [x] `IMPROVEMENT_PLAN.md` (this file)
- [x] Capture-time timestamps: `GrayFrame::captured_us`, set the instant a frame
      is produced; carried into `Observation::captured_us`.
- [x] `FrameSource` abstraction + factory: `V4L2Camera`, network (ffmpeg), and a
      new `ReplaySource` that reads a directory of `.pgm` frames (offline replay
      / deterministic tests).
- [x] `DebugSink`: when `debug_dir` is set, dump frame / mask / overlay PGMs
      every `debug_every` frames for visual tuning.
- [x] `image_ops`: box blur, erode, dilate, open, close (separable, Pi-friendly).
- [x] Self-test executable (`pavois_selftest`) wired into CTest.
- [x] Synthetic multi-camera scene generator for end-to-end accuracy checks.

### Phase 1 — Detection quality
- [x] `MotionDetector` with running-average background model; background update
      is slowed where foreground is currently asserted (hovering target does not
      dissolve).
- [x] Adaptive threshold: `base + k · running noise estimate`.
- [x] Pre-blur + morphological open/close on the mask.
- [x] Real blob filters wired from config: `min_blob_area`, `max_blob_area_ratio`,
      `min_blob_fill_ratio`, `border_ignore_px`, plus aspect-ratio sanity.
- [x] Blob scoring (area, fill, motion energy, continuity with previous frame);
      keep best candidate (structure supports top-K).
- [x] 2D constant-velocity Kalman filter on the chosen centroid → denoised,
      sub-pixel measurement.
- [x] M-of-N confirmation before an `Observation` is emitted.
- [x] Physically meaningful `Observation::quality` in [0,1].

### Phase 2 — Camera geometry
- [x] Intrinsics per camera: `fx, fy, cx, cy` with FOV fallback.
- [x] Radial distortion `k1, k2` with iterative undistortion.
- [x] Correct world-ray construction from compass `heading_deg` + `elevation_deg`
      (ENU): forward/right/up basis, image-y-down handled explicitly.
- [x] `project_world_to_pixel` for reprojection residuals and synthetic tests.
- [x] Geometry self-tests: project → triangulate round-trip within tolerance.

### Phase 3 — Fusion & tracking
- [x] Per-camera observation ring buffer; time-align to a common fusion instant.
- [x] Restore + strengthen gates: cheirality (in front of every camera),
      pairwise parallax `fusion_min_parallax_deg`, reprojection residual
      `fusion_max_residual_m`.
- [x] Confidence-weighted least-squares triangulation.
- [x] RANSAC / leave-one-out camera rejection for 3+ cameras.
- [x] `Tracker`: constant-velocity KF, Mahalanobis gate, M-of-N confirm,
      coast + delete, `track_max_speed_mps` sanity.
- [x] Emit confirmed tracks on a fixed `fusion_emit_interval_ms` cadence, not per
      frame.

### Phase 4 — Capture robustness
- [x] Network stream: drop backlog and process only the freshest frame; auto
      reconnect with backoff instead of killing the worker.
- [x] ffmpeg low-latency flags.

### Phase 5 — Config, docs, validation
- [x] All new knobs parsed, documented, defaulted for backward compatibility.
- [x] `pavois++.conf` updated with tuned defaults + comments.
- [x] `README.md` / `ARCHITECTURE.md` updated.
- [x] End-to-end synthetic accuracy test asserts fused-track error is small and
      dramatically better than the baseline differencing detector on the same
      scene.

## Results (synthetic 3-camera scene, `pavois_selftest`)

| Metric | Baseline (2-frame diff + largest blob) | New pipeline |
| --- | --- | --- |
| Per-camera centroid error | 4.12 px | **1.43 px** |
| Fused 3D track error (mean) | track fragments / no stable output | **1.34 m** |
| Fused 3D track error (tail window) | — | **1.33 m** |
| Track identity | churns / spurious tracks | single stable track |

92/92 self-test checks pass (`ctest`). End-to-end run of `pavois_detect` on the
generated `scene.conf` produces one continuous track with triangulation residual
~0.05 m and ~25° parallax.

## Validation method

Because live phone cameras are not available in this environment, correctness is
proven with:

- **Unit self-tests** (`pavois_selftest`) for image ops, geometry round-trip,
  triangulation, Kalman filters, and the tracker.
- **Synthetic end-to-end test**: a virtual moving target is rendered into 3
  virtual cameras (with noise, JPEG-like blocking, and lighting drift). The full
  pipeline runs on the rendered frames; the test asserts the fused 3D track
  follows ground truth within tolerance, and that the new detector's pixel error
  is far below the baseline detector's on the identical footage.
