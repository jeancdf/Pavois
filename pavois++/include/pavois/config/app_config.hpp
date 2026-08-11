#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace pavois {

struct CameraConfig {
    std::string id = "CAM-01";
    std::string device = "/dev/video0";
    int width = 1280;
    int height = 720;
    int frames = -1;
    std::uint8_t diff_threshold = 25;
    std::size_t min_blob_area = 120;
    double x = 0.0;
    double y = 0.0;
    double z = 1.5;
    double yaw_deg = 0.0;
    double pitch_deg = 90.0;
    double roll_deg = 0.0;
    double fov_deg = 65.0;
    double gps_lat = 0.0;
    double gps_lon = 0.0;
    double gps_alt = 0.0;
    double heading_deg = 0.0;
    bool has_gps_pose = false;
    bool enabled = true;
};

struct AppConfig {
    int frames = -1;
    int fusion_window_ms = 150;
    std::string config_path = "pavois++.conf";
    std::string output_host;
    int output_port = 0;
    double reference_lat = 0.0;
    double reference_lon = 0.0;
    double reference_alt = 0.0;
    bool has_reference_gps = false;
    std::vector<CameraConfig> cameras;
};

AppConfig load_config_file(const std::string& path);

}  // namespace pavois
