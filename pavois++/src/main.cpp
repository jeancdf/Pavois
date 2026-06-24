#include "app_config.hpp"
#include "frame_diff.hpp"
#include "v4l2_camera.hpp"

#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <string>

namespace pavois {
namespace {

void print_usage(const char* program) {
    std::cout
        << "Usage: " << program << " [options]\n"
        << "  --device PATH   V4L2 device path (default /dev/video0)\n"
        << "  --width W       Requested width (default 1280)\n"
        << "  --height H      Requested height (default 720)\n"
        << "  --frames N      Stop after N frames\n"
        << "  --help          Show this help\n";
}

bool parse_int_arg(char** argv, int& index, int argc, int& out) {
    if (index + 1 >= argc) {
        return false;
    }
    out = std::atoi(argv[++index]);
    return true;
}

}  // namespace

int run(int argc, char** argv) {
    AppConfig config;

    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--help" || arg == "-h") {
            print_usage(argv[0]);
            return 0;
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

        std::cerr << "Unknown argument: " << arg << "\n";
        print_usage(argv[0]);
        return 1;
    }

    V4L2Camera camera(config.device, config.width, config.height);
    if (!camera.open()) {
        std::cerr << "Camera init failed: " << camera.last_error() << "\n";
        return 1;
    }

    std::cout << "Camera opened: " << config.device
              << " actual=" << camera.width() << "x" << camera.height() << "\n";

    GrayFrame frame;
    GrayFrame previous_frame;
    int frame_id = 0;
    while (config.frames < 0 || frame_id < config.frames) {
        if (!camera.read_frame(frame)) {
            std::cerr << "Read failed: " << camera.last_error() << "\n";
            break;
        }

        std::cout << "frame=" << frame_id
                  << " size=" << frame.width << "x" << frame.height
                  << " pixels=" << frame.size();

        if (!frame.empty()) {
            std::cout << " first8=[";
            const std::size_t n = std::min<std::size_t>(8, frame.size());
            for (std::size_t i = 0; i < n; ++i) {
                if (i > 0) {
                    std::cout << ",";
                }
                std::cout << static_cast<int>(frame.pixels[i]);
            }
            std::cout << "]";
        }

        if (!previous_frame.empty()) {
            const FrameDiffResult diff = detect_pixel_changes(frame, previous_frame, 25);
            std::cout << " changed=" << diff.changed_pixels;
        } else {
            std::cout << " changed=warmup";
        }

        std::cout << "\n";
        previous_frame = frame;
        ++frame_id;
    }

    return 0;
}

}  // namespace pavois

int main(int argc, char** argv) {
    return pavois::run(argc, argv);
}
