#include "pavois/capture/frame_source.hpp"
#include "pavois/config/app_config.hpp"
#include "pavois/runtime/camera_worker.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <sstream>
#include <thread>
#include <sys/stat.h>

namespace fs = std::filesystem;

static void require(bool ok, const std::string& message) {
    if (!ok) throw std::runtime_error(message);
}

static std::string read_file(const fs::path& path) {
    std::ifstream input(path);
    return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

static std::string affinity(const std::string& status) {
    const auto first = status.find("Cpus_allowed_list:");
    return status.substr(first, status.find('\n', first) - first);
}

int main() {
    char pattern[] = "/tmp/pavois-csi-test.XXXXXX";
    const char* dir = ::mkdtemp(pattern);
    if (!dir) return 1;
    const std::string old_path = std::getenv("PATH") ? std::getenv("PATH") : "/usr/bin:/bin";
    int status = 0;
    try {
        // Deterministic YUV420 producer. No hardware is required to check Y
        // plane extraction, frame boundaries, settings and subprocess handling.
        const fs::path root(dir);
        std::ofstream(root / "rpicam-vid")
            << "#!/bin/sh\n"
               "printf '%s\\n' \"$@\" > \"$0.args\"\n"
               "cat /proc/self/status > \"$0.status\"\n"
               "metadata=\n"
               "exposure= shutter= gain= awb= awbgains= codec=\n"
               "while [ $# -gt 0 ]; do\n"
               "  case \"$1\" in\n"
               "    --metadata) metadata=$2; shift 2;;\n"
               "    --exposure) exposure=$2; shift 2;;\n"
               "    --shutter) shutter=$2; shift 2;;\n"
               "    --gain) gain=$2; shift 2;;\n"
               "    --awb) awb=$2; shift 2;;\n"
               "    --awbgains) awbgains=$2; shift 2;;\n"
               "    --codec) codec=$2; shift 2;;\n"
               "    *) shift;;\n"
               "  esac\n"
               "done\n"
               "[ \"$exposure\" = sport ] && [ \"$awb\" = custom ] &&\n"
               "[ \"$awbgains\" = 1,1 ] && [ \"$codec\" = yuv420 ] || exit 64\n"
               "{ printf 'FrameWallClock=1700000000000000000\\n\\n'; "
               "printf 'FrameWallClock=1700000000033333000\\n\\n'; } >\"$metadata\" &\n"
               "printf '\\001\\002\\003\\004\\005\\006\\007\\010"
               "\\011\\012\\013\\014\\015\\016\\017\\020"
               "\\021\\022\\023\\024\\025\\026\\027\\030'\n";
        ::chmod((root / "rpicam-vid").c_str(), 0700);
        ::setenv("PATH", (root.string() + ':' + old_path).c_str(), 1);

        pavois::CameraConfig cfg;
        cfg.device = "csi:0";
        cfg.width = 4;
        cfg.height = 2;
        for (int rate : {0, 10, 20, 30, 60}) {
            cfg.fps = rate;
            cfg.limit_fps = rate == 60;
            auto source = pavois::make_frame_source(cfg);
            require(source->open(), "CSI source must open");
            pavois::GrayFrame frame;
            for (int n = 0; n < 2; ++n) {
                const bool got_frame = source->read_frame(frame);
                require(got_frame, "complete frame must be readable: " +
                                       source->last_error());
                require(frame.width == 4 && frame.height == 2 && frame.size() == 8,
                        "frame dimensions must match capture configuration");
                require(frame.captured_us == 1700000000000000ULL +
                                                 static_cast<std::uint64_t>(n) * 33333ULL,
                        "sensor timestamp must stay aligned with the decoded frame");
                for (int i = 0; i < 8; ++i)
                    require(frame.pixels[i] == n * 12 + i + 1,
                            "Y plane frame boundaries and pixels must be preserved");
            }
            require(!source->read_frame(frame), "EOF must not become a stale frame");
            const auto args = read_file(root / "rpicam-vid.args");
            const int expected_rate = cfg.limit_fps ? rate : 1000;
            require(args.find("--framerate\n" + std::to_string(expected_rate) + "\n") != std::string::npos,
                    "legacy caps must be bypassed unless explicitly enabled");
            require(args.find("--shutter\n0\n") != std::string::npos &&
                    args.find("--gain\n0.000000\n") != std::string::npos,
                    "default exposure must adapt to scene lighting");
        }
        // Exercise the actual worker launch path: the camera subprocess must
        // keep all initially allowed CPUs, even when detector pinning is on.
        const auto original_affinity = affinity(read_file("/proc/self/status"));
        cfg.frames = 1;
        cfg.shutter_us = 750;
        cfg.analogue_gain = 4.0;
        pavois::AppConfig app;
        pavois::FusionEngine fusion(pavois::FusionSettings{});
        std::ostringstream log;
        std::mutex log_mutex;
        pavois::CameraWorker worker(cfg, app, fusion, log, log_mutex,
                                   nullptr, nullptr, nullptr, nullptr, nullptr, false);
        std::thread detector_thread(std::ref(worker));
        detector_thread.join();
        require(affinity(read_file(root / "rpicam-vid.status")) == original_affinity,
                "camera process must not inherit detector-only CPU affinity");
        const auto manual_args = read_file(root / "rpicam-vid.args");
        require(manual_args.find("--shutter\n750\n") != std::string::npos &&
                manual_args.find("--gain\n4.000000\n") != std::string::npos,
                "explicit manual exposure must remain available");
        const auto config_path = root / "auto.conf";
        std::ofstream(config_path) << "camera.0.device=csi:0\ncamera.0.fps=0\n"
                                     "camera.0.shutter_us=0\ncamera.0.analogue_gain=0\n";
        const auto loaded = pavois::load_config_file(config_path.string());
        require(!loaded.cameras[0].limit_fps && loaded.cameras[0].fps == 0 && loaded.cameras[0].shutter_us == 0 &&
                loaded.cameras[0].analogue_gain == 0,
                "config normalization must preserve maximum rate and auto exposure");
        std::ofstream(config_path) << "camera.0.device=csi:0\ncamera.0.limit_fps=true\ncamera.0.fps=60\n";
        const auto limited = pavois::load_config_file(config_path.string());
        require(limited.cameras[0].limit_fps && limited.cameras[0].fps == 60,
                "operators must be able to opt into a capture limit");
        cfg.device = "csi:0;false";
        require(!pavois::make_frame_source(cfg)->open(), "camera index must not accept shell syntax");
        cfg.device = "csi:0";
        cfg.fps = -1;
        require(!pavois::make_frame_source(cfg)->open(), "negative capture rate must be rejected");
        std::cout << "CSI capture test passed\n";
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        status = 1;
    }
    ::setenv("PATH", old_path.c_str(), 1);
    fs::remove_all(dir);
    return status;
}
