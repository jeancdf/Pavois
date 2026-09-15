#include "pavois/config/app_config.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace pavois {
namespace {

std::string trim(std::string s) {
    auto not_space = [](unsigned char ch) { return !std::isspace(ch); };
    s.erase(s.begin(), std::find_if(s.begin(), s.end(), not_space));
    s.erase(std::find_if(s.rbegin(), s.rend(), not_space).base(), s.end());
    return s;
}

bool parse_bool(const std::string& value) {
    return value == "1" || value == "true" || value == "TRUE" || value == "yes" || value == "on";
}

void gps_to_local_approx(
    double lat_deg, double lon_deg, double alt_m,
    double origin_lat_deg, double origin_lon_deg, double origin_alt_m,
    double& x_m, double& y_m, double& z_m) {
    constexpr double kPi = 3.14159265358979323846;
    constexpr double kEarthRadiusM = 6378137.0;
    const double lat = lat_deg * kPi / 180.0;
    const double origin_lat = origin_lat_deg * kPi / 180.0;
    const double origin_lon = origin_lon_deg * kPi / 180.0;
    const double lon = lon_deg * kPi / 180.0;
    const double mean_lat = (lat + origin_lat) * 0.5;
    x_m = (lon - origin_lon) * std::cos(mean_lat) * kEarthRadiusM;
    y_m = (lat - origin_lat) * kEarthRadiusM;
    z_m = alt_m - origin_alt_m;
}

void apply_camera_field(CameraConfig& c, const std::string& f, const std::string& v) {
    try {
        if (f == "id") c.id = v;
        else if (f == "device") c.device = v;
        else if (f == "width") c.width = std::stoi(v);
        else if (f == "height") c.height = std::stoi(v);
        else if (f == "fps") c.fps = std::stoi(v);
        else if (f == "frames") c.frames = std::stoi(v);
        else if (f == "enabled") c.enabled = parse_bool(v);
        else if (f == "diff_threshold") c.diff_threshold = static_cast<std::uint8_t>(std::stoi(v));
        else if (f == "bg_learn_rate") c.bg_learn_rate = std::stod(v);
        else if (f == "bg_learn_rate_fg") c.bg_learn_rate_fg = std::stod(v);
        else if (f == "adaptive_k") c.adaptive_k = std::stod(v);
        else if (f == "blur_radius") c.blur_radius = std::stoi(v);
        else if (f == "morph_open") c.morph_open = std::stoi(v);
        else if (f == "morph_close") c.morph_close = std::stoi(v);
        else if (f == "min_blob_area") c.min_blob_area = static_cast<std::size_t>(std::stoul(v));
        else if (f == "max_blob_area_ratio") c.max_blob_area_ratio = std::stod(v);
        else if (f == "min_blob_fill_ratio") c.min_blob_fill_ratio = std::stod(v);
        else if (f == "max_blob_aspect") c.max_blob_aspect = std::stod(v);
        else if (f == "border_ignore_px") c.border_ignore_px = std::stoi(v);
        else if (f == "confirm_m") c.confirm_m = std::stoi(v);
        else if (f == "confirm_n") c.confirm_n = std::stoi(v);
        else if (f == "centroid_process_noise") c.centroid_process_noise = std::stod(v);
        else if (f == "centroid_meas_noise") c.centroid_meas_noise = std::stod(v);
        else if (f == "fx") c.fx = std::stod(v);
        else if (f == "fy") c.fy = std::stod(v);
        else if (f == "cx") c.cx = std::stod(v);
        else if (f == "cy") c.cy = std::stod(v);
        else if (f == "k1") c.k1 = std::stod(v);
        else if (f == "k2") c.k2 = std::stod(v);
        else if (f == "p1") c.p1 = std::stod(v);
        else if (f == "p2") c.p2 = std::stod(v);
        else if (f == "k3") c.k3 = std::stod(v);
        else if (f == "fov_deg") c.fov_deg = std::stod(v);
        else if (f == "rail_pose_enabled") c.rail_pose_enabled = parse_bool(v);
        else if (f == "rail_x") c.rail_x = std::stod(v);
        else if (f == "rail_y") c.rail_y = std::stod(v);
        else if (f == "rail_z") c.rail_z = std::stod(v);
        else if (f == "rail_heading_deg") c.rail_heading_deg = std::stod(v);
        else if (f == "rail_elevation_deg") c.rail_elevation_deg = std::stod(v);
        else if (f == "rail_roll_deg") c.rail_roll_deg = std::stod(v);
        else if (f == "x") c.x = std::stod(v);
        else if (f == "y") c.y = std::stod(v);
        else if (f == "z") c.z = std::stod(v);
        else if (f == "yaw_deg") c.yaw_deg = std::stod(v);
        else if (f == "pitch_deg") c.pitch_deg = std::stod(v);
        else if (f == "roll_deg") c.roll_deg = std::stod(v);
        else if (f == "heading_deg") c.heading_deg = std::stod(v);
        else if (f == "elevation_deg") c.elevation_deg = std::stod(v);
        else if (f == "reconnect_max_attempts") c.reconnect_max_attempts = std::stoi(v);
        else if (f == "reconnect_backoff_ms") c.reconnect_backoff_ms = std::stoi(v);
        else if (f == "exposure_mode") c.exposure_mode = v;
        else if (f == "shutter_us") c.shutter_us = std::stoi(v);
        else if (f == "analogue_gain") c.analogue_gain = std::stod(v);
        else if (f == "awb_red_gain") c.awb_red_gain = std::stod(v);
        else if (f == "awb_blue_gain") c.awb_blue_gain = std::stod(v);
        else if (f == "gps_lat") { c.gps_lat = std::stod(v); c.has_gps_pose = true; }
        else if (f == "gps_lon") { c.gps_lon = std::stod(v); c.has_gps_pose = true; }
        else if (f == "gps_alt") { c.gps_alt = std::stod(v); c.has_gps_pose = true; }
    } catch (...) {
        // keep default on malformed value
    }
}

bool apply_global_field(AppConfig& cfg, const std::string& key, const std::string& v) {
    try {
        if (key == "frames") cfg.frames = std::stoi(v);
        else if (key == "processing_threads") cfg.processing_threads = std::stoi(v);
        else if (key == "runtime.pin_threads") cfg.pin_threads = parse_bool(v);
        else if (key == "fusion_window_ms") cfg.fusion_window_ms = std::stoi(v);
        else if (key == "fusion_emit_interval_ms") cfg.fusion_emit_interval_ms = std::stoi(v);
        else if (key == "fusion_max_range_m") cfg.fusion_max_range_m = std::stod(v);
        else if (key == "fusion_min_parallax_deg") cfg.fusion_min_parallax_deg = std::stod(v);
        else if (key == "fusion_max_residual_m") cfg.fusion_max_residual_m = std::stod(v);
        else if (key == "fusion_support_radius_m") cfg.fusion_support_radius_m = std::stod(v);
        else if (key == "fusion_ransac_iterations") cfg.fusion_ransac_iterations = std::stoi(v);
        else if (key == "track_match_distance_m") cfg.track_match_distance_m = std::stod(v);
        else if (key == "track_gate_mahalanobis") cfg.track_gate_mahalanobis = std::stod(v);
        else if (key == "track_smoothing_alpha") cfg.track_smoothing_alpha = std::stod(v);
        else if (key == "track_process_noise") cfg.track_process_noise = std::stod(v);
        else if (key == "track_meas_noise") cfg.track_meas_noise = std::stod(v);
        else if (key == "track_confirm_updates") cfg.track_confirm_updates = std::stoi(v);
        else if (key == "track_max_coast_ms") cfg.track_max_coast_ms = std::stoi(v);
        else if (key == "track_max_speed_mps") cfg.track_max_speed_mps = std::stod(v);
        else if (key == "config_path") cfg.config_path = v;
        else if (key == "output_host") cfg.output_host = v;
        else if (key == "output_port") cfg.output_port = std::stoi(v);
        else if (key == "debug_dir") cfg.debug_dir = v;
        else if (key == "debug_every") cfg.debug_every = std::stoi(v);
        else if (key == "imu.enabled") cfg.imu_enabled = parse_bool(v);
        else if (key == "imu.kind") cfg.imu_kind = v;
        else if (key == "imu.i2c_dev") cfg.imu_i2c_dev = v;
        else if (key == "imu.i2c_address") {
            cfg.imu_i2c_address = static_cast<int>(std::stoul(v, nullptr, 0));
        }
        else if (key == "imu.i2c_fail_threshold") {
            cfg.imu_i2c_fail_threshold = std::stoi(v);
        }
        else if (key == "imu.i2c_retry_min_ms") {
            cfg.imu_i2c_retry_min_ms = std::stoi(v);
        }
        else if (key == "imu.i2c_retry_max_ms") {
            cfg.imu_i2c_retry_max_ms = std::stoi(v);
        }
        else if (key == "imu.file") cfg.imu_file = v;
        else if (key == "imu.calib_file") cfg.imu_calib_file = v;
        else if (key == "imu.emit_interval_ms") {
            cfg.imu_emit_interval_ms = std::stoi(v);
        }
        else if (key == "imu.heading_offset_deg") {
            cfg.imu_heading_offset_deg = std::stod(v);
        }
        else if (key == "imu.heading_sign") {
            cfg.imu_heading_sign = std::stod(v);
        }
        else if (key == "imu.elevation_offset_deg") {
            cfg.imu_elevation_offset_deg = std::stod(v);
        }
        else if (key == "imu.roll_offset_deg") {
            cfg.imu_roll_offset_deg = std::stod(v);
        }
        else if (key == "imu.elevation_sign") {
            cfg.imu_elevation_sign = std::stod(v);
        }
        else if (key == "imu.axis_map") {
            cfg.imu_axis_map = static_cast<int>(std::stoul(v, nullptr, 0));
        }
        else if (key == "imu.axis_sign") {
            cfg.imu_axis_sign = static_cast<int>(std::stoul(v, nullptr, 0));
        }
        else if (key == "preview.enabled") cfg.preview_enabled = parse_bool(v);
        else if (key == "preview.fps") cfg.preview_fps = std::stoi(v);
        else if (key == "preview.width") cfg.preview_width = std::stoi(v);
        else if (key == "preview.quality") cfg.preview_quality = std::stoi(v);
        else if (key == "preview.host") cfg.preview_host = v;
        else if (key == "preview.http_port") cfg.preview_http_port = std::stoi(v);
        else if (key == "preview.http_path") cfg.preview_http_path = v;
        else if (key == "classification.enabled") cfg.classification_enabled = parse_bool(v);
        else if (key == "classification.quality") cfg.classification_quality = std::stoi(v);
        else if (key == "classification.host") cfg.classification_host = v;
        else if (key == "classification.http_port") cfg.classification_http_port = std::stoi(v);
        else if (key == "classification.http_path") cfg.classification_http_path = v;
        else if (key == "reference_lat") { cfg.reference_lat = std::stod(v); cfg.has_reference_gps = true; }
        else if (key == "reference_lon") { cfg.reference_lon = std::stod(v); cfg.has_reference_gps = true; }
        else if (key == "reference_alt") { cfg.reference_alt = std::stod(v); cfg.has_reference_gps = true; }
        else return false;
    } catch (...) {
        return false;
    }
    return true;
}

void finalize_camera(CameraConfig& c) {
    // Intrinsic defaults: derive a focal length from the horizontal FOV,
    // centre the principal point, keep aspect square unless told otherwise.
    constexpr double kPi = 3.14159265358979323846;
    if (c.fx <= 0.0) {
        const double half = c.fov_deg * 0.5 * kPi / 180.0;
        c.fx = (half > 1e-6) ? (c.width * 0.5) / std::tan(half) : c.width;
    }
    if (c.fy <= 0.0) c.fy = c.fx;
    if (c.cx <= 0.0) c.cx = c.width * 0.5;
    if (c.cy <= 0.0) c.cy = c.height * 0.5;

    // Legacy yaw/pitch mirror the compass fields so old maths still lines up.
    if (c.heading_deg != 0.0 || c.elevation_deg != 0.0) {
        c.yaw_deg = c.heading_deg;
    }
    c.confirm_n = std::max(c.confirm_n, c.confirm_m);
    if (c.exposure_mode != "normal" && c.exposure_mode != "sport") {
        c.exposure_mode = "sport";
    }
    c.shutter_us = std::clamp(c.shutter_us, 100, 1'000'000);
    c.analogue_gain = std::clamp(c.analogue_gain, 1.0, 32.0);
    c.awb_red_gain = std::clamp(c.awb_red_gain, 0.1, 8.0);
    c.awb_blue_gain = std::clamp(c.awb_blue_gain, 0.1, 8.0);
}

}  // namespace

