#include "pavois/detection/image_ops.hpp"

#include <algorithm>

namespace pavois {
namespace {

// Per-thread scratch so the hot detection path does not malloc every frame.
// Each CameraWorker runs on its own thread, so this is safe and contention-free.
thread_local std::vector<std::uint16_t> t_acc;
thread_local std::vector<std::uint8_t> t_scratch;

}  // namespace

void box_blur(const std::vector<std::uint8_t>& src, std::vector<std::uint8_t>& out,
              int width, int height, int radius) {
    if (radius <= 0 || width <= 0 || height <= 0) {
        out = src;
        return;
    }
    out.assign(src.size(), 0);
    const int win = 2 * radius + 1;
    t_acc.assign(src.size(), 0);

    for (int y = 0; y < height; ++y) {
        const std::size_t row = static_cast<std::size_t>(y) * width;
        int sum = 0;
        for (int x = -radius; x <= radius; ++x) sum += src[row + std::clamp(x, 0, width - 1)];
        for (int x = 0; x < width; ++x) {
            t_acc[row + x] = static_cast<std::uint16_t>(sum / win);
            sum += src[row + std::clamp(x + radius + 1, 0, width - 1)];
            sum -= src[row + std::clamp(x - radius, 0, width - 1)];
        }
    }
    for (int x = 0; x < width; ++x) {
        int sum = 0;
        for (int y = -radius; y <= radius; ++y)
            sum += t_acc[static_cast<std::size_t>(std::clamp(y, 0, height - 1)) * width + x];
        for (int y = 0; y < height; ++y) {
            out[static_cast<std::size_t>(y) * width + x] = static_cast<std::uint8_t>(sum / win);
            sum += t_acc[static_cast<std::size_t>(std::clamp(y + radius + 1, 0, height - 1)) * width + x];
            sum -= t_acc[static_cast<std::size_t>(std::clamp(y - radius, 0, height - 1)) * width + x];
        }
    }
}

namespace {

// Separable 3x3 min/max: exact for a square structuring element, O(W*H) not
// O(9*W*H). Horizontal pass mask -> scratch, vertical pass scratch -> mask.
template <bool Erode>
void morph_pass(std::vector<std::uint8_t>& mask, int width, int height) {
    auto op = [](std::uint8_t a, std::uint8_t b) {
        return Erode ? std::min(a, b) : std::max(a, b);
    };
    t_scratch.resize(mask.size());
    for (int y = 0; y < height; ++y) {
        const std::size_t row = static_cast<std::size_t>(y) * width;
        for (int x = 0; x < width; ++x) {
            std::uint8_t v = mask[row + x];
            if (x > 0) v = op(v, mask[row + x - 1]);
            if (x + 1 < width) v = op(v, mask[row + x + 1]);
            t_scratch[row + x] = v;
        }
    }
    for (int y = 0; y < height; ++y) {
        const std::size_t row = static_cast<std::size_t>(y) * width;
        const std::size_t up = row - width;
        const std::size_t down = row + width;
        for (int x = 0; x < width; ++x) {
            std::uint8_t v = t_scratch[row + x];
            if (y > 0) v = op(v, t_scratch[up + x]);
            if (y + 1 < height) v = op(v, t_scratch[down + x]);
            mask[row + x] = v;
        }
    }
}

}  // namespace

void erode(std::vector<std::uint8_t>& mask, int width, int height, int iterations) {
    for (int i = 0; i < iterations; ++i) morph_pass<true>(mask, width, height);
}

void dilate(std::vector<std::uint8_t>& mask, int width, int height, int iterations) {
    for (int i = 0; i < iterations; ++i) morph_pass<false>(mask, width, height);
}

void morph_open(std::vector<std::uint8_t>& mask, int width, int height, int iterations) {
    if (iterations <= 0) return;
    erode(mask, width, height, iterations);
    dilate(mask, width, height, iterations);
}

void morph_close(std::vector<std::uint8_t>& mask, int width, int height, int iterations) {
    if (iterations <= 0) return;
    dilate(mask, width, height, iterations);
    erode(mask, width, height, iterations);
}

}  // namespace pavois
