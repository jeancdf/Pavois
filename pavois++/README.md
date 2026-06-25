# Pavois++

Minimal C++ migration for PAVOIS.

## MVP 1

This step only validates camera integration:

- open a Linux V4L2 camera
- read frames
- convert YUYV to grayscale
- store pixels in a buffer
- print basic frame stats

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
- Uses `pavois++.conf` for device, resolution, and detection thresholds.
- Prints detection events as JSON lines on stdout.
- Prints human-readable status on stderr.
