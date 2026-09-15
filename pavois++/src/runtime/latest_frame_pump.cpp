#include "pavois/runtime/latest_frame_pump.hpp"

#include "pavois/domain/observation.hpp"
#include "pavois/util/thread_tuning.hpp"

#include <algorithm>
#include <chrono>

namespace pavois {

LatestFramePump::LatestFramePump(std::unique_ptr<FrameSource> source,
                                 std::size_t buffer_count, int capture_cpu)
    : source_(std::move(source)), capture_cpu_(capture_cpu) {
    buffer_count = std::max<std::size_t>(3, buffer_count);
    buffers_.reserve(buffer_count);
    for (std::size_t i = 0; i < buffer_count; ++i) {
        buffers_.push_back(std::make_shared<GrayFrame>());
    }
    thread_ = std::thread([this] { run(); });
}

LatestFramePump::~LatestFramePump() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stop_ = true;
    }
    frame_cv_.notify_all();
    if (thread_.joinable()) thread_.join();
}

void LatestFramePump::run() {
    if (capture_cpu_ >= 0) pin_current_thread(capture_cpu_);
    while (true) {
        std::shared_ptr<GrayFrame> target;
        while (!target) {
            {
                std::lock_guard<std::mutex> lock(mutex_);
                if (stop_) return;
                for (const auto& candidate : buffers_) {
                    // The pool owns one reference. Any additional reference
                    // means capture, detection, preview or classification is
                    // still using that buffer.
                    if (candidate.use_count() == 1) {
                        target = candidate;
                        break;
                    }
                }
            }
            if (!target) {
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
        }

        if (!source_->read_frame(*target)) {
            std::lock_guard<std::mutex> lock(mutex_);
            last_error_ = source_->last_error();
            ended_ = true;
            frame_cv_.notify_all();
            return;
        }
        const std::uint64_t frame_id = captured_.load();
        target->frame_id = frame_id;
        if (target->captured_us == 0) target->captured_us = wall_clock_us();

        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (stop_) return;
            if (published_sequence_ > consumed_sequence_) {
                dropped_.fetch_add(1);
            }
            published_ = std::move(target);
            ++published_sequence_;
            captured_.store(frame_id + 1);
        }
        frame_cv_.notify_one();
    }
}

std::shared_ptr<const GrayFrame> LatestFramePump::wait_next() {
    std::unique_lock<std::mutex> lock(mutex_);
    frame_cv_.wait(lock, [this] {
        return stop_ || published_sequence_ > consumed_sequence_ || ended_;
    });
    if (published_sequence_ <= consumed_sequence_) return {};
    consumed_sequence_ = published_sequence_;
    return published_;
}

std::string LatestFramePump::last_error() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return last_error_;
}

}  // namespace pavois
