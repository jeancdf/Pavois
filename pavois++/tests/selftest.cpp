// Self-tests for the Pavois++ detection/fusion pipeline.
//
// Live phone cameras are not available here, so correctness is proven with unit
// checks plus a synthetic multi-camera scene: a moving target is rendered into
// three virtual cameras (noise, lighting drift, static bright distractors) and
// the full pipeline must recover the 3D track far more accurately than the
// baseline frame-differencing detector on the identical footage.

#include "pavois/capture/replay_source.hpp"
#include "pavois/config/app_config.hpp"
#include "pavois/detection/blob_detector.hpp"
#include "pavois/detection/frame_diff.hpp"
#include "pavois/detection/image_ops.hpp"
#include "pavois/detection/motion_detector.hpp"
#include "pavois/fusion/fusion_engine.hpp"
#include "pavois/fusion/tracker.hpp"
#include "pavois/fusion/triangulation.hpp"
#include "pavois/math/kalman_cv.hpp"
#include "pavois/math/linalg.hpp"
#include "pavois/math/pose.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <random>
#include <string>
#include <vector>

using namespace pavois;

namespace {

int g_failures = 0;
int g_checks = 0;

void check(bool cond, const std::string& what) {
    ++g_checks;
    if (!cond) {
        ++g_failures;
        std::printf("  FAIL: %s\n", what.c_str());
    }
}

void check_near(double a, double b, double tol, const std::string& what) {
    ++g_checks;
    if (std::fabs(a - b) > tol) {
        ++g_failures;
        std::printf("  FAIL: %s (%.4f vs %.4f, tol %.4f)\n", what.c_str(), a, b, tol);
    }
}

constexpr double kDeg = 3.14159265358979323846 / 180.0;

// ---------------------------------------------------------------------------
// Linear algebra + Kalman
// ---------------------------------------------------------------------------
void test_linalg() {
    std::printf("[linalg]\n");
    Mat a(3, 3, {4, 3, 0, 3, 4, 0, 0, 0, 2});
    Mat inv = a.inverse();
    Mat id = a * inv;
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j)
            check_near(id(i, j), i == j ? 1.0 : 0.0, 1e-9, "A*inv(A) == I");
}

void test_kalman_cv() {
    std::printf("[kalman_cv]\n");
    KalmanCV kf;
    kf.init(2, {0.0, 0.0}, 1.0, 0.5);
    std::mt19937 rng(1);
    std::normal_distribution<double> n(0.0, 0.5);
    const double vx = 3.0, vy = -1.5, dt = 0.1;
    double x = 0.0, y = 0.0;
    for (int i = 0; i < 200; ++i) {
        x += vx * dt;
        y += vy * dt;
        kf.predict(dt);
        kf.update({x + n(rng), y + n(rng)});
    }
    const auto p = kf.position();
    const auto v = kf.velocity();
    check_near(p[0], x, 1.0, "KF position x tracks");
    check_near(p[1], y, 1.0, "KF position y tracks");
    check_near(v[0], vx, 0.6, "KF velocity x converges");
    check_near(v[1], vy, 0.6, "KF velocity y converges");
}

// ---------------------------------------------------------------------------
// Image ops
// ---------------------------------------------------------------------------
void test_image_ops() {
    std::printf("[image_ops]\n");
    const int w = 16, h = 16;
    std::vector<std::uint8_t> img(w * h, 0);
    img[8 * w + 8] = 200;
    std::vector<std::uint8_t> blurred;
    box_blur(img, blurred, w, h, 1);
    check(blurred[8 * w + 8] < 200 && blurred[8 * w + 8] > 0, "blur spreads a spike");
    check(blurred[8 * w + 7] > 0, "blur touches neighbour");

    std::vector<std::uint8_t> mask(w * h, 0);
    for (int y = 6; y < 10; ++y)
        for (int x = 6; x < 10; ++x) mask[y * w + x] = 255;
    mask[0] = 255;  // lone speckle
    morph_open(mask, w, h, 1);
    check(mask[0] == 0, "open removes lone speckle");
    check(mask[7 * w + 7] == 255, "open keeps the solid square");
}

