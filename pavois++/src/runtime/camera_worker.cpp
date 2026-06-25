#include "pavois/runtime/camera_worker.hpp"

#include "pavois/capture/camera.hpp"
#include "pavois/detection/blob_detector.hpp"
#include "pavois/detection/frame_diff.hpp"
#include "pavois/domain/observation.hpp"
#include "pavois/transport/event_bus.hpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <limits>
#include <optional>
#include <string>

namespace pavois {
namespace {

std::uint64_t now_us() {
    using clock = std::chrono::steady_clock;
    return static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::microseconds>(clock::now().time_since_epoch()).count());
}

double clamp01(double value) {
    return std::max(0.0, std::min(1.0, value));
}

}  // namespace

CameraWorker::CameraWorker(const CameraConfig& cfg, FusionEngine& fusion, std::ostream& log_out, std::mutex& log_mutex)
    : cfg_(cfg), fusion_(fusion), log_out_(log_out), log_mutex_(log_mutex) {}

void CameraWorker::log_line(const std::string& line) {
    std::lock_guard<std::mutex> lock(log_mutex_);
    std::cerr << line << '\n';
}

void CameraWorker::operator()() {
    if (!cfg_.enabled) {
        return;
    }

    V4L2Camera camera(cfg_.device, cfg_.width, cfg_.height);
    if (!camera.open()) {
        log_line("camera " + cfg_.id + " open failed: " + camera.last_error());
        return;
    }

    GrayFrame frame;
    GrayFrame previous_frame;
    std::uint64_t frame_id = 0;

    while (cfg_.frames < 0 || static_cast<int>(frame_id) < cfg_.frames) {
        if (!camera.read_frame(frame)) {
            log_line("camera " + cfg_.id + " read failed: " + camera.last_error());
            return;
        }

        frame.frame_id = frame_id;

        if (previous_frame.empty()) {
            previous_frame = frame;
            ++frame_id;
            continue;
        }

        const FrameDiffResult diff = detect_pixel_changes(frame, previous_frame, cfg_.diff_threshold);
        const std::vector<Blob> blobs = detect_blobs(diff.diff_mask, frame.width, frame.height, cfg_.min_blob_area);
        if (blobs.empty()) {
            previous_frame = frame;
            ++frame_id;
            continue;
        }

        const auto best = std::max_element(
            blobs.begin(), blobs.end(),
            [](const Blob& a, const Blob& b) { return a.area < b.area; });

        Observation obs;
        obs.camera_id = cfg_.id;
        obs.frame_id = frame_id;
        obs.timestamp_us = now_us();
        obs.image_width = frame.width;
        obs.image_height = frame.height;
        obs.centroid_x = best->centroid_x;
        obs.centroid_y = best->centroid_y;
        obs.blob_area = best->area;
        obs.cam_x = cfg_.x;
        obs.cam_y = cfg_.y;
        obs.cam_z = cfg_.z;
        obs.yaw_deg = cfg_.yaw_deg;
        obs.pitch_deg = cfg_.pitch_deg;
        obs.roll_deg = cfg_.roll_deg;
        obs.fov_deg = cfg_.fov_deg;

        const double area_score = std::min(0.45, static_cast<double>(best->area) / 6000.0);
        const double motion_score = std::min(0.20, static_cast<double>(diff.changed_pixels) / 30000.0);
        obs.confidence = clamp01(0.35 + area_score + motion_score);

        if (const std::optional<TrackUpdate> update = fusion_.submit(obs)) {
            std::lock_guard<std::mutex> lock(log_mutex_);
            emit_track_update(log_out_, *update);
        }

        previous_frame = frame;
        ++frame_id;
    }
}

}  // namespace pavois
