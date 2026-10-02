#include "pavois/runtime/camera_worker.hpp"

#include "pavois/capture/frame_source.hpp"
#include "pavois/config/live_tuning.hpp"
#include "pavois/detection/motion_detector.hpp"
#include "pavois/domain/observation.hpp"
#include "pavois/sensors/imu.hpp"
#include "pavois/transport/event_bus.hpp"
#include "pavois/util/debug_sink.hpp"
#include "pavois/util/jpeg_gray.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace pavois {
namespace {

CameraIntrinsics intrinsics_from(const CameraConfig& c) {
    CameraIntrinsics in;
    in.fx = c.fx;
    in.fy = c.fy;
    in.cx = c.cx;
    in.cy = c.cy;
    in.k1 = c.k1;
    in.k2 = c.k2;
    in.p1 = c.p1;
    in.p2 = c.p2;
    in.k3 = c.k3;
    in.fov_deg = c.fov_deg;
    in.image_width = c.width;
    in.image_height = c.height;
    return in;
}

CameraPose pose_from(const CameraConfig& c) {
    CameraPose p;
    p.x = c.x;
    p.y = c.y;
    p.z = c.z;
    p.heading_deg = (c.heading_deg != 0.0 || c.elevation_deg != 0.0) ? c.heading_deg : c.yaw_deg;
    p.elevation_deg = c.elevation_deg;
    p.roll_deg = c.roll_deg;
    return p;
}

}  // namespace

CameraWorker::CameraWorker(const CameraConfig& cfg, const AppConfig& app,
                           FusionEngine& fusion,
                           std::ostream& log_out, std::mutex& log_mutex,
                           std::shared_ptr<UdpSender> udp_sender,
                           std::shared_ptr<HttpPoster> preview_http,
                           std::shared_ptr<HttpPoster> classification_http,
                           std::shared_ptr<ParallelExecutor> processing_executor,
                           std::shared_ptr<ImuReader> imu,
                           bool emit_raw_observations)
    : cfg_(cfg),
      file_cfg_(cfg),
      app_(app),
      fusion_(fusion),
      log_out_(log_out),
      log_mutex_(log_mutex),
      udp_sender_(std::move(udp_sender)),
      preview_http_(std::move(preview_http)),
      classification_http_(std::move(classification_http)),
      processing_executor_(std::move(processing_executor)),
      imu_(std::move(imu)),
      emit_raw_observations_(emit_raw_observations) {}

// One row per processed frame: what the detector saw, before fusion. Lets an
// offline scorer measure per-camera recall against ground truth, which the
// fused track line alone cannot show.
void CameraWorker::trace_detection(std::ofstream& out, const GrayFrame& frame,
                                   const DetectionResult& detection) {
    if (!out.is_open()) return;
    out << frame.frame_id << ',' << frame.captured_us << ','
        << (detection.has_blob ? 1 : 0) << ',' << (detection.confirmed ? 1 : 0)
        << ',' << std::fixed << std::setprecision(2) << detection.cx << ','
        << detection.cy << ',' << detection.area << ','
        << std::setprecision(4) << detection.quality << ','
        << std::setprecision(3) << detection.snr << ','
        << detection.fill_ratio << ',' << detection.blobs.size();
    // Every candidate, not just the winner: the worker submits all of them to
    // fusion, so scoring only the top-ranked one would understate what fusion
    // actually receives.
    for (std::size_t i = 0; i < detection.blobs.size() && i < 8; ++i) {
        out << ';' << std::setprecision(1) << detection.blobs[i].cx << ':'
            << detection.blobs[i].cy << ':' << detection.blobs[i].area;
    }
    out << '\n';
}

void CameraWorker::log_line(const std::string& line) {
    std::lock_guard<std::mutex> lock(log_mutex_);
    std::cerr << line << '\n';
}

void CameraWorker::emit(const TrackUpdate& update) {
    std::string payload;
    if (app_.has_reference_gps) {
        payload = to_gps_csv(update, app_.reference_lat, app_.reference_lon, app_.reference_alt);
    } else {
        payload = to_csv(update);
    }
    {
        std::lock_guard<std::mutex> lock(log_mutex_);
        log_out_ << payload << '\n';
        log_out_.flush();
    }
    if (udp_sender_ && udp_sender_->valid()) udp_sender_->send_line(payload);
}

