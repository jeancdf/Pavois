#pragma once

#include "pavois/config/app_config.hpp"
#include "pavois/domain/observation.hpp"

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

namespace pavois {

// Settings the VPS may change while the detector runs: the detection
// thresholds, and the capture size and exposure. The camera worker restarts
// the capture when a capture setting moves. Frame rate, pose and intrinsics are
// never remote-controlled.
using LiveSettings = std::vector<std::pair<std::string, std::string>>;

// Sets one live setting on cfg, clamped to its valid range. A capture setting
// of 0 leaves cfg's value alone (the config file's, once applied to a copy of
// it). False when the key is not live-tunable or the value is not a finite
// number; cfg is left alone.
bool apply_live_setting(CameraConfig& cfg, const std::string& key,
                        const std::string& value);

// Applies every field and returns how many were refused.
std::size_t apply_live_settings(CameraConfig& cfg, const LiveSettings& fields);

// "key=value,key=value" for every live setting, in a fixed order.
std::string format_live_settings(const CameraConfig& cfg);

// True when the two configs need different rpicam-vid arguments.
bool capture_settings_differ(const CameraConfig& a, const CameraConfig& b);

// Copies the capture size, exposure and sensor mode of `from` into cfg.
void keep_capture_settings(CameraConfig& cfg, const CameraConfig& from);

// Sensor mode for cfg's size. A size other than the config file's pins the
// OV5647 1080p crop, so the smaller or larger image shows the same view and
// the calibration still applies once scaled.
std::string live_sensor_mode(const CameraConfig& file_cfg, const CameraConfig& cfg);

// Intrinsics for the size the camera runs at. At the config file's size they
// are exactly the configured ones (fx 0 still means "derive from fov_deg").
// At any other size they are resolved at the file's size, then scaled, and
// always explicit: the VPS assumes the file size when it derives them itself.
CameraIntrinsics live_intrinsics(const CameraConfig& file_cfg, const CameraConfig& cfg);

}  // namespace pavois
