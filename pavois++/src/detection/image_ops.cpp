#include "pavois/detection/image_ops.hpp"

#include <algorithm>

namespace pavois {
namespace {

void box_blur_h(const std::vector<std::uint8_t>& src, std::vector<std::uint16_t>& acc,
                int width, int height, int radius) {
    const int win = 2 * radius + 1;
    for (int y = 0; y < height; ++y) {
        const std::size_t row = static_cast<std::size_t>(y) * width;
        int sum = 0;
        for (int x = -radius; x <= radius; ++x) {
            sum += src[row + std::clamp(x, 0, width - 1)];
        }
        for (int x = 0; x < width; ++x) {
            acc[row + x] = static_cast<std::uint16_t>(sum / win);
            const int add = std::clamp(x + radius + 1, 0, width - 1);
            const int rem = std::clamp(x - radius, 0, width - 1);
            sum += src[row + add] - src[row + rem];
        }
    }
}

}  // namespace

void box_blur(const std::vector<std::uint8_t>& src, std::vector<std::uint8_t>& out,
              int width, int height, int radius) {
    out.assign(src.size(), 0);
    if (radius <= 0 || width <= 0 || height <= 0) {
        out = src;
        return;
    }
    const int win = 2 * radius + 1;
    std::vector<std::uint16_t> acc(src.size(), 0);
    box_blur_h(src, acc, width, height, radius);
    for (int x = 0; x < width; ++x) {
        int sum = 0;
        for (int y = -radius; y <= radius; ++y) {
            sum += acc[static_cast<std::size_t>(std::clamp(y, 0, height - 1)) * width + x];
        }
        for (int y = 0; y < height; ++y) {
            out[static_cast<std::size_t>(y) * width + x] = static_cast<std::uint8_t>(sum / win);
            const int add = std::clamp(y + radius + 1, 0, height - 1);
            const int rem = std::clamp(y - radius, 0, height - 1);
            sum += acc[static_cast<std::size_t>(add) * width + x];
            sum -= acc[static_cast<std::size_t>(rem) * width + x];
        }
    }
}

namespace {

template <bool Erode>
void morph_pass(std::vector<std::uint8_t>& mask, int width, int height) {
    std::vector<std::uint8_t> in = mask;
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            const std::size_t idx = static_cast<std::size_t>(y) * width + x;
            std::uint8_t v = Erode ? 255 : 0;
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    const int nx = x + dx, ny = y + dy;
                    std::uint8_t s = 0;
                    if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
                        s = in[static_cast<std::size_t>(ny) * width + nx];
                    }
                    if (Erode) v = std::min<std::uint8_t>(v, s);
                    else v = std::max<std::uint8_t>(v, s);
                }
            }
            mask[idx] = v;
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
