#pragma once

#include "pavois/config/app_config.hpp"
#include "pavois/domain/observation.hpp"
#include "pavois/domain/track_update.hpp"
#include "pavois/fusion/fusion_engine.hpp"
#include "pavois/transport/udp_sender.hpp"

#include <cstdint>
#include <memory>
#include <mutex>
#include <ostream>
#include <string>

namespace pavois {

class CameraWorker {
public:
    CameraWorker(const CameraConfig& cfg,
                 const AppConfig& app,
                 FusionEngine& fusion,
                 std::ostream& log_out,
                 std::mutex& log_mutex,
                 std::shared_ptr<UdpSender> udp_sender,
                 bool emit_raw_observations);

    void operator()();

private:
    void log_line(const std::string& line);
    void emit(const TrackUpdate& update);
    void maybe_emit_attitude(const CameraPose& pose,
                             std::uint64_t now_us,
                             std::uint64_t& last_att_us);

    CameraConfig cfg_;
    const AppConfig& app_;
    FusionEngine& fusion_;
    std::ostream& log_out_;
    std::mutex& log_mutex_;
    std::shared_ptr<UdpSender> udp_sender_;
    bool emit_raw_observations_ = false;
};

}  // namespace pavois
