# Pavois++

Minimal C++ migration for PAVOIS.

## Raspberry Pi deployment

See [DEPLOYMENT_PI.md](DEPLOYMENT_PI.md) for local CSI capture, per-Pi
configuration, systemd installation and automatic deployment from GitHub Actions.
Set `camera.0.device=csi:0` to capture camera 0 locally through `rpicam-vid`
and FFmpeg; `camera.0.fps` sets its capture rate (default 30). Full-frame
detector passes use `processing_threads=3` by default.

## Runtime

The current C++ MVP is structured for the Raspberry Pi target:

- one thread per camera
- each thread captures frames locally
- each thread computes pixel change and blobs
- each thread creates a camera observation
- a shared fusion engine merges observations into a 3D track
- only the fused track is emitted toward the VPS

## Build

```bash
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure   # pavois_selftest + pavois_accuracy
```

## Run

```bash
./build/pavois_detect
./build/pavois_detect --config pavois++.conf
./build/pavois_detect --config pavois++.conf --host 127.0.0.1 --port 5005
./build/pavois_detect --config pavois++.conf --debug-dir /tmp/pavois_debug
```

## Try it without cameras (synthetic replay)

```bash
./build/pavois_gen_scene /tmp/scene 300
./build/pavois_detect --config /tmp/scene/scene.conf --frames 300
```

`pavois_gen_scene` renders a moving target into three virtual cameras (noise,
lighting drift, static distractors) and writes a matching `scene.conf`. Any
`camera.N.device` that is a directory of `.pgm` frames (optionally with a
`fps.txt`) is replayed as a live source.

## Tests & accuracy (no camera needed)

```bash
./build/pavois_selftest      # 150+ unit/integration checks (linalg, Kalman, image
                             # ops, geometry, triangulation, tracker, fusion, replay)
./build/pavois_accuracy      # scorecard: 16 synthetic scenarios -> accuracy %
```

`pavois_accuracy` renders each scenario (sensor noise, low contrast, lighting
drift, exposure steps, camera dropout, 2-camera-only, fast/hovering targets,
heading miscalibration, lens distortion, occlusion gap, far/wide and tight
geometry), runs the full pipeline against ground truth, and reports:

- **detection** — recall, precision, and % of centroids within pixel tolerance
- **fusion** — availability, % of updates within 2 m / 5 m, and *relative*
  accuracy `1 - error/range` (fair across near and far targets)
- **track continuity** — one ID per real target
- a blended **OVERALL PIPELINE ACCURACY %**, plus a false-alarm rate on an
  empty scene

It exits non-zero (CI gate) if the overall score, any scenario, or the
false-alarm rate crosses its threshold. Current baseline on the synthetic
battery: **~93% overall**, detection F1 ~99%, mean 3D error ~1.7 m at ~25 m
range, 0% false alarms. Add scenarios in `tests/scene_sim.hpp` /
`tests/accuracy.cpp`.

## Detection pipeline

Each camera runs a background-subtraction detector (running-average background,
adaptive per-pixel threshold, morphology, blob filtering + scoring, a 2D Kalman
filter on the centroid, and M-of-N confirmation). The fusion stage time-aligns
observations, back-projects them with per-camera intrinsics + radial distortion +
a compass-heading/elevation model, triangulates with parallax/residual gates and
leave-one-out RANSAC, and runs a constant-velocity tracker. See
`IMPROVEMENT_PLAN.md` and `ARCHITECTURE.md`.

Detector and fusion behaviour is tunable per camera / globally in
`pavois++.conf`; `--debug-dir` dumps `*_raw.pgm`, `*_mask.pgm` and
`*_overlay.pgm` for visual tuning.

## Notes

- No OpenCV.
- Uses `pavois++.conf` for camera pose, resolution, thresholds, and fusion window.
- Output is a compact CSV-like track line, not JSON.
- The Pi-side binary is only the acquisition + fusion stage; the VPS will do pattern recognition later.
- If `output_host` and `output_port` are set, the same track line is also sent over UDP.
- If `camera.N.device` starts with `rtsp://`, `http://`, or `https://`, the app uses `ffmpeg` to decode the stream into grayscale frames.
- That means the machine running `pavois_detect` needs `ffmpeg` installed when you use iPhone network streams.

## iPhone Cameras

To test with iPhones, use an iOS app that exposes the camera as an RTSP stream, then paste that RTSP URL into `camera.N.device`.

Example:

```ini
camera.0.device=rtsp://192.168.137.23:8554/live
camera.0.enabled=true
camera.1.device=rtsp://192.168.137.24:8554/live
camera.1.enabled=true
```

You can keep the rest of the pipeline unchanged.

## GPS Demo Mode

If you prefer a simpler demo setup, you can provide rough GPS positions instead of manual pose values.

Use these fields:

- `reference_lat`
- `reference_lon`
- `reference_alt`
- `camera.N.gps_lat`
- `camera.N.gps_lon`
- `camera.N.gps_alt`
- `camera.N.heading_deg`

The loader converts the GPS coordinates into local meters automatically and uses `heading_deg` as the camera yaw.
If no reference is set, the first camera with GPS becomes the local origin.
The fusion engine rejects bad solutions using geometry checks: ray direction consistency, front-of-camera validation, and reprojection residual.

The front-end output should be treated as:

```text
objN,lat,lon,alt,timestamp_us
```

The local fusion step still uses an internal local coordinate system, but the front app only receives GPS-style output.
- Errors are written to `stderr`; fused tracks are written to `stdout`.
