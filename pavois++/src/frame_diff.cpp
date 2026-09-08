#include "pavois/detection/frame_diff.hpp"

#include <cstdlib>

namespace pavois {

FrameDiffResult detect_pixel_changes(
    const GrayFrame& current,
    const GrayFrame& previous,
    std::uint8_t threshold) {
    FrameDiffResult result;

    if (current.width != previous.width ||
        current.height != previous.height ||
        current.size() == 0 ||
        previous.size() == 0) {
        return result;
    }

    const std::size_t count = current.size();
    result.diff_mask.assign(count, 0);

    for (std::size_t i = 0; i < count; ++i) {
        const int diff = std::abs(
            static_cast<int>(current.pixels[i]) - static_cast<int>(previous.pixels[i]));
        if (diff > static_cast<int>(threshold)) {
            result.diff_mask[i] = 255;
            ++result.changed_pixels;
        }
    }

    return result;
}

}  // namespace pavois
