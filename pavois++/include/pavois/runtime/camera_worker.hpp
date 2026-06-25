#pragma once

#include "pavois/config/app_config.hpp"
#include "pavois/fusion/fusion_engine.hpp"
#include "pavois/transport/udp_sender.hpp"

#include <mutex>
#include <ostream>
#include <memory>
#include <string>

namespace pavois {

class CameraWorker {
public:
    CameraWorker(
        const CameraConfig& cfg,
        FusionEngine& fusion,
        std::ostream& log_out,
        std::mutex& log_mutex,
        std::shared_ptr<UdpSender> udp_sender,
        bool emit_raw_observations);
    void operator()();

private:
    CameraConfig cfg_;
    FusionEngine& fusion_;
    std::ostream& log_out_;
    std::mutex& log_mutex_;
    std::shared_ptr<UdpSender> udp_sender_;
    bool emit_raw_observations_ = false;

    void log_line(const std::string& line);
};

}  // namespace pavois
