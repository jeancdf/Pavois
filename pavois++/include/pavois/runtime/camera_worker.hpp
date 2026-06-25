#pragma once

#include "pavois/config/app_config.hpp"
#include "pavois/fusion/fusion_engine.hpp"

#include <mutex>
#include <ostream>
#include <string>

namespace pavois {

class CameraWorker {
public:
    CameraWorker(const CameraConfig& cfg, FusionEngine& fusion, std::ostream& log_out, std::mutex& log_mutex);
    void operator()();

private:
    CameraConfig cfg_;
    FusionEngine& fusion_;
    std::ostream& log_out_;
    std::mutex& log_mutex_;

    void log_line(const std::string& line);
};

}  // namespace pavois