// ---------------------------------------------------------------------------
// Geometry: projection <-> back-projection <-> triangulation
// ---------------------------------------------------------------------------
CameraIntrinsics make_intr(int w, int h, double fov) {
    CameraIntrinsics in;
    in.image_width = w;
    in.image_height = h;
    in.fov_deg = fov;
    const double half = fov * 0.5 * kDeg;
    in.fx = (w * 0.5) / std::tan(half);
    in.fy = in.fx;
    in.cx = w * 0.5;
    in.cy = h * 0.5;
    return in;
}

CameraPose look_at(const Vec3& eye, const Vec3& target) {
    CameraPose p;
    p.x = eye.x;
    p.y = eye.y;
    p.z = eye.z;
    const double dx = target.x - eye.x;
    const double dy = target.y - eye.y;
    const double dz = target.z - eye.z;
    p.heading_deg = std::atan2(dx, dy) / kDeg;  // compass: CW from North
    p.elevation_deg = std::atan2(dz, std::sqrt(dx * dx + dy * dy)) / kDeg;
    return p;
}

void test_geometry_roundtrip() {
    std::printf("[geometry]\n");
    const auto in = make_intr(1280, 720, 70.0);
    const Vec3 target{3.0, 28.0, 14.0};
    const CameraPose pose = look_at({-8, 0, 2}, target);

    auto px = project_world_to_pixel(in, pose, target);
    check(px.has_value(), "target projects in front of camera");
    if (px) {
        check_near((*px)[0], in.cx, 2.0, "look-at target lands near cx");
        check_near((*px)[1], in.cy, 2.0, "look-at target lands near cy");
        Ray r = pixel_to_ray(in, pose, (*px)[0], (*px)[1]);
        // The ray from the camera through that pixel must point at the target.
        const Vec3 to_t = normalize(v_sub(target, r.origin));
        check_near(v_dot(to_t, r.direction), 1.0, 1e-6, "pixel->ray points back at target");
    }

    // Distortion round-trip.
    CameraIntrinsics dist = in;
    dist.k1 = -0.12;
    dist.k2 = 0.03;
    double xn = 0, yn = 0;
    undistort_pixel(dist, 1100.0, 620.0, xn, yn);
    const double r2 = xn * xn + yn * yn;
    const double f = 1.0 + dist.k1 * r2 + dist.k2 * r2 * r2;
    check_near(dist.cx + dist.fx * xn * f, 1100.0, 0.2, "undistort/redistort x round-trips");
    check_near(dist.cy + dist.fy * yn * f, 620.0, 0.2, "undistort/redistort y round-trips");
}

std::vector<Observation> synthetic_observations(const Vec3& target,
                                                const std::vector<CameraPose>& poses,
                                                const CameraIntrinsics& in, double noise_px,
                                                std::mt19937& rng) {
    std::normal_distribution<double> n(0.0, noise_px);
    std::vector<Observation> obs;
    for (std::size_t i = 0; i < poses.size(); ++i) {
        auto px = project_world_to_pixel(in, poses[i], target);
        if (!px) continue;
        Observation o;
        o.camera_id = "cam" + std::to_string(i);
        o.image_width = in.image_width;
        o.image_height = in.image_height;
        o.intrinsics = in;
        o.pose = poses[i];
        o.centroid_x = (*px)[0] + n(rng);
        o.centroid_y = (*px)[1] + n(rng);
        o.quality = 0.8;
        o.captured_us = 1000;
        obs.push_back(o);
    }
    return obs;
}

