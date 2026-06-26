# Pavois++

Minimal C++ migration for PAVOIS.

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
```

## Run

```bash
./build/pavois_detect
./build/pavois_detect --config pavois++.conf
./build/pavois_detect --config pavois++.conf --host 127.0.0.1 --port 5005
```

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

The front-end output should be treated as:

```text
objN,lat,lon,alt,timestamp_us
```

The local fusion step still uses an internal local coordinate system, but the front app only receives GPS-style output.
- Errors are written to `stderr`; fused tracks are written to `stdout`.
