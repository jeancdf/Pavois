#include "pavois/config/app_config.hpp"
#include "pavois/detection/motion_detector.hpp"
#include "pavois/util/parallel_executor.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {

using Clock = std::chrono::steady_clock;

void mix(std::uint64_t& hash, std::uint64_t value) {
    hash ^= value;
    hash *= 1099511628211ULL;
}

std::vector<pavois::GrayFrame> make_frames(int count, int width, int height) {
    std::vector<pavois::GrayFrame> frames(static_cast<std::size_t>(count));
    std::uint32_t random = 0x12345678U;
    for (int i = 0; i < count; ++i) {
        auto& frame = frames[static_cast<std::size_t>(i)];
        frame.width = width;
        frame.height = height;
        frame.frame_id = static_cast<std::uint64_t>(i);
        frame.captured_us = 1'000'000ULL + static_cast<std::uint64_t>(i) * 33'333ULL;
        frame.pixels.resize(static_cast<std::size_t>(width) * height);
        const int target_x = width / 5 + (i * 11) % (width * 3 / 5);
        const int target_y = height / 2 + static_cast<int>(80.0 * std::sin(i * 0.13));
        const int drift = static_cast<int>(7.0 * std::sin(i * 0.07));
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                random = random * 1664525U + 1013904223U;
                int value = 92 + drift + x / 96 + y / 128 +
                            static_cast<int>((random >> 29U) & 3U) - 1;
                const int dx = x - target_x;
                const int dy = y - target_y;
                if (dx * dx + dy * dy <= 100) value += 120;
                frame.pixels[static_cast<std::size_t>(y) * width + x] =
                    static_cast<std::uint8_t>(std::clamp(value, 0, 255));
            }
        }
    }
    return frames;
}

}  // namespace

int main(int argc, char** argv) {
    const int count = argc > 1 ? std::max(20, std::atoi(argv[1])) : 80;
    const int threads = argc > 2 ? std::clamp(std::atoi(argv[2]), 1, 8) : 1;
    constexpr int width = 1280;
    constexpr int height = 720;
    const auto frames = make_frames(count, width, height);

    pavois::CameraConfig config;
    config.width = width;
    config.height = height;
    pavois::ParallelExecutor executor(threads);
    pavois::MotionDetector detector(config, &executor);

    std::uint64_t hash = 1469598103934665603ULL;
    int blobs = 0;
    int confirmed = 0;
    const auto start = Clock::now();
    for (const auto& frame : frames) {
        const auto result = detector.process(frame);
        blobs += result.has_blob ? 1 : 0;
        confirmed += result.confirmed ? 1 : 0;
        mix(hash, result.has_blob ? 1U : 0U);
        mix(hash, result.confirmed ? 1U : 0U);
        mix(hash, static_cast<std::uint64_t>(result.area));
        std::uint64_t cx = 0, cy = 0;
        std::memcpy(&cx, &result.cx, sizeof(cx));
        std::memcpy(&cy, &result.cy, sizeof(cy));
        mix(hash, cx);
        mix(hash, cy);
    }
    const double seconds = std::chrono::duration<double>(Clock::now() - start).count();
    std::printf("detector_bench resolution=%dx%d frames=%d threads=%d seconds=%.3f fps=%.2f "
                "blobs=%d confirmed=%d hash=%016llx\n",
                width, height, count, threads, seconds, count / seconds, blobs, confirmed,
                static_cast<unsigned long long>(hash));
    return 0;
}