AppConfig load_config_file(const std::string& path) {
    AppConfig config;
    std::ifstream in(path);
    if (!in) {
        CameraConfig def;
        finalize_camera(def);
        config.cameras.push_back(def);
        return config;
    }

    std::map<std::size_t, CameraConfig> indexed;
    CameraConfig legacy;
    bool saw_legacy = false;

    std::string line;
    while (std::getline(in, line)) {
        line = trim(line);
        if (line.empty() || line[0] == '#' || line[0] == ';') continue;
        const auto eq = line.find('=');
        if (eq == std::string::npos) continue;
        const std::string key = trim(line.substr(0, eq));
        const std::string value = trim(line.substr(eq + 1));

        if (apply_global_field(config, key, value)) continue;

        if (key.rfind("camera.", 0) == 0) {
            const std::string tail = key.substr(7);
            const auto dot = tail.find('.');
            if (dot == std::string::npos) continue;
            try {
                const std::size_t index = static_cast<std::size_t>(std::stoul(tail.substr(0, dot)));
                apply_camera_field(indexed[index], tail.substr(dot + 1), value);
            } catch (...) {
            }
            continue;
        }

        saw_legacy = true;
        apply_camera_field(legacy, key, value);
    }

    if (!indexed.empty()) {
        for (auto& [idx, cam] : indexed) {
            (void)idx;
            if (cam.frames < 0) cam.frames = config.frames;
            config.cameras.push_back(cam);
        }
    } else {
        if (saw_legacy && legacy.frames < 0) legacy.frames = config.frames;
        config.cameras.push_back(legacy);
    }

    // Resolve GPS demo poses into local ENU metres.
    bool have_origin = config.has_reference_gps;
    double olat = config.reference_lat, olon = config.reference_lon, oalt = config.reference_alt;
    if (!have_origin) {
        for (const auto& cam : config.cameras) {
            if (cam.has_gps_pose) {
                olat = cam.gps_lat; olon = cam.gps_lon; oalt = cam.gps_alt;
                have_origin = true;
                break;
            }
        }
    }
    if (have_origin) {
        config.reference_lat = olat;
        config.reference_lon = olon;
        config.reference_alt = oalt;
        config.has_reference_gps = true;
        for (auto& cam : config.cameras) {
            if (!cam.has_gps_pose) continue;
            gps_to_local_approx(cam.gps_lat, cam.gps_lon, cam.gps_alt,
                                olat, olon, oalt, cam.x, cam.y, cam.z);
        }
    }

    config.processing_threads = std::clamp(config.processing_threads, 1, 8);
    config.classification_quality =
        std::clamp(config.classification_quality, 50, 95);
    for (auto& cam : config.cameras) finalize_camera(cam);
    return config;
}

}  // namespace pavois
