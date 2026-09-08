#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace pavois {

struct DetectionEvent {
    std::string type = "detection";
    std::uint64_t frame_id = 0;
    std::string camera_id;
    std::size_t blob_area = 0;
    double centroid_x = 0.0;
    double centroid_y = 0.0;
    double confidence = 0.0;
    std::vector<std::uint8_t> diff_mask;
};

}  // namespace pavois
