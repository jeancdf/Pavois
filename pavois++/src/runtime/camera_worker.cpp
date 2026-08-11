#include "pavois/runtime/camera_worker.hpp"

#include "pavois/capture/camera.hpp"
#include "pavois/detection/blob_detector.hpp"
#include "pavois/detection/frame_diff.hpp"
#include "pavois/domain/observation.hpp"
#include "pavois/transport/event_bus.hpp"

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cmath>
#include <iostream>
#include <iomanip>
#include <limits>
#include <optional>
#include <sstream>
#include <string>
#include <utility>

namespace pavois {
namespace {

std::uint64_t now_us() {
    using clock = std::chrono::system_clock;
    return static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::microseconds>(clock::now().time_since_epoch()).count());
}

double clamp01(double value) {
    return std::max(0.0, std::min(1.0, value));
}

std::string to_gps_csv(
    const TrackUpdate& update,
    double reference_lat,
    double reference_lon,
    double reference_alt) {
    constexpr double kPi = 3.14159265358979323846;
    constexpr double kEarthRadiusM = 6378137.0;
    const double ref_lat_rad = reference_lat * kPi / 180.0;
    const double lat = reference_lat + (update.y / kEarthRadiusM) * (180.0 / kPi);
    const double lon = reference_lon +
        (update.x / (kEarthRadiusM * std::cos(ref_lat_rad))) * (180.0 / kPi);
    const double alt = reference_alt + update.z;

    std::ostringstream out;
    out << "obj" << update.object_id << ','
        << std::fixed << std::setprecision(7)
        << lat << ','
        << lon << ','
        << std::setprecision(2)
        << alt << ','
        << update.timestamp_us;
    return out.str();
}

}  // namespace

CameraWorker::CameraWorker(
    const CameraConfig& cfg,
    FusionEngine& fusion,
    std::ostream& log_out,
    std::mutex& log_mutex,
    std::shared_ptr<UdpSender> udp_sender,
    bool emit_raw_observations,
    double reference_lat,
    double reference_lon,
    double reference_alt,
    bool has_reference_gps)
    : cfg_(cfg),
      fusion_(fusion),
      log_out_(log_out),
      log_mutex_(log_mutex),
      udp_sender_(std::move(udp_sender)),
      emit_raw_observations_(emit_raw_observations),
      reference_lat_(reference_lat),
      reference_lon_(reference_lon),
      reference_alt_(reference_alt),
      has_reference_gps_(has_reference_gps) {}

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

    {
        std::lock_guard<std::mutex> lock(log_mutex_);
        std::cerr << "camera " << cfg_.id << " open ok "
                  << camera.width() << "x" << camera.height()
                  << " device=" << cfg_.device << '\n';
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

        {
            std::lock_guard<std::mutex> lock(log_mutex_);
            std::cerr << "camera " << cfg_.id
                      << " frame=" << frame_id
                      << " changed=" << diff.changed_pixels
                      << " blobs=" << blobs.size() << '\n';
        }

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
            std::cerr << "fused track object=" << update->object_id
                      << " x=" << update->x
                      << " y=" << update->y
                      << " z=" << update->z
                      << " ts_us=" << update->timestamp_us
                      << '\n';
            if (udp_sender_ && udp_sender_->valid()) {
                if (has_reference_gps_) {
                    const std::string payload = to_gps_csv(
                        *update, reference_lat_, reference_lon_, reference_alt_);
                    udp_sender_->send_line(payload);
                    std::cerr << "sent gps track " << payload << '\n';
                } else {
                    const std::string payload = to_csv(*update);
                    udp_sender_->send_line(payload);
                    std::cerr << "sent local track " << payload << '\n';
                }
            }
        } else if (emit_raw_observations_ && udp_sender_ && udp_sender_->valid()) {
            std::ostringstream line;
            line << "raw,"
                 << obs.camera_id << ','
                 << obs.frame_id << ','
                 << obs.timestamp_us << ','
                 << std::fixed << std::setprecision(2)
                 << obs.centroid_x << ','
                 << obs.centroid_y << ','
                 << obs.blob_area;
            udp_sender_->send_line(line.str());
            std::lock_guard<std::mutex> lock(log_mutex_);
            std::cerr << "sent raw observation camera=" << obs.camera_id
                      << " frame=" << obs.frame_id
                      << " centroid=" << obs.centroid_x << "," << obs.centroid_y
                      << " area=" << obs.blob_area
                      << " confidence=" << obs.confidence
                      << '\n';
        }

        previous_frame = frame;
        ++frame_id;
    }
}

}  // namespace pavois