void CameraWorker::maybe_emit_attitude(const CameraPose& pose,
                                       const std::string& calib_token,
                                       bool imu_valid,
                                       std::uint64_t now_us,
                                       std::uint64_t& last_att_us) {
    if (!udp_sender_ || !udp_sender_->valid()) return;
    const std::uint64_t interval_us =
        static_cast<std::uint64_t>(
            std::max(50, app_.imu_emit_interval_ms)) *
        1000ULL;
    if (last_att_us != 0 && now_us - last_att_us < interval_us) return;
    last_att_us = now_us;
    std::ostringstream line;
    line << "att," << cfg_.id << ',' << now_us << ',' << std::fixed
         << std::setprecision(2) << pose.heading_deg << ','
         << pose.elevation_deg << ',' << pose.roll_deg << ',' << calib_token
         << ',' << (imu_valid ? '1' : '0');
    udp_sender_->send_line(line.str());
}

void CameraWorker::maybe_send_preview(const GrayFrame& frame,
                                      std::uint64_t now_us,
                                      std::uint64_t& last_preview_us) {
    if (!app_.preview_enabled || !preview_http_ || !preview_http_->valid()) {
        return;
    }
    if (frame.empty()) return;
    const int fps = std::max(1, app_.preview_fps);
    const std::uint64_t interval_us = 1000000ULL / static_cast<std::uint64_t>(fps);
    if (last_preview_us != 0 && now_us - last_preview_us < interval_us) {
        return;
    }
    last_preview_us = now_us;
    const GrayFrame small = downscale_gray(frame, app_.preview_width);
    std::vector<std::uint8_t> jpeg;
    if (!encode_gray_jpeg(small, app_.preview_quality, jpeg)) return;
    // Nest rejects bodies over 64 KiB; skip an oversized thumbnail.
    if (jpeg.size() > 60000) return;
    preview_http_->post_jpeg(cfg_.id, std::move(jpeg));
}

void CameraWorker::maybe_emit_stats(std::uint64_t now_us,
                                    std::uint64_t frame_id,
                                    std::uint64_t& window_start_us,
                                    std::uint64_t& window_frames,
                                    const ImageDiagnostics& diag,
                                    double exposure_us,
                                    double gain_db) {
    if (!udp_sender_ || !udp_sender_->valid()) return;
    if (window_start_us == 0) {
        window_start_us = now_us;
        window_frames = 0;
    }
    ++window_frames;
    if (now_us < window_start_us + 1'000'000ULL) return;
    const double dt_s =
        static_cast<double>(now_us - window_start_us) / 1'000'000.0;
    const double fps = dt_s > 0.0
                           ? static_cast<double>(window_frames) / dt_s
                           : 0.0;
    std::ostringstream line;
    line << "stats,v2," << cfg_.id << ',' << std::fixed << std::setprecision(2)
         << fps << ',' << frame_id << ',' << now_us << ','
         << std::setprecision(2) << diag.lum_mean << ','
         << diag.lum_stddev << ',' << diag.frame_diff << ','
         << diag.laplacian_var << ',' << exposure_us << ',' << gain_db;
    udp_sender_->send_line(line.str());
    window_start_us = now_us;
    window_frames = 0;
}

void CameraWorker::apply_config_update(const UdpSender::ConfigUpdate& update,
                                       MotionDetector& detector) {
    // Always start from the config file: a command carries the full set of
    // live settings, so the result never depends on what was pushed before.
    CameraConfig next = file_cfg_;
    const std::size_t refused =
        update.version == 0 ? 0 : apply_live_settings(next, update.fields);
    cfg_ = next;
    live_version_ = update.version;
    detector.set_config(cfg_);
    log_line("camera " + cfg_.id + " live settings v" +
             std::to_string(update.version) +
             (update.version == 0 ? " (config file)" : "") +
             (refused ? ", " + std::to_string(refused) + " refused" : ""));
}

// The VPS compares the version reported here with the one it wants, and sends
// its settings again until they match. Reporting the values as well lets the
// operator see what the detector really runs, clamps included.
void CameraWorker::maybe_emit_config(const GrayFrame& frame,
                                     std::uint64_t now_us,
                                     std::uint64_t& last_cfg_us) {
    if (!udp_sender_ || !udp_sender_->valid()) return;
    if (last_cfg_us != 0 && now_us < last_cfg_us + 1'000'000ULL) return;
    last_cfg_us = now_us;
    std::ostringstream line;
    line << "cfg," << cfg_.id << ',' << now_us << ',' << live_version_
         << ",width=" << frame.width << ",height=" << frame.height << ','
         << format_live_settings(cfg_);
    udp_sender_->send_line(line.str());
}

