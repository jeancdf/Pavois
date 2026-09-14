#include "pavois/config/app_config.hpp"
#include "pavois/fusion/fusion_engine.hpp"
#include "pavois/runtime/camera_worker.hpp"
#include "pavois/sensors/imu.hpp"
#include "pavois/transport/http_poster.hpp"
#include "pavois/transport/udp_sender.hpp"
#include "pavois/util/parallel_executor.hpp"

#include <algorithm>
#include <filesystem>
#include <iostream>
#include <memory>
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
        << "  --host NAME     UDP host to send tracks to\n"
        << "  --port PORT     UDP port to send tracks to\n"
        << "  --frames N      Override global frame limit\n"
        << "  --debug-dir DIR Dump frames/masks/overlays for tuning\n"
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
    std::string cli_host;
    std::string cli_debug_dir;
    int cli_port = 0;
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
        if (arg == "--host" && i + 1 < argc) {
            cli_host = argv[++i];
            continue;
        }
        if (arg == "--port" && i + 1 < argc) {
            cli_port = std::stoi(argv[++i]);
            continue;
        }
        if (arg == "--frames" && i + 1 < argc) {
            cli_frames = std::stoi(argv[++i]);
            cli_frames_set = true;
            continue;
        }
        if (arg == "--debug-dir" && i + 1 < argc) {
            cli_debug_dir = argv[++i];
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
    if (!cli_host.empty()) {
        config.output_host = cli_host;
    }
    if (cli_port > 0) {
        config.output_port = cli_port;
    }
    if (!cli_debug_dir.empty()) {
        config.debug_dir = cli_debug_dir;
    }

    if (config.cameras.empty()) {
        std::cerr << "No camera configured.\n";
        return 1;
    }

    const std::size_t enabled_cameras = std::count_if(
        config.cameras.begin(),
        config.cameras.end(),
        [](const CameraConfig& camera) { return camera.enabled; });

    std::shared_ptr<UdpSender> udp_sender;
    if (!config.output_host.empty() && config.output_port > 0) {
        udp_sender = std::make_shared<UdpSender>();
        if (!udp_sender->open(config.output_host, config.output_port)) {
            std::cerr << "UDP output disabled: " << udp_sender->last_error() << "\n";
            udp_sender.reset();
        } else {
            std::cerr << "UDP output: " << config.output_host << ':' << config.output_port << "\n";
        }
    }

    std::shared_ptr<HttpPoster> preview_http;
    if (config.preview_enabled) {
        const std::string host = config.preview_host.empty()
                                     ? config.output_host
                                     : config.preview_host;
        if (!host.empty() && config.preview_http_port > 0) {
            preview_http = std::make_shared<HttpPoster>();
            if (preview_http->open(host, config.preview_http_port,
                                   config.preview_http_path)) {
                std::cerr << "Preview HTTP: " << host << ':'
                          << config.preview_http_port
                          << config.preview_http_path << " @ "
                          << config.preview_fps << " fps\n";
            } else {
                std::cerr << "Preview HTTP disabled: "
                          << preview_http->last_error() << "\n";
                preview_http.reset();
            }
        }
    }

    for (auto& camera : config.cameras) {
        if (camera.frames < 0) {
            camera.frames = config.frames;
        }
    }

    FusionSettings fusion_settings;
    fusion_settings.fusion_window_ms = config.fusion_window_ms;
    fusion_settings.fusion_emit_interval_ms = config.fusion_emit_interval_ms;
    fusion_settings.triangulation.min_parallax_deg = config.fusion_min_parallax_deg;
    fusion_settings.triangulation.max_residual_m = config.fusion_max_residual_m;
    fusion_settings.triangulation.max_range_m = config.fusion_max_range_m;
    fusion_settings.triangulation.ransac_iterations = config.fusion_ransac_iterations;
    fusion_settings.tracker.gate_mahalanobis = config.track_gate_mahalanobis;
    fusion_settings.tracker.match_distance_m = config.track_match_distance_m;
    fusion_settings.tracker.process_noise = config.track_process_noise;
    fusion_settings.tracker.meas_noise = config.track_meas_noise;
    fusion_settings.tracker.confirm_updates = config.track_confirm_updates;
    fusion_settings.tracker.max_coast_ms = config.track_max_coast_ms;
    fusion_settings.tracker.max_speed_mps = config.track_max_speed_mps;
    FusionEngine fusion(fusion_settings);

    // One IMU per process, shared like UdpSender. Per-worker open_imu()
    // would CONFIG→NDOF once per camera and reset fusion on the others.
    std::shared_ptr<ImuReader> imu_reader = open_imu(config);

    auto processing_executor =
        std::make_shared<ParallelExecutor>(config.processing_threads);
    std::cerr << "Detector processing threads: "
              << processing_executor->thread_count() << "\n";

    std::mutex output_mutex;
    std::vector<std::thread> threads;
    threads.reserve(config.cameras.size());

    for (const auto& camera : config.cameras) {
        threads.emplace_back(CameraWorker(
            camera,
            config,
            fusion,
            std::cout,
            output_mutex,
            udp_sender,
            preview_http,
            processing_executor,
            imu_reader,
            enabled_cameras == 1));
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
