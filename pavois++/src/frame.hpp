#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace pavois {

struct GrayFrame {
    int width = 0;
    int height = 0;
    std::vector<std::uint8_t> pixels;

    std::size_t size() const {
        return pixels.size();
    }

    bool empty() const {
        return pixels.empty();
    }
};

}  // namespace pavois