void test_triangulation() {
    std::printf("[triangulation]\n");
    const auto in = make_intr(1280, 720, 70.0);
    const Vec3 target{2.0, 30.0, 12.0};
    std::vector<CameraPose> poses = {
        look_at({-12, -2, 2}, target),
        look_at({11, 1, 2}, target),
        look_at({0, -14, 3}, target),
    };
    std::mt19937 rng(7);

    TriangulationConfig cfg;
    cfg.min_parallax_deg = 1.5;
    cfg.max_residual_m = 3.0;
    cfg.max_range_m = 80.0;

    double err_sum = 0.0;
    int trials = 40;
    for (int t = 0; t < trials; ++t) {
        auto obs = synthetic_observations(target, poses, in, 1.0, rng);
        auto res = triangulate(obs, cfg);
        check(res.ok, "triangulate succeeds on clean 3-camera data");
        if (res.ok) {
            err_sum += v_norm(v_sub(res.point, target));
        }
    }
    check(err_sum / trials < 1.5, "mean triangulation error < 1.5 m");

    // Outlier rejection: corrupt one camera badly, RANSAC should drop it.
    auto obs = synthetic_observations(target, poses, in, 0.5, rng);
    obs[1].centroid_x += 180.0;
    obs[1].centroid_y -= 120.0;
    auto res = triangulate(obs, cfg);
    check(res.ok, "triangulate still succeeds with one outlier");
    if (res.ok) {
        check(v_norm(v_sub(res.point, target)) < 3.0, "RANSAC keeps error bounded with outlier");
        check(res.cameras.size() == 2, "outlier camera dropped from inlier set");
    }

    // Parallax gate: two nearly-collinear rays must be rejected.
    std::vector<CameraPose> near = {look_at({0, 0, 2}, target), look_at({0.2, 0, 2}, target)};
    auto tight = synthetic_observations(target, near, in, 0.3, rng);
    auto rej = triangulate(tight, cfg);
    check(!rej.ok, "low-parallax pair rejected");
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------
void test_tracker() {
    std::printf("[tracker]\n");
    TrackerConfig cfg;
    cfg.confirm_updates = 3;
    cfg.max_coast_ms = 500;
    cfg.max_speed_mps = 50.0;
    Tracker tr(cfg);

    std::uint64_t t = 0;
    Vec3 p{0, 20, 5};
    int emits = 0;
    for (int i = 0; i < 6; ++i) {
        t += 50000;
        p.x += 0.5;
        if (tr.update(p, t, 0.8, {"cam0", "cam1"})) ++emits;
    }
    check(emits >= 1, "track confirmed and emitted after enough updates");

    // Speed jump rejection.
    auto before = tr.tick(t);
    check(!before.empty(), "confirmed track alive on tick");
    t += 50000;
    tr.update({500, 20, 5}, t, 0.8, {"cam0"});  // impossible jump
    auto after = tr.tick(t);
    check(!after.empty() && v_norm(v_sub(Vec3{after[0].x, after[0].y, after[0].z}, p)) < 5.0,
          "impossible jump ignored, track stays put");

    // Coasting then deletion.
    t += 2000000;  // 2 s of silence
    auto gone = tr.tick(t);
    check(gone.empty(), "stale track deleted after max_coast_ms");
}

// ---------------------------------------------------------------------------
// Synthetic scene: render + full pipeline vs baseline detector
// ---------------------------------------------------------------------------
struct Scene {
    int w = 640, h = 360;
    CameraIntrinsics in;
    std::vector<CameraPose> poses;
};

void render_frame(const Scene& sc, std::size_t cam, const Vec3& target, int t_idx,
                  std::mt19937& rng, GrayFrame& out) {
    out.width = sc.w;
    out.height = sc.h;
    out.pixels.assign(static_cast<std::size_t>(sc.w) * sc.h, 0);
    std::normal_distribution<double> noise(0.0, 3.0);

    const double drift = 12.0 * std::sin(t_idx * 0.03);  // slow global lighting drift
    for (int y = 0; y < sc.h; ++y) {
        for (int x = 0; x < sc.w; ++x) {
            double v = 110.0 + drift + 0.02 * x + 0.01 * y + noise(rng);
            // Static bright distractors (must NOT be detected: they never move).
            if (x > 90 && x < 130 && y > 60 && y < 110) v += 80.0;
            if (x > sc.w - 120 && x < sc.w - 70 && y > 40 && y < 90) v += 70.0;
            out.pixels[static_cast<std::size_t>(y) * sc.w + x] =
                static_cast<std::uint8_t>(std::clamp(v, 0.0, 255.0));
        }
    }

    auto px = project_world_to_pixel(sc.in, sc.poses[cam], target);
    if (px) {
        const double cx = (*px)[0], cy = (*px)[1];
        const double radius = 6.0;
        for (int dy = -10; dy <= 10; ++dy) {
            for (int dx = -10; dx <= 10; ++dx) {
                const int x = static_cast<int>(cx) + dx;
                const int y = static_cast<int>(cy) + dy;
                if (x < 0 || y < 0 || x >= sc.w || y >= sc.h) continue;
                const double d2 = dx * dx + dy * dy;
                const double g = 150.0 * std::exp(-d2 / (2 * radius * radius / 3.0));
                auto& pix = out.pixels[static_cast<std::size_t>(y) * sc.w + x];
                pix = static_cast<std::uint8_t>(std::clamp(pix + g, 0.0, 255.0));
            }
        }
    }
}

Vec3 target_at(int i) {
    const double s = i * 0.05;
    return {6.0 * std::sin(s), 26.0 + 3.0 * std::cos(s * 0.7), 11.0 + 2.5 * std::sin(s * 1.3)};
}

double baseline_pixel_error(const Scene& sc) {
    // Baseline: raw 2-frame diff + largest-blob centroid (the original pipeline).
    std::mt19937 rng(100);
    const std::size_t cam = 0;
    GrayFrame prev, cur;
    double err_sum = 0.0;
    int count = 0;
    for (int i = 0; i < 120; ++i) {
        const Vec3 tgt = target_at(i);
        render_frame(sc, cam, tgt, i, rng, cur);
        if (i > 0) {
            auto diff = detect_pixel_changes(cur, prev, 25);
            auto blobs = detect_blobs(diff.diff_mask, cur.width, cur.height, 50);
            if (!blobs.empty()) {
                auto best = std::max_element(blobs.begin(), blobs.end(),
                                             [](const Blob& a, const Blob& b) { return a.area < b.area; });
                auto px = project_world_to_pixel(sc.in, sc.poses[cam], tgt);
                if (px) {
                    err_sum += std::hypot(best->centroid_x - (*px)[0], best->centroid_y - (*px)[1]);
                    ++count;
                }
            }
        }
        prev = cur;
    }
    return count ? err_sum / count : 1e9;
}

double detector_pixel_error(const Scene& sc) {
    std::mt19937 rng(100);
    const std::size_t cam = 0;
    CameraConfig cfg;
    cfg.width = sc.w;
    cfg.height = sc.h;
    MotionDetector det(cfg);
    GrayFrame f;
    double err_sum = 0.0;
    int count = 0;
    for (int i = 0; i < 120; ++i) {
        const Vec3 tgt = target_at(i);
        render_frame(sc, cam, tgt, i, rng, f);
        f.frame_id = i;
        f.captured_us = 1000000ULL + static_cast<std::uint64_t>(i) * 33000ULL;
        auto r = det.process(f);
        if (r.confirmed) {
            auto px = project_world_to_pixel(sc.in, sc.poses[cam], tgt);
            if (px) {
                err_sum += std::hypot(r.cx - (*px)[0], r.cy - (*px)[1]);
                ++count;
            }
        }
    }
    check(count > 60, "new detector confirms a target on most frames");
    return count ? err_sum / count : 1e9;
}

void test_scene_pipeline() {
    std::printf("[scene]\n");
    Scene sc;
    sc.in = make_intr(sc.w, sc.h, 68.0);
    const Vec3 c0 = target_at(60);
    sc.poses = {
        look_at({-13, -3, 2.0}, c0),
        look_at({12, 2, 2.2}, c0),
        look_at({1, -15, 3.0}, c0),
    };

    const double base_err = baseline_pixel_error(sc);
    const double new_err = detector_pixel_error(sc);
    std::printf("  baseline pixel error = %.2f px, new detector = %.2f px\n", base_err, new_err);
    check(new_err < base_err * 0.6, "new detector pixel error is far below baseline");
    check(new_err < 6.0, "new detector pixel error is small in absolute terms");

    // Full pipeline: 3 cameras -> FusionEngine -> 3D track vs ground truth.
    FusionSettings fs;
    fs.fusion_window_ms = 120;
    fs.fusion_emit_interval_ms = 40;
    fs.triangulation.min_parallax_deg = 1.5;
    fs.triangulation.max_residual_m = 4.0;
    fs.triangulation.max_range_m = 90.0;
    fs.tracker.confirm_updates = 3;
    fs.tracker.match_distance_m = 8.0;
    fs.tracker.max_coast_ms = 800;
    fs.tracker.max_speed_mps = 40.0;
    fs.tracker.process_noise = 200.0;
    FusionEngine fusion(fs);

    std::vector<CameraConfig> cams(3);
    std::vector<MotionDetector> dets;
    for (int c = 0; c < 3; ++c) {
        cams[c].width = sc.w;
        cams[c].height = sc.h;
        dets.emplace_back(cams[c]);
    }
    std::mt19937 rng(55);
    GrayFrame f;

    double err_sum = 0.0;
    std::vector<double> recent_err;
    int fused = 0;
    const std::uint64_t t0 = 5'000'000ULL;
    for (int i = 0; i < 260; ++i) {
        const Vec3 tgt = target_at(i);
        for (int c = 0; c < 3; ++c) {
            render_frame(sc, c, tgt, i, rng, f);
            f.frame_id = i;
            // Cameras run at ~30 fps with small per-camera phase offsets.
            f.captured_us = t0 + static_cast<std::uint64_t>(i) * 33000ULL + c * 4000ULL;
            auto r = dets[c].process(f);
            if (!r.confirmed) continue;
            Observation o;
            o.camera_id = "cam" + std::to_string(c);
            o.frame_id = i;
            o.captured_us = f.captured_us;
            o.timestamp_us = f.captured_us;
            o.image_width = sc.w;
            o.image_height = sc.h;
            o.intrinsics = sc.in;
            o.pose = sc.poses[c];
            o.centroid_x = r.cx;
            o.centroid_y = r.cy;
            o.blob_area = r.area;
            o.quality = r.quality;
            for (auto& up : fusion.submit(o)) {
                const double e = v_norm(v_sub(Vec3{up.x, up.y, up.z}, tgt));
                if (i > 40) {
                    err_sum += e;
                    ++fused;
                    recent_err.push_back(e);
                }
            }
        }
    }
    double tail = 0.0;
    const std::size_t tail_n = std::min<std::size_t>(24, recent_err.size());
    for (std::size_t k = recent_err.size() - tail_n; k < recent_err.size(); ++k) tail += recent_err[k];
    tail = tail_n ? tail / tail_n : 1e9;
    std::printf("  fused updates (after warmup) = %d, mean 3D error = %.2f m, tail(%zu) = %.2f m\n",
                fused, fused ? err_sum / fused : -1.0, tail_n, tail);
    check(fused > 40, "pipeline emits a sustained fused track");
    check(fused && err_sum / fused < 3.0, "mean fused 3D error < 3 m");
    check(tail < 3.0, "tail-window fused 3D error < 3 m");
}

void test_replay_pgm_roundtrip() {
    std::printf("[replay]\n");
    const std::string dir = "selftest_replay_tmp";
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    GrayFrame f;
    f.width = 32;
    f.height = 24;
    f.pixels.assign(32 * 24, 77);
    f.pixels[10 * 32 + 10] = 200;
    for (int i = 0; i < 4; ++i) {
        char name[64];
        std::snprintf(name, sizeof(name), "%s/frame_%03d.pgm", dir.c_str(), i);
        check(write_pgm(name, f.pixels.data(), f.width, f.height), "write_pgm ok");
    }
    ReplaySource src(dir, /*loop=*/false, /*realtime=*/false);
    check(src.open(), "replay source opens");
    GrayFrame g;
    int n = 0;
    while (src.read_frame(g)) {
        check(g.width == 32 && g.height == 24, "replay frame dims");
        check(g.at(10, 10) == 200, "replay pixel preserved");
        ++n;
    }
    check(n == 4, "replay yields all frames");
    std::filesystem::remove_all(dir, ec);
}

}  // namespace

int main() {
    test_linalg();
    test_kalman_cv();
    test_image_ops();
    test_geometry_roundtrip();
    test_triangulation();
    test_tracker();
    test_replay_pgm_roundtrip();
    test_scene_pipeline();

    std::printf("\n%d/%d checks passed\n", g_checks - g_failures, g_checks);
    if (g_failures) {
        std::printf("SELFTEST FAILED (%d failures)\n", g_failures);
        return 1;
    }
    std::printf("SELFTEST PASSED\n");
    return 0;
}
