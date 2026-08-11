#pragma once

#include <string>

namespace pavois {

struct AppConfig {
    std::string device = "/dev/video0";
    int width = 1280;
    int height = 720;
    int frames = -1;
};

}  // namespace pavois

