#include "pavois/util/debug_sink.hpp"

#include "pavois/capture/replay_source.hpp"  // write_pgm

#include <algorithm>
#include <filesystem>
#include <vector>

namespace pavois {
namespace fs = std::filesystem;

DebugSink::DebugSink(std::string dir, int every, std::string camera_id)
    : dir_(std::move(dir)), every_(std::max(1, every)), cam_(std::move(camera_id)) {
    if (dir_.empty()) return;
    std::error_code ec;
    fs::create_directories(dir_, ec);
    ready_ = !ec;
}

void DebugSink::dump(const GrayFrame& frame, const DetectionResult& det) {
    if (!ready_ || frame.empty()) return;
    if ((counter_++ % static_cast<std::uint64_t>(every_)) != 0) return;

    const std::string stem = dir_ + "/" + cam_ + "_" + std::to_string(frame.frame_id);
    write_pgm(stem + "_raw.pgm", frame.pixels.data(), frame.width, frame.height);

    if (!det.mask.empty() && det.mask_w == frame.width && det.mask_h == frame.height) {
        write_pgm(stem + "_mask.pgm", det.mask.data(), det.mask_w, det.mask_h);
    }

    // Overlay: one bright cross-hair for every valid component.
    if (!det.blobs.empty()) {
        std::vector<std::uint8_t> ov = frame.pixels;
        for (const auto& blob : det.blobs) {
            const int cx = std::clamp(static_cast<int>(blob.cx + 0.5), 0,
                                      frame.width - 1);
            const int cy = std::clamp(static_cast<int>(blob.cy + 0.5), 0,
                                      frame.height - 1);
            for (int d = -12; d <= 12; ++d) {
                const int x = std::clamp(cx + d, 0, frame.width - 1);
                const int y = std::clamp(cy + d, 0, frame.height - 1);
                ov[static_cast<std::size_t>(cy) * frame.width + x] = 255;
                ov[static_cast<std::size_t>(y) * frame.width + cx] = 255;
            }
        }
        write_pgm(stem + "_overlay.pgm", ov.data(), frame.width, frame.height);
    }
}

}  // namespace pavois
