#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace pavois {

// Lightweight, allocation-conscious image primitives for the Pi.
// All operate on tightly packed row-major buffers of size width*height.

// Separable box blur with the given radius (0 = copy). In-place safe: out may
// alias src only if you pass a scratch buffer; prefer distinct buffers.
void box_blur(const std::vector<std::uint8_t>& src, std::vector<std::uint8_t>& out,
              int width, int height, int radius);

// Binary morphology on a 0/255 mask (3x3, 8-connected). `iterations` passes.
void erode(std::vector<std::uint8_t>& mask, int width, int height, int iterations);
void dilate(std::vector<std::uint8_t>& mask, int width, int height, int iterations);
void morph_open(std::vector<std::uint8_t>& mask, int width, int height, int iterations);
void morph_close(std::vector<std::uint8_t>& mask, int width, int height, int iterations);

}  // namespace pavois
