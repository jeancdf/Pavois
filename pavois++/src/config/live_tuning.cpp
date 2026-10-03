#include "pavois/config/live_tuning.hpp"

#include "pavois/math/pose.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <sstream>

namespace pavois {
namespace {

struct LiveSetting {
    const char* key;
    double min;
    double max;
    bool integer;
    double (*get)(const CameraConfig&);
    void (*set)(CameraConfig&, double);
    // 0 leaves the value alone: the config file's, once applied to a copy of it.
    bool zero_keeps = false;
};

// The OV5647 1080p crop, the mode rpicam-vid picks for the deployed 1280x720.
constexpr const char* kSensorMode1080p = "1920:1080:10:P";

// Bounds mirror vps/src/tuning.params.ts; the VPS validates first, this clamp
// is what protects the detector from a value that got past it.
const LiveSetting kLiveSettings[] = {
    {"diff_threshold", 1, 255, true,
     [](const CameraConfig& c) { return static_cast<double>(c.diff_threshold); },
     [](CameraConfig& c, double v) { c.diff_threshold = static_cast<std::uint8_t>(v); }},
    {"adaptive_k", 0, 10, false,
     [](const CameraConfig& c) { return c.adaptive_k; },
     [](CameraConfig& c, double v) { c.adaptive_k = v; }},
    {"blur_radius", 0, 5, true,
     [](const CameraConfig& c) { return static_cast<double>(c.blur_radius); },
     [](CameraConfig& c, double v) { c.blur_radius = static_cast<int>(v); }},
    {"morph_open", 0, 5, true,
     [](const CameraConfig& c) { return static_cast<double>(c.morph_open); },
     [](CameraConfig& c, double v) { c.morph_open = static_cast<int>(v); }},
    {"morph_close", 0, 8, true,
     [](const CameraConfig& c) { return static_cast<double>(c.morph_close); },
     [](CameraConfig& c, double v) { c.morph_close = static_cast<int>(v); }},
    {"min_blob_area", 1, 5000, true,
     [](const CameraConfig& c) { return static_cast<double>(c.min_blob_area); },
     [](CameraConfig& c, double v) { c.min_blob_area = static_cast<std::size_t>(v); }},
    {"max_blob_area_ratio", 0.001, 1, false,
     [](const CameraConfig& c) { return c.max_blob_area_ratio; },
     [](CameraConfig& c, double v) { c.max_blob_area_ratio = v; }},
    {"min_blob_fill_ratio", 0, 1, false,
     [](const CameraConfig& c) { return c.min_blob_fill_ratio; },
     [](CameraConfig& c, double v) { c.min_blob_fill_ratio = v; }},
    {"max_blob_aspect", 1, 50, false,
     [](const CameraConfig& c) { return c.max_blob_aspect; },
     [](CameraConfig& c, double v) { c.max_blob_aspect = v; }},
    {"border_ignore_px", 0, 200, true,
     [](const CameraConfig& c) { return static_cast<double>(c.border_ignore_px); },
     [](CameraConfig& c, double v) { c.border_ignore_px = static_cast<int>(v); }},
    {"confirm_m", 1, 10, true,
     [](const CameraConfig& c) { return static_cast<double>(c.confirm_m); },
     [](CameraConfig& c, double v) { c.confirm_m = static_cast<int>(v); }},
    {"confirm_n", 1, 30, true,
     [](const CameraConfig& c) { return static_cast<double>(c.confirm_n); },
     [](CameraConfig& c, double v) { c.confirm_n = static_cast<int>(v); }},
    {"bg_learn_rate", 0, 1, false,
     [](const CameraConfig& c) { return c.bg_learn_rate; },
     [](CameraConfig& c, double v) { c.bg_learn_rate = v; }},
    {"bg_learn_rate_fg", 0, 1, false,
     [](const CameraConfig& c) { return c.bg_learn_rate_fg; },
     [](CameraConfig& c, double v) { c.bg_learn_rate_fg = v; }},
    // The per-pixel hold counter is 16 bits wide.
    {"bg_hold_frames", 0, 60000, true,
     [](const CameraConfig& c) { return static_cast<double>(c.bg_hold_frames); },
     [](CameraConfig& c, double v) { c.bg_hold_frames = static_cast<int>(v); }},
    {"illumination_hot_ratio", 0.01, 1, false,
     [](const CameraConfig& c) { return c.illumination_hot_ratio; },
     [](CameraConfig& c, double v) { c.illumination_hot_ratio = v; }},
    // Capture: rpicam-vid arguments, so the camera worker restarts the capture
    // when one of them moves. 0 is "keep", so each setter applies its own
    // floor, the same as the config file loader's.
    {"capture_width", 0, 1920, true,
     [](const CameraConfig& c) { return static_cast<double>(c.width); },
     [](CameraConfig& c, double v) {
         // Keeps the aspect ratio already there, with even sizes for the ISP.
         const double aspect = c.width > 0 && c.height > 0
                                   ? static_cast<double>(c.height) / c.width
                                   : 9.0 / 16.0;
         c.width = std::max(320, static_cast<int>(v)) / 2 * 2;
         c.height = static_cast<int>(std::lround(c.width * aspect)) / 2 * 2;
     },
     true},
    {"shutter_us", 0, 1000000, true,
     [](const CameraConfig& c) { return static_cast<double>(c.shutter_us); },
     [](CameraConfig& c, double v) { c.shutter_us = std::max(100, static_cast<int>(v)); },
     true},
    {"analogue_gain", 0, 32, false,
     [](const CameraConfig& c) { return c.analogue_gain; },
     [](CameraConfig& c, double v) { c.analogue_gain = std::max(1.0, v); },
     true},
};

bool parse_number(const std::string& text, double& out) {
    try {
        std::size_t used = 0;
        const double value = std::stod(text, &used);
        if (used != text.size() || !std::isfinite(value)) return false;
        out = value;
        return true;
    } catch (...) {
        return false;
    }
}

}  // namespace

bool apply_live_setting(CameraConfig& cfg, const std::string& key,
                        const std::string& value) {
    for (const auto& setting : kLiveSettings) {
        if (key != setting.key) continue;
        double number = 0.0;
        if (!parse_number(value, number)) return false;
        if (setting.zero_keeps && number == 0.0) return true;
        number = std::clamp(number, setting.min, setting.max);
        if (setting.integer) number = std::round(number);
        setting.set(cfg, number);
        return true;
    }
    return false;
}

std::size_t apply_live_settings(CameraConfig& cfg, const LiveSettings& fields) {
    std::size_t refused = 0;
    for (const auto& [key, value] : fields) {
        if (!apply_live_setting(cfg, key, value)) ++refused;
    }
    cfg.confirm_n = std::max(cfg.confirm_n, cfg.confirm_m);
    return refused;
}

std::string format_live_settings(const CameraConfig& cfg) {
    std::ostringstream out;
    out << std::setprecision(6);
    bool first = true;
    for (const auto& setting : kLiveSettings) {
        if (!first) out << ',';
        first = false;
        out << setting.key << '=' << setting.get(cfg);
    }
    return out.str();
}

bool capture_settings_differ(const CameraConfig& a, const CameraConfig& b) {
    return a.width != b.width || a.height != b.height ||
           a.shutter_us != b.shutter_us || a.analogue_gain != b.analogue_gain ||
           a.sensor_mode != b.sensor_mode;
}

void keep_capture_settings(CameraConfig& cfg, const CameraConfig& from) {
    cfg.width = from.width;
    cfg.height = from.height;
    cfg.shutter_us = from.shutter_us;
    cfg.analogue_gain = from.analogue_gain;
    cfg.sensor_mode = from.sensor_mode;
}

std::string live_sensor_mode(const CameraConfig& file_cfg, const CameraConfig& cfg) {
    const bool same_size = cfg.width == file_cfg.width && cfg.height == file_cfg.height;
    // A mode set in the config file is the site's choice; keep it.
    if (same_size || !file_cfg.sensor_mode.empty()) return file_cfg.sensor_mode;
    // Another aspect ratio would not be a scaled copy of the 1080p crop anyway.
    return cfg.width * 9 == cfg.height * 16 ? kSensorMode1080p : std::string();
}

CameraIntrinsics live_intrinsics(const CameraConfig& file_cfg, const CameraConfig& cfg) {
    CameraIntrinsics in;
    in.fx = cfg.fx;
    in.fy = cfg.fy;
    in.cx = cfg.cx;
    in.cy = cfg.cy;
    in.k1 = cfg.k1;
    in.k2 = cfg.k2;
    in.p1 = cfg.p1;
    in.p2 = cfg.p2;
    in.k3 = cfg.k3;
    in.fov_deg = cfg.fov_deg;
    in.image_width = cfg.width;
    in.image_height = cfg.height;
    if (cfg.width == file_cfg.width && cfg.height == file_cfg.height) return in;
    if (file_cfg.width <= 0 || file_cfg.height <= 0) return in;

    Observation at_file;
    at_file.intrinsics = in;
    at_file.intrinsics.image_width = file_cfg.width;
    at_file.intrinsics.image_height = file_cfg.height;
    at_file.image_width = file_cfg.width;
    at_file.image_height = file_cfg.height;
    at_file.fov_deg = file_cfg.fov_deg;
    const CameraIntrinsics base = effective_intrinsics(at_file);
    const double sx = static_cast<double>(cfg.width) / file_cfg.width;
    const double sy = static_cast<double>(cfg.height) / file_cfg.height;
    // Distortion is in normalised coordinates and does not change. Pixel
    // centres sit at integer coordinates, hence the half-pixel shifts.
    in.fx = base.fx * sx;
    in.fy = base.fy * sy;
    in.cx = (base.cx + 0.5) * sx - 0.5;
    in.cy = (base.cy + 0.5) * sy - 0.5;
    return in;
}

}  // namespace pavois
