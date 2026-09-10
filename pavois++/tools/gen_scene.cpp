// Generates a synthetic 3-camera replay dataset for offline testing / demos.
//
//   gen_scene <out_dir> [frames]
//
// Writes <out_dir>/cam{0,1,2}/frame_XXXX.pgm plus fps.txt, and prints a ready
// pavois++.conf snippet (camera poses + intrinsics matching the render) so you
// can run:  ./pavois_detect --config <out_dir>/scene.conf

#include "pavois/capture/replay_source.hpp"
#include "pavois/math/pose.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <random>
#include <string>
#include <vector>

using namespace pavois;
namespace fs = std::filesystem;

namespace {
constexpr double kDeg = 3.14159265358979323846 / 180.0;

CameraIntrinsics make_intr(int w, int h, double fov) {
    CameraIntrinsics in;
    in.image_width = w;
    in.image_height = h;
    in.fov_deg = fov;
    in.fx = (w * 0.5) / std::tan(fov * 0.5 * kDeg);
    in.fy = in.fx;
    in.cx = w * 0.5;
    in.cy = h * 0.5;
    return in;
}

CameraPose look_at(Vec3 e, Vec3 t) {
    CameraPose p;
    p.x = e.x; p.y = e.y; p.z = e.z;
    const double dx = t.x - e.x, dy = t.y - e.y, dz = t.z - e.z;
    p.heading_deg = std::atan2(dx, dy) / kDeg;
    p.elevation_deg = std::atan2(dz, std::sqrt(dx * dx + dy * dy)) / kDeg;
    return p;
}

Vec3 target_at(int i) {
    const double s = i * 0.05;
    return {6.0 * std::sin(s), 26.0 + 3.0 * std::cos(s * 0.7), 11.0 + 2.5 * std::sin(s * 1.3)};
}

void render(int W, int H, const CameraIntrinsics& in, const CameraPose& pose, const Vec3& tgt,
            int i, std::mt19937& rng, std::vector<std::uint8_t>& px) {
    px.assign(static_cast<std::size_t>(W) * H, 0);
    std::normal_distribution<double> noise(0.0, 3.0);
    const double drift = 12.0 * std::sin(i * 0.03);
    for (int y = 0; y < H; ++y)
        for (int x = 0; x < W; ++x) {
            double v = 110.0 + drift + 0.02 * x + 0.01 * y + noise(rng);
            if (x > 90 && x < 130 && y > 60 && y < 110) v += 80.0;
            if (x > W - 120 && x < W - 70 && y > 40 && y < 90) v += 70.0;
            px[static_cast<std::size_t>(y) * W + x] = static_cast<std::uint8_t>(std::clamp(v, 0.0, 255.0));
        }
    auto p = project_world_to_pixel(in, pose, tgt);
    if (!p) return;
    const double cx = (*p)[0], cy = (*p)[1], radius = 6.0;
    for (int dy = -12; dy <= 12; ++dy)
        for (int dx = -12; dx <= 12; ++dx) {
            const int x = static_cast<int>(cx) + dx, y = static_cast<int>(cy) + dy;
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            const double g = 150.0 * std::exp(-(dx * dx + dy * dy) / (2 * radius * radius / 3.0));
            auto& q = px[static_cast<std::size_t>(y) * W + x];
            q = static_cast<std::uint8_t>(std::clamp(q + g, 0.0, 255.0));
        }
}
}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: %s <out_dir> [frames]\n", argv[0]);
        return 1;
    }
    const std::string out = argv[1];
    const int frames = argc > 2 ? std::atoi(argv[2]) : 300;
    const int W = 640, H = 360;
    const auto in = make_intr(W, H, 68.0);
    const Vec3 c = target_at(frames / 2);
    const std::vector<Vec3> eyes = {{-13, -3, 2.0}, {12, 2, 2.2}, {1, -15, 3.0}};
    std::vector<CameraPose> poses;
    for (auto& e : eyes) poses.push_back(look_at(e, c));

    for (int cam = 0; cam < 3; ++cam) {
        const std::string dir = out + "/cam" + std::to_string(cam);
        fs::create_directories(dir);
        std::ofstream(dir + "/fps.txt") << "30\n";
        std::mt19937 rng(1000 + cam);
        std::vector<std::uint8_t> px;
        for (int i = 0; i < frames; ++i) {
            render(W, H, in, poses[cam], target_at(i), i, rng, px);
            char name[256];
            std::snprintf(name, sizeof(name), "%s/frame_%04d.pgm", dir.c_str(), i);
            write_pgm(name, px.data(), W, H);
        }
    }

    std::ofstream conf(out + "/scene.conf");
    conf << "frames=-1\nfusion_window_ms=120\nfusion_emit_interval_ms=40\n"
         << "fusion_min_parallax_deg=1.5\nfusion_max_residual_m=4.0\nfusion_max_range_m=90\n"
         << "track_confirm_updates=3\ntrack_process_noise=200\ntrack_meas_noise=2.5\n"
         << "reference_lat=48.8\nreference_lon=2.35\nreference_alt=60\n\n";
    for (int cam = 0; cam < 3; ++cam) {
        const auto& p = poses[cam];
        conf << "camera." << cam << ".id=cam" << cam << "\n"
             << "camera." << cam << ".device=" << out << "/cam" << cam << "\n"
             << "camera." << cam << ".width=" << W << "\ncamera." << cam << ".height=" << H << "\n"
             << "camera." << cam << ".fov_deg=68\n"
             << "camera." << cam << ".x=" << eyes[cam].x << "\ncamera." << cam << ".y=" << eyes[cam].y
             << "\ncamera." << cam << ".z=" << eyes[cam].z << "\n"
             << "camera." << cam << ".heading_deg=" << p.heading_deg << "\n"
             << "camera." << cam << ".elevation_deg=" << p.elevation_deg << "\n"
             << "camera." << cam << ".enabled=true\n\n";
    }
    std::printf("wrote %d frames x 3 cameras to %s\nrun: ./pavois_detect --config %s/scene.conf\n",
                frames, out.c_str(), out.c_str());
    return 0;
}
