#include "pavois/capture/frame_source.hpp"

#include "pavois/capture/camera.hpp"
#include "pavois/capture/replay_source.hpp"

#include <chrono>
#include <filesystem>
#include <string>

namespace pavois {

std::uint64_t wall_clock_us() {
    using clock = std::chrono::system_clock;
    return static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::microseconds>(
            clock::now().time_since_epoch())
            .count());
}

std::unique_ptr<FrameSource> make_frame_source(const CameraConfig& cfg) {
    const std::string& dev = cfg.device;

    if (dev.rfind("replay:", 0) == 0) {
        return std::make_unique<ReplaySource>(dev.substr(7), /*loop=*/true, /*realtime=*/true);
    }

    std::error_code ec;
    if (std::filesystem::is_directory(dev, ec)) {
        return std::make_unique<ReplaySource>(dev, true, true);
    }

    auto cam = std::make_unique<V4L2Camera>(dev, cfg.width, cfg.height);
    cam->set_reconnect(cfg.reconnect_max_attempts, cfg.reconnect_backoff_ms);
    return cam;
}

}  // namespace pavois
