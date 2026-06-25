#include "pavois/capture/camera.hpp"
#include "pavois/config/app_config.hpp"
#include "pavois/detection/blob_detector.hpp"
#include "pavois/detection/frame_diff.hpp"
#include "pavois/transport/event_bus.hpp"

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

namespace pavois {
namespace {

void print_usage(const char* program) {
    std::cout
        << "Usage: " << program << " [options]\n"
        << "  --config PATH   Config file (default pavois++.conf)\n"
        << "  --device PATH   V4L2 device path\n"
        << "  --width W       Requested width\n"
        << "  --height H      Requested height\n"
        << "  --frames N      Stop after N frames\n"
        << "  --threshold N   Motion threshold\n"
        << "  --min-area N    Minimum blob area\n"
        << "  --help          Show this help\n";
}

bool parse_int_arg(char** argv, int& index, int argc, int& out) {
    if (index + 1 >= argc) {
        return false;
    }
    out = std::atoi(argv[++index]);
    return true;
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
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--config" && i + 1 < argc) {
            cli_config_path = argv[i + 1];
            break;
        }
    }

    AppConfig config;
    const std::string config_path = resolve_config_path(
        cli_config_path.empty() ? config.config_path : cli_config_path);
    if (std::filesystem::exists(config_path)) {
        config = load_config_file(config_path);
        config.config_path = config_path;
    }

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--help" || arg == "-h") {
            print_usage(argv[0]);
            return 0;
        }
        if (arg == "--config") {
            ++i;
            continue;
        }
        if (arg == "--device") {
            if (i + 1 >= argc) {
                std::cerr << "Missing value for --device\n";
                return 1;
            }
            config.device = argv[++i];
            continue;
        }
        if (arg == "--width") {
            if (!parse_int_arg(argv, i, argc, config.width)) {
                std::cerr << "Missing value for --width\n";
                return 1;
            }
            continue;
        }
        if (arg == "--height") {
            if (!parse_int_arg(argv, i, argc, config.height)) {
                std::cerr << "Missing value for --height\n";
                return 1;
            }
            continue;
        }
        if (arg == "--frames") {
            if (!parse_int_arg(argv, i, argc, config.frames)) {
                std::cerr << "Missing value for --frames\n";
                return 1;
            }
            continue;
        }
        if (arg == "--threshold") {
            int tmp = 0;
            if (!parse_int_arg(argv, i, argc, tmp)) {
                std::cerr << "Missing value for --threshold\n";
                return 1;
            }
            config.diff_threshold = static_cast<std::uint8_t>(std::clamp(tmp, 0, 255));
            continue;
        }
        if (arg == "--min-area") {
            int tmp = 0;
            if (!parse_int_arg(argv, i, argc, tmp)) {
                std::cerr << "Missing value for --min-area\n";
                return 1;
            }
            config.min_blob_area = static_cast<std::size_t>(std::max(0, tmp));
            continue;
        }

        std::cerr << "Unknown argument: " << arg << "\n";
        print_usage(argv[0]);
        return 1;
    }

    V4L2Camera camera(config.device, config.width, config.height);
    if (!camera.open()) {
        std::cerr << "Camera init failed: " << camera.last_error() << "\n";
        return 1;
    }

    std::cerr << "Camera opened: " << config.device
              << " actual=" << camera.width() << "x" << camera.height()
              << " threshold=" << static_cast<int>(config.diff_threshold)
              << " min_blob_area=" << config.min_blob_area << "\n";

    GrayFrame frame;
    GrayFrame previous_frame;
    std::uint64_t frame_id = 0;

    while (config.frames < 0 || static_cast<int>(frame_id) < config.frames) {
        if (!camera.read_frame(frame)) {
            std::cerr << "Read failed: " << camera.last_error() << "\n";
            break;
        }

        frame.frame_id = frame_id;

        if (previous_frame.empty()) {
            std::cerr << "frame=" << frame_id << " warmup\n";
            previous_frame = frame;
            ++frame_id;
            continue;
        }

        const FrameDiffResult diff = detect_pixel_changes(frame, previous_frame, config.diff_threshold);
        const std::vector<Blob> blobs = detect_blobs(diff.diff_mask, frame.width, frame.height, config.min_blob_area);

        std::cerr << "frame=" << frame_id
                  << " changed=" << diff.changed_pixels
                  << " blobs=" << blobs.size() << "\n";

        for (const auto& blob : blobs) {
            DetectionEvent event = make_detection_event(frame_id, blob, diff.diff_mask);
            event.camera_id = config.device;
            emit_event(std::cout, event);
        }

        previous_frame = frame;
        ++frame_id;
    }

    return 0;
}

}  // namespace pavois

int main(int argc, char** argv) {
    return pavois::run(argc, argv);
}
