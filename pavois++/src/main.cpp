#include "pavois/config/app_config.hpp"
#include "pavois/fusion/fusion_engine.hpp"
#include "pavois/runtime/camera_worker.hpp"

#include <filesystem>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace pavois {
namespace {

void print_usage(const char* program) {
    std::cout
        << "Usage: " << program << " [options]\n"
        << "  --config PATH   Config file (default pavois++.conf)\n"
        << "  --frames N      Override global frame limit\n"
        << "  --help          Show this help\n";
}

std::string resolve_config_path(const std::string& requested) {
    const std::vector<std::string> candidates = {
        requested,
        "pavois++.conf",
        "pavois++/pavois++.conf",
    };
    for (const auto& candidate : candidates) {
        if (!candidate.empty() && std::filesystem::exists(candidate)) {
            return candidate;
        }
    }
    return requested;
}

}  // namespace

int run(int argc, char** argv) {
    std::string cli_config_path;
    bool cli_frames_set = false;
    int cli_frames = -1;

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--help" || arg == "-h") {
            print_usage(argv[0]);
            return 0;
        }
        if (arg == "--config" && i + 1 < argc) {
            cli_config_path = argv[++i];
            continue;
        }
        if (arg == "--frames" && i + 1 < argc) {
            cli_frames = std::stoi(argv[++i]);
            cli_frames_set = true;
            continue;
        }
        if (arg.rfind("--", 0) == 0) {
            std::cerr << "Unknown argument: " << arg << "\n";
            print_usage(argv[0]);
            return 1;
        }
    }

    AppConfig config;
    const std::string config_path = resolve_config_path(
        cli_config_path.empty() ? config.config_path : cli_config_path);
    config = load_config_file(config_path);
    config.config_path = config_path;

    if (cli_frames_set) {
        config.frames = cli_frames;
    }

    if (config.cameras.empty()) {
        std::cerr << "No camera configured.\n";
        return 1;
    }

    for (auto& camera : config.cameras) {
        if (camera.frames < 0) {
            camera.frames = config.frames;
        }
    }

    FusionEngine fusion(config.fusion_window_ms);
    std::mutex output_mutex;
    std::vector<std::thread> threads;
    threads.reserve(config.cameras.size());

    for (const auto& camera : config.cameras) {
        threads.emplace_back(CameraWorker(camera, fusion, std::cout, output_mutex));
    }

    for (auto& thread : threads) {
        if (thread.joinable()) {
            thread.join();
        }
    }

    return 0;
}

}  // namespace pavois

int main(int argc, char** argv) {
    return pavois::run(argc, argv);
}
