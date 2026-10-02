#pragma once

#include "pavois/capture/frame_source.hpp"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace pavois {

class ParallelExecutor;

// Lightweight, allocation-conscious image primitives for the Pi.
// All operate on tightly packed row-major buffers of size width*height.

struct ImageDiagnostics {
    double lum_mean = 0.0;
    double lum_stddev = 0.0;
    double frame_diff = 0.0;
    double laplacian_var = 0.0;
    double computation_time_ms = 0.0;
};

// Computes 5 Hz image diagnostics (luminance, spatial stddev, inter-frame diff, Laplacian variance)
// using std::chrono::steady_clock for timing.
ImageDiagnostics compute_image_diagnostics(const GrayFrame& frame, const GrayFrame* prev_frame);

// Separable box blur with the given radius (0 = copy). In-place safe: out may
// alias src only if you pass a scratch buffer; prefer distinct buffers.
void box_blur(const std::vector<std::uint8_t>& src, std::vector<std::uint8_t>& out,
              int width, int height, int radius,
              ParallelExecutor* executor = nullptr);

// Binary morphology on a 0/255 mask (3x3, 8-connected). `iterations` passes.
void erode(std::vector<std::uint8_t>& mask, int width, int height, int iterations,
           ParallelExecutor* executor = nullptr);
void dilate(std::vector<std::uint8_t>& mask, int width, int height, int iterations,
            ParallelExecutor* executor = nullptr);
void morph_open(std::vector<std::uint8_t>& mask, int width, int height, int iterations,
                ParallelExecutor* executor = nullptr);
void morph_close(std::vector<std::uint8_t>& mask, int width, int height, int iterations,
                 ParallelExecutor* executor = nullptr);

}  // namespace pavois