void CameraWorker::send_classification_capture(
    const GrayFrame& frame, const DetectionResult& detection,
    const UdpSender::CaptureRequest& request) {
    if (!classification_http_ || !classification_http_->valid() ||
        frame.empty()) {
        return;
    }
    const BlobDetection* blob =
        detection.blobs.empty() ? nullptr : &detection.blobs.front();
    std::ostringstream query;
    query << "requestId=" << request.request_id
          << "&capturedUs=" << frame.captured_us
          << "&frameId=" << frame.frame_id;
    if (blob) {
        query << "&cx=" << std::fixed << std::setprecision(2) << blob->cx
              << "&cy=" << blob->cy
              << "&x0=" << blob->x0 << "&y0=" << blob->y0
              << "&x1=" << blob->x1 << "&y1=" << blob->y1
              << "&area=" << blob->area;
    }
    classification_http_->post_gray(cfg_.id, frame,
                                     app_.classification_quality,
                                     query.str());
    log_line("camera " + cfg_.id + " classification capture " +
             request.request_id);
}

// No reader: the config pose is authoritative and streams as valid.
// A failed read keeps the last pose and reports false (frozen heading).
bool CameraWorker::apply_imu_sample(ImuReader* imu, CameraPose& pose,
                                    std::string& calib_token) {
    calib_token = "-";
    if (!imu) return true;
    ImuSample sample;
    if (!imu->read(sample) || !sample.valid) return false;
    pose.heading_deg = sample.heading_deg;
    pose.elevation_deg = sample.elevation_deg;
    pose.roll_deg = sample.roll_deg;
    calib_token = format_calib_token(sample);
    return true;
}

void CameraWorker::stream_attitude_only(
    ImuReader* imu, CameraPose pose) {
    std::uint64_t last_att_us = 0;
    const int wait_ms = std::max(50, app_.imu_emit_interval_ms);
    while (cfg_.frames < 0) {
        std::string calib_token;
        const bool imu_valid = apply_imu_sample(imu, pose, calib_token);
        maybe_emit_attitude(pose, calib_token, imu_valid, wall_clock_us(),
                            last_att_us);
        std::this_thread::sleep_for(std::chrono::milliseconds(wait_ms));
    }
}

