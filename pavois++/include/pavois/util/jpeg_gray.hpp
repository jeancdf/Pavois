#pragma once

#include "pavois/domain/frame.hpp"

#include <cstdint>
#include <vector>

namespace pavois {

GrayFrame downscale_gray(const GrayFrame& src, int max_width);

// Baseline grayscale JPEG. quality is 1–100 (libjpeg-style).
bool encode_gray_jpeg(const GrayFrame& src, int quality,
                      std::vector<std::uint8_t>& out);

}  // namespace pavois
