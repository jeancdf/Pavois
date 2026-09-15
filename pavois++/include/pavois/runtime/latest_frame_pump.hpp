#pragma once

#include "pavois/capture/frame_source.hpp"

#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace pavois {

// Continuously drains the camera into a small reusable buffer pool. Detection
// always receives the newest complete frame; if it falls behind, stale frames
// are replaced instead of building latency in the camera pipe.
class LatestFramePump {
public:
    explicit LatestFramePump(std::unique_ptr<FrameSource> source,
                             std::size_t buffer_count = 4,
                             int capture_cpu = -1);
    ~LatestFramePump();

    LatestFramePump(const LatestFramePump&) = delete;
    LatestFramePump& operator=(const LatestFramePump&) = delete;

    std::shared_ptr<const GrayFrame> wait_next();
    std::uint64_t captured_frames() const { return captured_.load(); }
    std::uint64_t dropped_frames() const { return dropped_.load(); }
    std::string last_error() const;

private:
    void run();

    std::unique_ptr<FrameSource> source_;
    std::vector<std::shared_ptr<GrayFrame>> buffers_;
    std::shared_ptr<GrayFrame> published_;
    std::thread thread_;
    mutable std::mutex mutex_;
    std::condition_variable frame_cv_;
    bool stop_ = false;
    bool ended_ = false;
    std::uint64_t published_sequence_ = 0;
    std::uint64_t consumed_sequence_ = 0;
    std::string last_error_;
    int capture_cpu_ = -1;
    std::atomic<std::uint64_t> captured_{0};
    std::atomic<std::uint64_t> dropped_{0};
};

}  // namespace pavois
