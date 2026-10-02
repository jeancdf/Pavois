#pragma once

#include "pavois/config/app_config.hpp"

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

namespace pavois {

// Detection settings the VPS may change while the detector runs. Capture
// settings (size, rate, exposure) are deliberately absent: they need the camera
// pipeline restarted. Pose and intrinsics are never remote-controlled.
using LiveSettings = std::vector<std::pair<std::string, std::string>>;

// Sets one live setting on cfg, clamped to its valid range. False when the key
// is not live-tunable or the value is not a finite number; cfg is left alone.
bool apply_live_setting(CameraConfig& cfg, const std::string& key,
                        const std::string& value);

// Applies every field and returns how many were refused.
std::size_t apply_live_settings(CameraConfig& cfg, const LiveSettings& fields);

// "key=value,key=value" for every live setting, in a fixed order.
std::string format_live_settings(const CameraConfig& cfg);

}  // namespace pavois
