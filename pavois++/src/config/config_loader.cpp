#include "pavois/config/app_config.hpp"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>
#include <string>

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

}  // namespace

AppConfig load_config_file(const std::string& path) {
    AppConfig config;
    std::ifstream in(path);
    if (!in) {
        return config;
    }

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
            if (key == "device") config.device = value;
            else if (key == "width") config.width = std::stoi(value);
            else if (key == "height") config.height = std::stoi(value);
            else if (key == "frames") config.frames = std::stoi(value);
            else if (key == "diff_threshold") config.diff_threshold = static_cast<std::uint8_t>(std::stoi(value));
            else if (key == "min_blob_area") config.min_blob_area = static_cast<std::size_t>(std::stoul(value));
            else if (key == "json_output") config.json_output = parse_bool(value);
            else if (key == "config_path") config.config_path = value;
        } catch (...) {
            // Ignore malformed values and keep defaults.
        }
    }

    return config;
}

}  // namespace pavois

