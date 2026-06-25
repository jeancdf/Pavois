#include "pavois/config/app_config.hpp"

#include <algorithm>
#include <cctype>
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
    const std::string v = value;
    return v == "1" || v == "true" || v == "TRUE" || v == "yes" || v == "on";
}

void apply_camera_field(CameraConfig& camera, const std::string& field, const std::string& value) {
    if (field == "id") camera.id = value;
    else if (field == "device") camera.device = value;
    else if (field == "width") camera.width = std::stoi(value);
    else if (field == "height") camera.height = std::stoi(value);
    else if (field == "frames") camera.frames = std::stoi(value);
    else if (field == "diff_threshold") camera.diff_threshold = static_cast<std::uint8_t>(std::stoi(value));
    else if (field == "min_blob_area") camera.min_blob_area = static_cast<std::size_t>(std::stoul(value));
    else if (field == "x") camera.x = std::stod(value);
    else if (field == "y") camera.y = std::stod(value);
    else if (field == "z") camera.z = std::stod(value);
    else if (field == "yaw_deg") camera.yaw_deg = std::stod(value);
    else if (field == "pitch_deg") camera.pitch_deg = std::stod(value);
    else if (field == "roll_deg") camera.roll_deg = std::stod(value);
    else if (field == "fov_deg") camera.fov_deg = std::stod(value);
    else if (field == "enabled") camera.enabled = parse_bool(value);
}

void apply_legacy_field(CameraConfig& camera, const std::string& field, const std::string& value) {
    if (field == "device") camera.device = value;
    else if (field == "width") camera.width = std::stoi(value);
    else if (field == "height") camera.height = std::stoi(value);
    else if (field == "frames") camera.frames = std::stoi(value);
    else if (field == "diff_threshold") camera.diff_threshold = static_cast<std::uint8_t>(std::stoi(value));
    else if (field == "min_blob_area") camera.min_blob_area = static_cast<std::size_t>(std::stoul(value));
    else if (field == "x") camera.x = std::stod(value);
    else if (field == "y") camera.y = std::stod(value);
    else if (field == "z") camera.z = std::stod(value);
    else if (field == "yaw_deg") camera.yaw_deg = std::stod(value);
    else if (field == "pitch_deg") camera.pitch_deg = std::stod(value);
    else if (field == "roll_deg") camera.roll_deg = std::stod(value);
    else if (field == "fov_deg") camera.fov_deg = std::stod(value);
    else if (field == "enabled") camera.enabled = parse_bool(value);
}

}  // namespace

AppConfig load_config_file(const std::string& path) {
    AppConfig config;
    std::ifstream in(path);
    if (!in) {
        config.cameras.push_back(CameraConfig{});
        return config;
    }

    CameraConfig legacy_camera;
    bool saw_legacy_camera_key = false;
    std::map<std::size_t, CameraConfig> indexed_cameras;

    std::string line;
    while (std::getline(in, line)) {
        line = trim(line);
        if (line.empty() || line[0] == '#' || line[0] == ';') {
            continue;
        }

        const auto eq = line.find('=');
        if (eq == std::string::npos) {
            continue;
        }

        const std::string key = trim(line.substr(0, eq));
        const std::string value = trim(line.substr(eq + 1));

        try {
            if (key == "frames") {
                config.frames = std::stoi(value);
                continue;
            }
            if (key == "fusion_window_ms") {
                config.fusion_window_ms = std::stoi(value);
                continue;
            }
            if (key == "config_path") {
                config.config_path = value;
                continue;
            }

            if (key.rfind("camera.", 0) == 0) {
                const std::string tail = key.substr(7);
                const auto dot = tail.find('.');
                if (dot == std::string::npos) {
                    continue;
                }

                const std::string index_text = tail.substr(0, dot);
                const std::string field = tail.substr(dot + 1);
                const std::size_t index = static_cast<std::size_t>(std::stoul(index_text));
                apply_camera_field(indexed_cameras[index], field, value);
                continue;
            }

            saw_legacy_camera_key = true;
            apply_legacy_field(legacy_camera, key, value);
        } catch (...) {
            // Ignore malformed values and keep defaults.
        }
    }

    if (!indexed_cameras.empty()) {
        config.cameras.reserve(indexed_cameras.size());
        for (auto& [index, camera] : indexed_cameras) {
            (void)index;
            if (camera.frames < 0) {
                camera.frames = config.frames;
            }
            config.cameras.push_back(camera);
        }
    } else {
        if (saw_legacy_camera_key) {
            if (legacy_camera.frames < 0) {
                legacy_camera.frames = config.frames;
            }
        }
        config.cameras.push_back(legacy_camera);
    }

    return config;
}

}  // namespace pavois
