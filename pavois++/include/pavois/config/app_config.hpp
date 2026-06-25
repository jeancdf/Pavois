#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace pavois {

struct AppConfig {
    std::string device = "/dev/video0";
    int width = 1280;
    int height = 720;
    int frames = -1;
    std::uint8_t diff_threshold = 25;
    std::size_t min_blob_area = 120;
    bool json_output = true;
    std::string config_path = "pavois++.conf";
};

AppConfig load_config_file(const std::string& path);

}  // namespace pavois
