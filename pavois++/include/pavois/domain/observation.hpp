#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace pavois {

struct Observation {
    std::string camera_id;
    std::uint64_t frame_id = 0;
    std::uint64_t timestamp_us = 0;
    int image_width = 0;
    int image_height = 0;
    double centroid_x = 0.0;
    double centroid_y = 0.0;
    std::size_t blob_area = 0;
    double confidence = 0.0;
    double cam_x = 0.0;
    double cam_y = 0.0;
    double cam_z = 0.0;
    double yaw_deg = 0.0;
    double pitch_deg = 90.0;
    double roll_deg = 0.0;
    double fov_deg = 65.0;
};

}  // namespace pavois
