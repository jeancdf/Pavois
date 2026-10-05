#include "pavois/detection/image_ops.hpp"

#include "pavois/util/parallel_executor.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>

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

ImageDiagnostics compute_image_diagnostics(const GrayFrame& frame, const GrayFrame* prev_frame) {
    const auto t_start = std::chrono::steady_clock::now();
    ImageDiagnostics diag;

    if (frame.empty() || frame.width <= 0 || frame.height <= 0) {
        return diag;
    }

    const int width = frame.width;
    const int height = frame.height;
    const int step = (width >= 640) ? 4 : 2;

    double sum = 0.0;
    double sum_sq = 0.0;
    std::size_t count = 0;

    double diff_sum = 0.0;
    const bool has_prev = (prev_frame != nullptr && !prev_frame->empty() &&
                           prev_frame->width == width && prev_frame->height == height);

    for (int y = 0; y < height; y += step) {
        const std::size_t row_offset = static_cast<std::size_t>(y) * width;
        for (int x = 0; x < width; x += step) {
            const std::size_t idx = row_offset + static_cast<std::size_t>(x);
            const double val = static_cast<double>(frame.pixels[idx]);
            sum += val;
            sum_sq += val * val;
            ++count;

            if (has_prev) {
                diff_sum += std::abs(val - static_cast<double>(prev_frame->pixels[idx]));
            }
        }
    }

    if (count > 0) {
        diag.lum_mean = sum / static_cast<double>(count);
        const double variance = (sum_sq / static_cast<double>(count)) - (diag.lum_mean * diag.lum_mean);
        diag.lum_stddev = std::sqrt(std::max(0.0, variance));
        if (has_prev) {
            diag.frame_diff = diff_sum / static_cast<double>(count);
        }
    }

    // 3x3 Laplacian Variance computation
    double lap_sum = 0.0;
    double lap_sum_sq = 0.0;
    std::size_t lap_count = 0;

    for (int y = step; y < height - step; y += step) {
        const std::size_t r = static_cast<std::size_t>(y) * width;
        const std::size_t r_up = static_cast<std::size_t>(y - step) * width;
        const std::size_t r_dn = static_cast<std::size_t>(y + step) * width;

        for (int x = step; x < width - step; x += step) {
            const std::size_t x_idx = static_cast<std::size_t>(x);
            const double center = static_cast<double>(frame.pixels[r + x_idx]);
            const double up     = static_cast<double>(frame.pixels[r_up + x_idx]);
            const double dn     = static_cast<double>(frame.pixels[r_dn + x_idx]);
            const double lf     = static_cast<double>(frame.pixels[r + x_idx - step]);
            const double rg     = static_cast<double>(frame.pixels[r + x_idx + step]);

            const double lap = up + dn + lf + rg - 4.0 * center;
            lap_sum += lap;
            lap_sum_sq += lap * lap;
            ++lap_count;
        }
    }

    if (lap_count > 0) {
        const double lap_mean = lap_sum / static_cast<double>(lap_count);
        diag.laplacian_var = (lap_sum_sq / static_cast<double>(lap_count)) - (lap_mean * lap_mean);
        diag.laplacian_var = std::max(0.0, diag.laplacian_var);
    }

    const auto t_end = std::chrono::steady_clock::now();
    diag.computation_time_ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();

    return diag;
}

}  // namespace pavois

