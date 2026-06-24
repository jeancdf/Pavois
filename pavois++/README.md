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
./build/pavois_detect --device /dev/video0 --frames 10
```

## Notes

- No OpenCV.
- No motion detection yet.
- No overlay yet.
- Just camera read + image buffer validation.

