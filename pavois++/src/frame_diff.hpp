#pragma once

#include "frame.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace pavois {

struct FrameDiffResult {
    std::vector<std::uint8_t> diff_mask;
    std::size_t changed_pixels = 0;
};

FrameDiffResult detect_pixel_changes(
    const GrayFrame& current,
    const GrayFrame& previous,
    std::uint8_t threshold);

}  // namespace pavois

