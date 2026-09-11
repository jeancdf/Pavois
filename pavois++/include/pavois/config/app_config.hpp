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
    int fps = 20;  // CSI capture frame rate
    int frames = -1;
    bool enabled = true;

    // --- detection ---
    std::uint8_t diff_threshold = 14;     // base foreground threshold (grey levels)
    double bg_learn_rate = 0.05;          // running-average background alpha
    double bg_learn_rate_fg = 0.02;       // bounded alpha under an active blob
    double adaptive_k = 2.2;              // threshold = base + k * noise_sigma
    int blur_radius = 1;                  // box-blur radius before differencing
    int morph_open = 1;                   // erode/dilate iterations (speckle kill)
    int morph_close = 2;                  // dilate/erode iterations (fill gaps)
    std::size_t min_blob_area = 12;
    double max_blob_area_ratio = 0.45;    // reject global illumination events
    double min_blob_fill_ratio = 0.10;    // area / bbox area (reject thin streaks)
    double max_blob_aspect = 6.0;         // reject long thin artefacts
    int border_ignore_px = 6;             // drop blobs hugging the frame edge
    int confirm_m = 3;                    // confirmed if seen in M of last N frames
    int confirm_n = 5;
    double centroid_process_noise = 600.0;  // 2D Kalman on the centroid (px^2/s^3)
    double centroid_meas_noise = 2.0;       // px

    // --- intrinsics / distortion ---
    double fx = 0.0;   // 0 => derive from fov_deg
    double fy = 0.0;
    double cx = 0.0;   // 0 => image centre
    double cy = 0.0;
    double k1 = 0.0;
    double k2 = 0.0;
    double fov_deg = 65.0;

    // --- pose ---
    double x = 0.0;
    double y = 0.0;
    double z = 1.5;
    double yaw_deg = 0.0;         // legacy; superseded by heading_deg
    double pitch_deg = 90.0;      // legacy
    double roll_deg = 0.0;
    double heading_deg = 0.0;     // compass bearing, 0 = North, CW
    double elevation_deg = 0.0;   // optical axis above horizon, + up

    // --- gps demo pose ---
    double gps_lat = 0.0;
    double gps_lon = 0.0;
    double gps_alt = 0.0;
    bool has_gps_pose = false;

    // --- capture ---
    int reconnect_max_attempts = 0;   // 0 => unlimited
    int reconnect_backoff_ms = 500;
};

struct AppConfig {
    int frames = -1;

    // --- fusion ---
    int fusion_window_ms = 90;
    int fusion_emit_interval_ms = 60;
    double fusion_max_range_m = 60.0;
    double fusion_min_parallax_deg = 2.0;
    double fusion_max_residual_m = 3.0;
    double fusion_support_radius_m = 2.5;   // reserved / legacy
    int fusion_ransac_iterations = 24;

    // --- tracking ---
    double track_match_distance_m = 6.0;
    double track_gate_mahalanobis = 9.21;  // chi-square 2dof ~ 0.99
    double track_smoothing_alpha = 0.35;   // legacy fallback
    double track_process_noise = 200.0;    // white-accel PSD (m^2/s^3)
    double track_meas_noise = 2.5;         // m
    int track_confirm_updates = 3;
    int track_max_coast_ms = 1200;
    double track_max_speed_mps = 120.0;

    std::string config_path = "pavois++.conf";
    std::string output_host;
    int output_port = 0;

    std::string debug_dir;
    int debug_every = 15;

    // Live IMU (BNO055 on I2C, or a file for tests). Offsets map chip
    // axes onto the camera optical frame.
    bool imu_enabled = true;
    std::string imu_kind = "auto";
    std::string imu_i2c_dev = "/dev/i2c-1";
    int imu_i2c_address = 0;
    std::string imu_file;
    int imu_emit_interval_ms = 200;
    double imu_heading_offset_deg = 0.0;
    double imu_elevation_offset_deg = 0.0;
    double imu_roll_offset_deg = 0.0;
    double imu_elevation_sign = 1.0;

    // AXIS_MAP_CONFIG (0x41) / AXIS_MAP_SIGN (0x42): correct a physical axis swap
    // (chip flat vs. on edge) that scalar offsets/sign above cannot express.
    // Defaults are the BNO055 power-on-reset values (P1, identity mapping) so a
    // Pi without an explicit override keeps its current behaviour.
    // See BNO055 datasheet Sec. 3.4 "Axis Remap" for how to derive these from
    // the sensor's physical mounting.
    int imu_axis_map = 0x24;
    int imu_axis_sign = 0x00;

    bool preview_enabled = true;
    int preview_fps = 2;
    int preview_width = 320;
    int preview_quality = 55;
    std::string preview_host;
    int preview_http_port = 8081;
    std::string preview_http_path = "/api/preview";

    double reference_lat = 0.0;
    double reference_lon = 0.0;
    double reference_alt = 0.0;
    bool has_reference_gps = false;

    std::vector<CameraConfig> cameras;
};

AppConfig load_config_file(const std::string& path);

}  // namespace pavois
