#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace pavois {

struct GrayFrame {
    int width = 0;
    int height = 0;
    std::uint64_t frame_id = 0;
    // Wall-clock microseconds captured as close as possible to the sensor read.
    // Used by fusion to time-align observations from different cameras.
    std::uint64_t captured_us = 0;
    std::vector<std::uint8_t> pixels;

    std::size_t size() const {
        return pixels.size();
    }

    bool empty() const {
        return pixels.empty();
    }

    std::uint8_t at(int x, int y) const {
        return pixels[static_cast<std::size_t>(y) * static_cast<std::size_t>(width) +
                      static_cast<std::size_t>(x)];
    }
};

}  // namespace pavois
