# Pavois++ Runtime Architecture

Target runtime for the Raspberry Pi version.

## Goal

Each camera is handled locally on the Pi by its own thread. Every thread:

1. captures frames,
2. converts them to grayscale,
3. computes frame differences,
4. extracts blobs,
5. builds a local observation.

All observations are then merged by a shared fusion engine in the same process.
The fusion layer estimates the 3D position of the object and assigns an object
number. Only the fused track is sent out to the VPS for later processing
such as pattern recognition.

## Runtime flow

```text
camera thread 1 -> local observation \
camera thread 2 -> local observation  -> shared fusion engine -> fused 3D track
camera thread 3 -> local observation /

fused 3D track -> output layer -> VPS -> pattern recognition -> web interface
```

## Why this shape

- No camera-to-camera network hop.
- Lower latency.
- Easier debugging on the Pi.
- Clear separation between capture, detection, fusion, output, and VPS-side processing.

## Data model

Camera threads produce `Observation` values:

- camera id
- frame id
- timestamp
- blob centroid in pixels
- blob area
- confidence
- camera pose

Fusion outputs `TrackUpdate` values:

- object id
- timestamp
- 3D position in ENU
- confidence

The Pi does not run the pattern recognition step. It only forwards fused
tracks to the VPS, where the next stage can enrich the track, classify it,
and expose it to the web interface.

## Config

Camera settings are loaded from `pavois++.conf`. Each camera can define:

- device path
- resolution
- threshold
- minimum blob area
- world pose
- field of view

## Current Implementation

1. `main.cpp` loads `AppConfig` and starts one `CameraWorker` thread per enabled
   camera, plus a shared `FusionEngine`.
2. Each worker opens a `FrameSource` (`make_frame_source`): CSI through
   `rpicam-vid` MJPEG and FFmpeg grayscale, an ffmpeg network stream, V4L2, or a
   `ReplaySource`. Frames are consumed sequentially so temporal confirmation
   and the centroid tracker see the complete ordered stream. CSI frames carry
   libcamera's sensor `FrameWallClock` timestamp. Auto camera controls settle
   before the detector learns its initial background.
3. `MotionDetector` (`src/detection/motion_detector.cpp`) emits every valid
   blob as an `Observation`:
   - short temporal **background warm-up** (no baked-in ghosts),
   - box blur, global-brightness-bias removal (exposure/white-balance drift),
   - **running-average background** + per-pixel adaptive threshold,
   - morphological open/close, connected components,
   - blob filters (area, fill ratio, aspect, border) from config,
   - blob scoring (area, fill, motion energy, temporal continuity),
   - **2D constant-velocity Kalman** on the centroid,
   - **M-of-N confirmation** before anything is emitted.
   Full-frame passes use the established persistent three-way executor and the
   pre-15-September scalar residual/connected-component path.
4. `FusionEngine` buffers a short history per camera and, once per fusion cycle:
   - **time-aligns** each camera's observation to a common instant
     (interpolating the pixel track),
   - back-projects with intrinsics + radial distortion + a correct compass
     heading / elevation model (`src/math/pose.cpp`),
   - **triangulates** (`src/fusion/triangulation.cpp`): weighted least squares,
     cheirality gate, pairwise-parallax gate, per-ray residual gate, and
     leave-one-out RANSAC for 3+ cameras,
   - feeds the point to the **`Tracker`** (`src/fusion/tracker.cpp`):
     constant-velocity Kalman per track, distance gating with a recovery band
     that prevents fragmentation, M-of-N confirmation, coast + delete.
5. Confirmed tracks are emitted on a fixed cadence as
   `obj<id>,x,y,z,timestamp_us` (local) or `obj<id>,lat,lon,alt,timestamp_us`
   (when a GPS reference is set), to stdout and optionally UDP.

`pavois_core` is a static library; `pavois_detect` is the app, `pavois_selftest`
the test suite (CTest), and `pavois_gen_scene` writes a synthetic 3-camera
replay dataset + matching `scene.conf`.
