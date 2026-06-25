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

The current C++ MVP follows this exact runtime:

1. `main.cpp` loads `AppConfig`.
2. One `CameraWorker` thread starts per enabled camera.
3. Each worker opens its own `V4L2Camera`.
4. The worker converts frames to grayscale, computes frame difference, and extracts blobs.
5. The largest blob becomes an `Observation`.
6. `FusionEngine` keeps the most recent observation from each camera.
7. When at least two cameras have observations inside the fusion window, the engine triangulates a 3D point from the camera rays.
8. `event_bus.cpp` formats the fused result as a compact CSV line:
   `object_id,timestamp_us,x,y,z,confidence,camera_ids`

This keeps capture, detection, fusion, and output separated while staying light enough for the Pi.
