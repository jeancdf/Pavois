#include "pavois/capture/frame_source.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <sys/stat.h>

namespace fs = std::filesystem;

static void require(bool ok, const char* message) {
    if (!ok) throw std::runtime_error(message);
}

static std::string read_text(const fs::path& path) {
    std::ifstream input(path);
    return {std::istreambuf_iterator<char>(input),
            std::istreambuf_iterator<char>()};
}

static void check_capture(const fs::path& root, pavois::CameraConfig cfg,
                          const std::string& expected_rate,
                          bool expect_manual_controls) {
    fs::remove(root / "rpicam-vid.args");
    auto source = pavois::make_frame_source(cfg);
    require(source->open(), "CSI source must open");
    pavois::GrayFrame frame;
    for (int n = 0; n < 2; ++n) {
        require(source->read_frame(frame), "complete frame must be readable");
        require(frame.width == 4 && frame.height == 2 && frame.size() == 8,
                "frame dimensions must match capture configuration");
        require(frame.captured_us == 1700000000000000ULL +
                                         static_cast<std::uint64_t>(n) * 33333ULL,
                "sensor timestamp must stay aligned with decoded frame");
        for (int i = 0; i < 8; ++i) {
            require(frame.pixels[i] == n * 8 + i + 1,
                    "frame boundaries and pixels must be preserved");
        }
    }
    require(!source->read_frame(frame), "EOF must not become a stale frame");

    const std::string args = read_text(root / "rpicam-vid.args");
    require(args.find("--framerate\n" + expected_rate + "\n") != std::string::npos,
            "capture rate must match the configured policy");
    const bool has_manual = args.find("--shutter\n") != std::string::npos &&
                            args.find("--gain\n") != std::string::npos &&
                            args.find("--awb\ncustom\n") != std::string::npos;
    require(has_manual == expect_manual_controls,
            "manual camera controls must require explicit opt-in");
}

int main() {
    char pattern[] = "/tmp/pavois-csi-test.XXXXXX";
    const char* dir = ::mkdtemp(pattern);
    if (!dir) return 1;
    const std::string old_path = std::getenv("PATH") ? std::getenv("PATH") : "/usr/bin:/bin";
    int status = 0;
    try {
        // Deterministic grayscale producer and passthrough decoder. No hardware
        // is required to check frame ordering, timestamps and camera controls.
        const fs::path root(dir);
        std::ofstream(root / "rpicam-vid")
            << "#!/bin/sh\n"
               "printf '%s\\n' \"$@\" >\"$0.args\"\n"
               "metadata=\n"
               "while [ $# -gt 0 ]; do\n"
               "  case \"$1\" in\n"
               "    --metadata) metadata=$2; shift 2;;\n"
               "    *) shift;;\n"
               "  esac\n"
               "done\n"
               "{ printf 'FrameWallClock=1700000000000000000\\n\\n'; "
               "printf 'FrameWallClock=1700000000033333000\\n\\n'; } >\"$metadata\" &\n"
               "printf '\\001\\002\\003\\004\\005\\006\\007\\010"
               "\\011\\012\\013\\014\\015\\016\\017\\020'\n";
        std::ofstream(root / "ffmpeg") << "#!/bin/sh\nexec /bin/cat\n";
        ::chmod((root / "rpicam-vid").c_str(), 0700);
        ::chmod((root / "ffmpeg").c_str(), 0700);
        ::setenv("PATH", (root.string() + ':' + old_path).c_str(), 1);

        pavois::CameraConfig cfg;
        cfg.device = "csi:0";
        cfg.width = 4;
        cfg.height = 2;
        cfg.fps = 10;  // legacy field values do not cap a Pi by default
        cfg.shutter_us = 750;
        cfg.analogue_gain = 4;
        cfg.awb_red_gain = 1;
        cfg.awb_blue_gain = 1;
        check_capture(root, cfg, "1000", false);

        cfg.limit_fps = true;
        cfg.fps = 60;
        cfg.manual_exposure = true;
        check_capture(root, cfg, "60", true);

        cfg.device = "csi:0;false";
        require(!pavois::make_frame_source(cfg)->open(),
                "camera index must not accept shell syntax");
        cfg.device = "csi:0";
        cfg.fps = -1;
        require(!pavois::make_frame_source(cfg)->open(),
                "negative capture rate must be rejected");
        std::cout << "CSI capture test passed\n";
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        status = 1;
    }
    ::setenv("PATH", old_path.c_str(), 1);
    fs::remove_all(dir);
    return status;
}
