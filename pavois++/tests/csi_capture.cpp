#include "pavois/capture/frame_source.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <sys/stat.h>

namespace fs = std::filesystem;

static void require(bool ok, const char* message) {
    if (!ok) throw std::runtime_error(message);
}

int main() {
    char pattern[] = "/tmp/pavois-csi-test.XXXXXX";
    const char* dir = ::mkdtemp(pattern);
    if (!dir) return 1;
    const std::string old_path = std::getenv("PATH") ? std::getenv("PATH") : "/usr/bin:/bin";
    int status = 0;
    try {
        // Deterministic grayscale producer and passthrough decoder. No hardware
        // is required to check frame boundaries, pixels and subprocess handling.
        const fs::path root(dir);
        std::ofstream(root / "rpicam-vid")
            << "#!/bin/sh\nprintf '\\001\\002\\003\\004\\005\\006\\007\\010"
               "\\011\\012\\013\\014\\015\\016\\017\\020'\n";
        std::ofstream(root / "ffmpeg") << "#!/bin/sh\nexec /bin/cat\n";
        ::chmod((root / "rpicam-vid").c_str(), 0700);
        ::chmod((root / "ffmpeg").c_str(), 0700);
        ::setenv("PATH", (root.string() + ':' + old_path).c_str(), 1);

        pavois::CameraConfig cfg;
        cfg.device = "csi:0";
        cfg.width = 4;
        cfg.height = 2;
        {
            auto source = pavois::make_frame_source(cfg);
            require(source->open(), "CSI source must open");
            pavois::GrayFrame frame;
            for (int n = 0; n < 2; ++n) {
                require(source->read_frame(frame), "complete frame must be readable");
                require(frame.width == 4 && frame.height == 2 && frame.size() == 8,
                        "frame dimensions must match capture configuration");
                require(frame.captured_us > 0, "capture timestamp must be set");
                for (int i = 0; i < 8; ++i)
                    require(frame.pixels[i] == n * 8 + i + 1, "frame boundaries and pixels must be preserved");
            }
            require(!source->read_frame(frame), "EOF must not become a stale frame");
        }
        cfg.device = "csi:0;false";
        require(!pavois::make_frame_source(cfg)->open(), "camera index must not accept shell syntax");
        cfg.device = "csi:0";
        cfg.fps = 0;
        require(!pavois::make_frame_source(cfg)->open(), "zero capture rate must be rejected");
        std::cout << "CSI capture test passed\n";
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        status = 1;
    }
    ::setenv("PATH", old_path.c_str(), 1);
    fs::remove_all(dir);
    return status;
}
