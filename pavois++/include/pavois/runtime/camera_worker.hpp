#pragma once

#include "pavois/config/app_config.hpp"
#include "pavois/detection/motion_detector.hpp"
#include "pavois/domain/frame.hpp"
#include "pavois/domain/observation.hpp"
#include "pavois/domain/track_update.hpp"
#include "pavois/fusion/fusion_engine.hpp"
#include "pavois/sensors/imu.hpp"
#include "pavois/transport/http_poster.hpp"
#include "pavois/transport/udp_sender.hpp"

#include <cstdint>
#include <memory>
#include <mutex>
#include <ostream>
#include <string>

namespace pavois {

class ParallelExecutor;

class CameraWorker {
public:
    CameraWorker(const CameraConfig& cfg,
                 const AppConfig& app,
                 FusionEngine& fusion,
                 std::ostream& log_out,
                 std::mutex& log_mutex,
                 std::shared_ptr<UdpSender> udp_sender,
                 std::shared_ptr<HttpPoster> preview_http,
                 std::shared_ptr<HttpPoster> classification_http,
                 std::shared_ptr<ParallelExecutor> processing_executor,
                 std::shared_ptr<ImuReader> imu,
                 bool emit_raw_observations);

    void operator()();

private:
    void log_line(const std::string& line);
    void emit(const TrackUpdate& update);
    void maybe_emit_attitude(const CameraPose& pose,
                             const std::string& calib_token,
                             bool imu_valid,
                             std::uint64_t now_us,
                             std::uint64_t& last_att_us);
    bool apply_imu_sample(ImuReader* imu, CameraPose& pose,
                          std::string& calib_token);
    void stream_attitude_only(ImuReader* imu, CameraPose pose);
    void maybe_send_preview(const GrayFrame& frame, std::uint64_t now_us,
                            std::uint64_t& last_preview_us);
    void maybe_emit_stats(std::uint64_t now_us, std::uint64_t frame_id,
                          std::uint64_t& window_start_us,
                          std::uint64_t& window_frames);
    void send_classification_capture(
        const GrayFrame& frame,
        const DetectionResult& detection,
        const UdpSender::CaptureRequest& request);

    CameraConfig cfg_;
    const AppConfig& app_;
    FusionEngine& fusion_;
    std::ostream& log_out_;
    std::mutex& log_mutex_;
    std::shared_ptr<UdpSender> udp_sender_;
    std::shared_ptr<HttpPoster> preview_http_;
    std::shared_ptr<HttpPoster> classification_http_;
    std::shared_ptr<ParallelExecutor> processing_executor_;
    // Process-wide IMU (opened once in main; may be null).
    std::shared_ptr<ImuReader> imu_;
    bool emit_raw_observations_ = false;
};

}  // namespace pavois