void CameraWorker::operator()() {
    if (!cfg_.enabled) return;

    const CameraIntrinsics intr = intrinsics_from(cfg_);
    CameraPose pose = pose_from(cfg_);
    // Use the process-wide IMU from main. Do not call open_imu() here:
    // each BNO055 init would CONFIG→NDOF and reset fusion on other threads.
    if (imu_) {
        log_line("camera " + cfg_.id + " IMU live");
    } else if (app_.imu_enabled && app_.imu_kind != "none") {
        log_line("camera " + cfg_.id +
                 " IMU off, streaming config heading_deg");
    }

    auto source = make_frame_source(cfg_);
    if (!source->open()) {
        log_line("camera " + cfg_.id + " open failed: " +
                 source->last_error());
        stream_attitude_only(imu_.get(), pose);
        return;
    }

    MotionDetector detector(cfg_, processing_executor_.get());
    DebugSink debug(app_.debug_dir, app_.debug_every, cfg_.id);
    detector.set_debug(debug.active());

    std::ofstream trace;
    if (!app_.observation_log.empty()) {
        trace.open(app_.observation_log + "." + cfg_.id + ".csv");
        if (trace.is_open()) {
            trace << "frame,captured_us,has_blob,confirmed,cx,cy,area,quality,"
                     "snr,fill,blobs\n";
        } else {
            log_line("camera " + cfg_.id + " observation log open failed");
        }
    }

    GrayFrame frame;
    GrayFrame prev_diag_frame;
    ImageDiagnostics last_diag;
    std::uint64_t frame_id = 0;
    std::uint64_t emitted = 0;
    std::uint64_t last_att_us = 0;
    std::uint64_t last_preview_us = 0;
    std::uint64_t stats_window_start_us = 0;
    std::uint64_t stats_window_frames = 0;
    std::uint64_t last_cfg_us = 0;

    while (cfg_.frames < 0 || static_cast<int>(frame_id) < cfg_.frames) {
        const auto capture_request =
            udp_sender_ ? udp_sender_->take_capture_request(cfg_.id)
                        : std::nullopt;
        if (udp_sender_) {
            if (const auto update = udp_sender_->take_config_update(cfg_.id)) {
                apply_config_update(*update, detector);
                last_cfg_us = 0;  // acknowledge on this frame
            }
        }
        if (!source->read_frame(frame)) {
            if (source->at_end()) {
                log_line("camera " + cfg_.id + " replay complete after " +
                         std::to_string(frame_id) + " frames");
                return;
            }
            log_line("camera " + cfg_.id + " read failed: " +
                     source->last_error());
            stream_attitude_only(imu_.get(), pose);
            return;
        }
        frame.frame_id = frame_id;
        if (frame.captured_us == 0) frame.captured_us = wall_clock_us();

        if ((frame_id % 5) == 0) {
            last_diag = compute_image_diagnostics(frame, &prev_diag_frame);
            prev_diag_frame = frame;
        }

        std::string calib_token;
        const bool imu_valid = apply_imu_sample(imu_.get(), pose, calib_token);
        maybe_emit_attitude(pose, calib_token, imu_valid, frame.captured_us,
                            last_att_us);
        maybe_send_preview(frame, frame.captured_us, last_preview_us);

        const DetectionResult det = detector.process(frame);
        trace_detection(trace, frame, det);
        if (capture_request) {
            send_classification_capture(frame, det, *capture_request);
        }
        if (debug.active()) debug.dump(frame, det);
        maybe_emit_stats(wall_clock_us(), frame_id, stats_window_start_us,
                         stats_window_frames, last_diag);
        maybe_emit_config(frame, wall_clock_us(), last_cfg_us);

        if (det.confirmed) {
            for (const auto& blob : det.blobs) {
                Observation obs;
                obs.camera_id = cfg_.id;
                obs.frame_id = frame_id;
                obs.timestamp_us = frame.captured_us;
                obs.captured_us = frame.captured_us;
                obs.image_width = frame.width;
                obs.image_height = frame.height;
                obs.centroid_x = blob.cx;
                obs.centroid_y = blob.cy;
                obs.blob_area = blob.area;
                obs.quality = blob.quality;
                obs.confidence = blob.quality;
                obs.intrinsics = intr;
                obs.intrinsics.image_width = frame.width;
                obs.intrinsics.image_height = frame.height;
                obs.pose = pose;
                obs.cam_x = pose.x;
                obs.cam_y = pose.y;
                obs.cam_z = pose.z;
                obs.yaw_deg = pose.heading_deg;
                obs.roll_deg = pose.roll_deg;
                obs.fov_deg = cfg_.fov_deg;

                for (const auto& update : fusion_.submit(obs)) {
                    emit(update);
                    ++emitted;
                }

                if (emit_raw_observations_ && udp_sender_ &&
                    udp_sender_->valid()) {
                    // Same capture timestamp/frame id for every valid blob.
                    // The VPS keeps the whole frame group for raw intersections.
                    std::ostringstream line;
                    line << "raw," << obs.camera_id << ',' << obs.frame_id << ','
                         << obs.captured_us << ',' << std::fixed
                         << std::setprecision(2) << obs.centroid_x << ','
                         << obs.centroid_y << ',' << obs.blob_area << ','
                         << std::setprecision(3) << obs.quality << ','
                         << std::setprecision(2) << obs.pose.heading_deg << ','
                         << obs.pose.elevation_deg << ',' << obs.pose.roll_deg
                         << ',' << std::setprecision(3) << obs.intrinsics.fx
                         << ',' << obs.intrinsics.fy << ',' << obs.intrinsics.cx
                         << ',' << obs.intrinsics.cy << ','
                         << obs.intrinsics.fov_deg << ',' << std::setprecision(8)
                         << obs.intrinsics.k1 << ',' << obs.intrinsics.k2 << ','
                         << obs.intrinsics.p1 << ',' << obs.intrinsics.p2 << ','
                         << obs.intrinsics.k3;
                    if (cfg_.rail_pose_enabled) {
                        line << ',' << std::setprecision(5) << cfg_.rail_x << ','
                             << cfg_.rail_y << ',' << cfg_.rail_z << ','
                             << cfg_.rail_heading_deg << ','
                             << cfg_.rail_elevation_deg << ','
                             << cfg_.rail_roll_deg;
                    }
                    udp_sender_->send_line(line.str());
                }
            }
        }

        ++frame_id;
        if ((frame_id % 120) == 0) {
            log_line("camera " + cfg_.id + " f=" + std::to_string(frame_id) +
                     " emitted=" + std::to_string(emitted) + " | " + fusion_.last_status());
        }
    }
}

}  // namespace pavois
