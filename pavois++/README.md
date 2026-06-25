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
```

## Notes

- No OpenCV.
- Uses `pavois++.conf` for camera pose, resolution, thresholds, and fusion window.
- Output is a compact CSV-like track line, not JSON.
- The Pi-side binary is only the acquisition + fusion stage; the VPS will do pattern recognition later.
- Errors are written to `stderr`; fused tracks are written to `stdout`.
