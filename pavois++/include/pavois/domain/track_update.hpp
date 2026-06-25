#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace pavois {

struct TrackUpdate {
    std::uint32_t object_id = 0;
    std::uint64_t timestamp_us = 0;
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
    double confidence = 0.0;
    std::vector<std::string> cameras;
};

}  // namespace pavois

