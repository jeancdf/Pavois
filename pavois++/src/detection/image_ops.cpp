#include "pavois/detection/image_ops.hpp"

#include "pavois/util/parallel_executor.hpp"

#include <algorithm>

#if defined(__ARM_NEON) || defined(__ARM_NEON__)
#include <arm_neon.h>
#define PAVOIS_HAS_NEON 1
#else
#define PAVOIS_HAS_NEON 0
#endif

namespace pavois {
namespace {

// The scratch belongs to the CameraWorker that called the operation. Workers
// only receive references to it and write disjoint ranges between barriers.
thread_local std::vector<std::uint16_t> t_acc;
thread_local std::vector<std::uint8_t> t_scratch;

template <typename Function>
void for_each_range(ParallelExecutor* executor, std::size_t begin,
                    std::size_t end, Function&& function) {
    if (executor != nullptr && executor->thread_count() > 1) {
        executor->for_each_range(begin, end, function);
    } else {
        function(begin, end);
    }
}

}  // namespace

void box_blur(const std::vector<std::uint8_t>& src,
              std::vector<std::uint8_t>& out, int width, int height,
              int radius, ParallelExecutor* executor) {
    if (radius <= 0 || width <= 0 || height <= 0) {
        out = src;
        return;
    }
    out.resize(src.size());
    const int win = 2 * radius + 1;
    t_acc.resize(src.size());
    auto& acc = t_acc;

    for_each_range(executor, 0, static_cast<std::size_t>(height),
                   [&](std::size_t first, std::size_t last) {
        for (std::size_t y = first; y < last; ++y) {
            const std::size_t row = y * static_cast<std::size_t>(width);
            int sum = 0;
            for (int x = -radius; x <= radius; ++x) {
                sum += src[row + static_cast<std::size_t>(
                    std::clamp(x, 0, width - 1))];
            }
            for (int x = 0; x < width; ++x) {
                acc[row + static_cast<std::size_t>(x)] =
                    static_cast<std::uint16_t>(sum / win);
                sum += src[row + static_cast<std::size_t>(
                    std::clamp(x + radius + 1, 0, width - 1))];
                sum -= src[row + static_cast<std::size_t>(
                    std::clamp(x - radius, 0, width - 1))];
            }
        }
    });

    // The deployed detector uses radius 1. A row-major vertical pass keeps all
    // three source rows hot in cache and is exactly equivalent to the sliding
    // column sum, without its cache-unfriendly full-height strides.
    if (radius == 1) {
        for_each_range(executor, 0, static_cast<std::size_t>(height),
                       [&](std::size_t first, std::size_t last) {
            for (std::size_t y = first; y < last; ++y) {
                const std::size_t row = y * static_cast<std::size_t>(width);
                const std::size_t up = (y > 0 ? y - 1 : 0) *
                                       static_cast<std::size_t>(width);
                const std::size_t down = std::min<std::size_t>(
                                             static_cast<std::size_t>(height - 1), y + 1) *
                                         static_cast<std::size_t>(width);
                for (int x = 0; x < width; ++x) {
                    const std::size_t xi = static_cast<std::size_t>(x);
                    out[row + xi] = static_cast<std::uint8_t>(
                        (acc[up + xi] + acc[row + xi] + acc[down + xi]) / 3);
                }
            }
        });
        return;
    }

    // General radii retain the exact scalar sliding accumulation order.
    for_each_range(executor, 0, static_cast<std::size_t>(width),
                   [&](std::size_t first, std::size_t last) {
        for (std::size_t x = first; x < last; ++x) {
            int sum = 0;
            for (int y = -radius; y <= radius; ++y) {
                sum += acc[static_cast<std::size_t>(
                               std::clamp(y, 0, height - 1)) *
                               static_cast<std::size_t>(width) + x];
            }
            for (int y = 0; y < height; ++y) {
                out[static_cast<std::size_t>(y) * width + x] =
                    static_cast<std::uint8_t>(sum / win);
                sum += acc[static_cast<std::size_t>(
                               std::clamp(y + radius + 1, 0, height - 1)) *
                               static_cast<std::size_t>(width) + x];
                sum -= acc[static_cast<std::size_t>(
                               std::clamp(y - radius, 0, height - 1)) *
                               static_cast<std::size_t>(width) + x];
            }
        }
    });
}

namespace {

// Repeating a 3x3 min/max N times is exactly a square min/max of radius N.
// Collapsing the repetitions avoids intermediate full-frame writes while
// preserving the byte-for-byte mask. Each half-pass still has a barrier.
template <bool Erode>
void morph_pass(std::vector<std::uint8_t>& mask, int width, int height,
                int radius, ParallelExecutor* executor) {
    auto op = [](std::uint8_t a, std::uint8_t b) {
        return Erode ? std::min(a, b) : std::max(a, b);
    };
    t_scratch.resize(mask.size());
    auto& scratch = t_scratch;

    for_each_range(executor, 0, static_cast<std::size_t>(height),
                   [&](std::size_t first, std::size_t last) {
        for (std::size_t y = first; y < last; ++y) {
            const std::size_t row = y * static_cast<std::size_t>(width);
            int x = 0;
#if PAVOIS_HAS_NEON
            for (; x < std::min(radius, width); ++x) {
                std::uint8_t value = mask[row + static_cast<std::size_t>(x)];
                for (int dx = 1; dx <= radius; ++dx) {
                    if (x - dx >= 0) {
                        value = op(value, mask[row + static_cast<std::size_t>(x - dx)]);
                    }
                    if (x + dx < width) {
                        value = op(value, mask[row + static_cast<std::size_t>(x + dx)]);
                    }
                }
                scratch[row + static_cast<std::size_t>(x)] = value;
            }
            for (; x + 15 + radius < width; x += 16) {
                const std::size_t i = row + static_cast<std::size_t>(x);
                uint8x16_t value = vld1q_u8(mask.data() + i);
                for (int dx = 1; dx <= radius; ++dx) {
                    const uint8x16_t left =
                        vld1q_u8(mask.data() + i - static_cast<std::size_t>(dx));
                    const uint8x16_t right =
                        vld1q_u8(mask.data() + i + static_cast<std::size_t>(dx));
                    if constexpr (Erode) {
                        value = vminq_u8(value, left);
                        value = vminq_u8(value, right);
                    } else {
                        value = vmaxq_u8(value, left);
                        value = vmaxq_u8(value, right);
                    }
                }
                vst1q_u8(scratch.data() + i, value);
            }
#endif
            for (; x < width; ++x) {
                const std::size_t i = row + static_cast<std::size_t>(x);
                std::uint8_t value = mask[i];
                for (int dx = 1; dx <= radius; ++dx) {
                    if (x - dx >= 0) {
                        value = op(value, mask[row + static_cast<std::size_t>(x - dx)]);
                    }
                    if (x + dx < width) {
                        value = op(value, mask[row + static_cast<std::size_t>(x + dx)]);
                    }
                }
                scratch[i] = value;
            }
        }
    });

    for_each_range(executor, 0, static_cast<std::size_t>(height),
                   [&](std::size_t first, std::size_t last) {
        for (std::size_t y = first; y < last; ++y) {
            const std::size_t row = y * static_cast<std::size_t>(width);
            int x = 0;
#if PAVOIS_HAS_NEON
            for (; x + 15 < width; x += 16) {
                const std::size_t i = row + static_cast<std::size_t>(x);
                uint8x16_t value = vld1q_u8(scratch.data() + i);
                for (int dy = 1; dy <= radius; ++dy) {
                    if (y >= static_cast<std::size_t>(dy)) {
                        const uint8x16_t up = vld1q_u8(
                            scratch.data() + i - static_cast<std::size_t>(dy * width));
                        if constexpr (Erode) value = vminq_u8(value, up);
                        else value = vmaxq_u8(value, up);
                    }
                    if (y + static_cast<std::size_t>(dy) <
                        static_cast<std::size_t>(height)) {
                        const uint8x16_t down = vld1q_u8(
                            scratch.data() + i + static_cast<std::size_t>(dy * width));
                        if constexpr (Erode) value = vminq_u8(value, down);
                        else value = vmaxq_u8(value, down);
                    }
                }
                vst1q_u8(mask.data() + i, value);
            }
#endif
            for (; x < width; ++x) {
                const std::size_t i = row + static_cast<std::size_t>(x);
                std::uint8_t value = scratch[i];
                for (int dy = 1; dy <= radius; ++dy) {
                    if (y >= static_cast<std::size_t>(dy)) {
                        value = op(value, scratch[
                            i - static_cast<std::size_t>(dy * width)]);
                    }
                    if (y + static_cast<std::size_t>(dy) <
                        static_cast<std::size_t>(height)) {
                        value = op(value, scratch[
                            i + static_cast<std::size_t>(dy * width)]);
                    }
                }
                mask[i] = value;
            }
        }
    });
}

}  // namespace

void erode(std::vector<std::uint8_t>& mask, int width, int height,
           int iterations, ParallelExecutor* executor) {
    if (iterations > 0) morph_pass<true>(mask, width, height, iterations, executor);
}

void dilate(std::vector<std::uint8_t>& mask, int width, int height,
            int iterations, ParallelExecutor* executor) {
    if (iterations > 0) morph_pass<false>(mask, width, height, iterations, executor);
}

void morph_open(std::vector<std::uint8_t>& mask, int width, int height,
                int iterations, ParallelExecutor* executor) {
    if (iterations <= 0) return;
    erode(mask, width, height, iterations, executor);
    dilate(mask, width, height, iterations, executor);
}

void morph_close(std::vector<std::uint8_t>& mask, int width, int height,
                 int iterations, ParallelExecutor* executor) {
    if (iterations <= 0) return;
    dilate(mask, width, height, iterations, executor);
    erode(mask, width, height, iterations, executor);
}

}  // namespace pavois
