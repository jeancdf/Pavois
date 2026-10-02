#include "pavois/config/live_tuning.hpp"

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
};

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

}  // namespace pavois
