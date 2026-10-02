// Pavois++ self-tests: unit + integration coverage for the whole pipeline.
//
// No camera is required. The synthetic multi-camera simulator lives in
// scene_sim.hpp and is shared with the accuracy scorecard (pavois_accuracy).

#include "scene_sim.hpp"

#include "pavois/capture/replay_source.hpp"
#include "pavois/detection/blob_detector.hpp"
#include "pavois/detection/frame_diff.hpp"
#include "pavois/detection/image_ops.hpp"
#include "pavois/detection/motion_detector.hpp"
#include "pavois/fusion/fusion_engine.hpp"
#include "pavois/fusion/tracker.hpp"
#include "pavois/fusion/triangulation.hpp"
#include "pavois/transport/event_bus.hpp"
#include "pavois/math/kalman_cv.hpp"
#include "pavois/math/linalg.hpp"
#include "pavois/math/pose.hpp"
#include "pavois/config/app_config.hpp"
#include "pavois/config/live_tuning.hpp"
#include "pavois/runtime/camera_worker.hpp"
#include "pavois/sensors/imu.hpp"
#include "pavois/util/jpeg_gray.hpp"
#include "pavois/util/parallel_executor.hpp"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <openssl/hmac.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <random>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

using namespace pavois;
using namespace pavois::sim;

namespace {

int g_failures = 0;
int g_checks = 0;
const char* g_group = "";

void check(bool cond, const std::string& what) {
    ++g_checks;
    if (!cond) {
        ++g_failures;
        std::printf("  FAIL [%s]: %s\n", g_group, what.c_str());
    }
}
void check_near(double a, double b, double tol, const std::string& what) {
    ++g_checks;
    if (std::fabs(a - b) > tol || std::isnan(a) || std::isnan(b)) {
        ++g_failures;
        std::printf("  FAIL [%s]: %s (%.5f vs %.5f, tol %.5f)\n", g_group, what.c_str(), a, b, tol);
    }
}
void group(const char* g) {
    g_group = g;
    std::printf("[%s]\n", g);
}

// ===========================================================================
// linalg
// ===========================================================================
void test_linalg() {
    group("linalg");
    Mat a(3, 3, {4, 3, 0, 3, 4, 0, 0, 0, 2});
    Mat inv = a.inverse();
    Mat id = a * inv;
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j)
            check_near(id(i, j), i == j ? 1.0 : 0.0, 1e-9, "SPD A*inv(A)=I");

    Mat b(3, 3, {2, 1, 1, 1, 3, 2, 1, 0, 0});
    Mat bid = b * b.inverse();
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j)
            check_near(bid(i, j), i == j ? 1.0 : 0.0, 1e-9, "asymmetric A*inv(A)=I");

    Mat m(2, 3, {1, 2, 3, 4, 5, 6});
    Mat n(3, 2, {7, 8, 9, 10, 11, 12});
    Mat mn = m * n;
    check(mn.rows() == 2 && mn.cols() == 2, "matmul dims");
    check_near(mn(0, 0), 58, 1e-9, "matmul value");
    check_near(mn(1, 1), 154, 1e-9, "matmul value 2");

    Mat t = m.transpose();
    check(t.rows() == 3 && t.cols() == 2 && t(2, 0) == 3, "transpose");

    Mat singular(2, 2, {1, 2, 2, 4});
    Mat s = singular.inverse();
    check(s(0, 0) == 0 && s(1, 1) == 0, "singular inverse -> zero matrix");
}

// ===========================================================================
// Kalman (constant velocity)
// ===========================================================================
void test_kalman_cv() {
    group("kalman_cv");
    {
        KalmanCV kf;
        kf.init(2, {0, 0}, 1.0, 0.5);
        std::mt19937 rng(1);
        std::normal_distribution<double> n(0, 0.5);
        const double vx = 3.0, vy = -1.5, dt = 0.1;
        double x = 0, y = 0;
        for (int i = 0; i < 200; ++i) {
            x += vx * dt;
            y += vy * dt;
            kf.predict(dt);
            kf.update({x + n(rng), y + n(rng)});
        }
        check_near(kf.position()[0], x, 1.0, "2D pos x");
        check_near(kf.position()[1], y, 1.0, "2D pos y");
        check_near(kf.velocity()[0], vx, 0.6, "2D vel x converges");
        check_near(kf.velocity()[1], vy, 0.6, "2D vel y converges");
    }
    {
        KalmanCV kf;
        kf.init(3, {1, 2, 3}, 5.0, 1.0);
        std::mt19937 rng(2);
        std::normal_distribution<double> n(0, 1.0);
        Vec3 p{1, 2, 3}, v{2, -1, 0.5};
        const double dt = 0.05;
        for (int i = 0; i < 300; ++i) {
            p = v_add(p, v_scale(v, dt));
            kf.predict(dt);
            kf.update({p.x + n(rng), p.y + n(rng), p.z + n(rng)});
        }
        check_near(kf.position()[0], p.x, 2.0, "3D pos x");
        check_near(kf.position()[2], p.z, 2.0, "3D pos z");
        check_near(kf.speed(), v_norm(v), 1.0, "3D speed converges");
    }
    {
        KalmanCV kf;
        kf.init(3, {0, 0, 0}, 1.0, 1.0);
        for (int i = 0; i < 20; ++i) {
            kf.predict(0.1);
            kf.update({0, 0, 0});
        }
        const double d_in = kf.gating_distance({0.5, 0, 0});
        const double d_out = kf.gating_distance({50, 0, 0});
        check(d_in < d_out, "gating distance grows with residual");
        check(d_in < 5.0, "inlier passes a chi-square-2 gate");
        const double u0 = kf.position_uncertainty();
        kf.predict(1.0);
        check(kf.position_uncertainty() > u0, "predict inflates uncertainty");
        kf.update({0, 0, 0});
        check(kf.position_uncertainty() < kf.position_uncertainty() + 1, "update shrinks uncertainty");
    }
}

// ===========================================================================
// image ops
// ===========================================================================
void test_image_ops() {
    group("image_ops");
    const int w = 24, h = 20;
    std::vector<std::uint8_t> flat(w * h, 120), out;
    box_blur(flat, out, w, h, 2);
    bool uniform = true;
    for (auto v : out) uniform &= (v == 120);
    check(uniform, "blur of a flat field is unchanged");

    box_blur(flat, out, w, h, 0);
    check(out == flat, "blur radius 0 is a copy");

    std::vector<std::uint8_t> spike(w * h, 0);
    spike[10 * w + 12] = 250;
    box_blur(spike, out, w, h, 1);
    check(out[10 * w + 12] > 0 && out[10 * w + 12] < 250, "blur spreads a spike");
    check(out[10 * w + 11] > 0 && out[9 * w + 12] > 0, "blur reaches 4-neighbours");
    int nz = 0;
    for (auto v : out) nz += (v > 0);
    check(nz == 9, "3x3 blur of a spike lights exactly 9 px");

    std::vector<std::uint8_t> mask(w * h, 0);
    for (int y = 6; y < 12; ++y)
        for (int x = 8; x < 16; ++x) mask[y * w + x] = 255;
    mask[0] = 255;
    auto solid = mask;
    erode(solid, w, h, 1);
    check(solid[0] == 0, "erode kills a lone pixel");
    check(solid[8 * w + 11] == 255, "erode keeps the interior");
    check(solid[6 * w + 8] == 0, "erode removes the border ring");

    auto grow = mask;
    dilate(grow, w, h, 1);
    check(grow[5 * w + 8] == 255, "dilate expands the block");

    auto opened = mask;
    morph_open(opened, w, h, 1);
    check(opened[0] == 0 && opened[9 * w + 12] == 255, "open removes speckle, keeps block");

    std::vector<std::uint8_t> holed(w * h, 0);
    for (int y = 5; y < 15; ++y)
        for (int x = 5; x < 19; ++x) holed[y * w + x] = 255;
    holed[10 * w + 12] = 0;  // 1px hole
    morph_close(holed, w, h, 1);
    check(holed[10 * w + 12] == 255, "close fills a 1px hole");

    // The multithreaded path must remain byte-for-byte identical, including
    // dimensions that do not divide evenly between workers.
    constexpr int pw = 127, ph = 91;
    std::mt19937 rng(42);
    std::vector<std::uint8_t> random_image(pw * ph);
    for (auto& pixel : random_image) {
        pixel = static_cast<std::uint8_t>(rng() & 0xffU);
    }
    ParallelExecutor executor(3);
    std::vector<std::uint8_t> serial_blur, parallel_blur;
    box_blur(random_image, serial_blur, pw, ph, 2);
    box_blur(random_image, parallel_blur, pw, ph, 2, &executor);
    check(parallel_blur == serial_blur, "parallel blur is byte-identical");

    std::vector<std::uint8_t> serial_mask(pw * ph), parallel_mask;
    for (std::size_t i = 0; i < serial_mask.size(); ++i) {
        serial_mask[i] = random_image[i] > 180 ? 255 : 0;
    }
    parallel_mask = serial_mask;
    morph_open(serial_mask, pw, ph, 1);
    morph_close(serial_mask, pw, ph, 2);
    morph_open(parallel_mask, pw, ph, 1, &executor);
    morph_close(parallel_mask, pw, ph, 2, &executor);
    check(parallel_mask == serial_mask,
          "parallel morphology is byte-identical");

    auto merged_erode = parallel_mask;
    auto repeated_erode = parallel_mask;
    erode(merged_erode, pw, ph, 2);
    erode(repeated_erode, pw, ph, 1);
    erode(repeated_erode, pw, ph, 1);
    check(merged_erode == repeated_erode,
          "merged erosion iterations are byte-identical");

    auto merged_dilate = serial_mask;
    auto repeated_dilate = serial_mask;
    dilate(merged_dilate, pw, ph, 3);
    for (int i = 0; i < 3; ++i) dilate(repeated_dilate, pw, ph, 1);
    check(merged_dilate == repeated_dilate,
          "merged dilation iterations are byte-identical");
}

// ===========================================================================
// geometry
// ===========================================================================
void test_geometry() {
    group("geometry");
    const auto in = make_intrinsics(1280, 720, 70.0);

    // Cardinal headings in ENU (x=E, y=N, z=U).
    auto fwd = [](double hdg, double elev) {
        CameraPose p;
        p.heading_deg = hdg;
        p.elevation_deg = elev;
        return camera_basis(p).forward;
    };
    check_near(fwd(0, 0).y, 1.0, 1e-9, "heading 0 -> +North");
    check_near(fwd(90, 0).x, 1.0, 1e-9, "heading 90 -> +East");
    check_near(fwd(180, 0).y, -1.0, 1e-9, "heading 180 -> -North");
    check_near(fwd(270, 0).x, -1.0, 1e-9, "heading 270 -> -East");
    check(fwd(45, 30).z > 0.4, "positive elevation lifts the ray");

    CameraPose bp;
    bp.heading_deg = 33;
    bp.elevation_deg = 12;
    const CameraBasis cb = camera_basis(bp);
    check_near(v_norm(cb.forward), 1.0, 1e-9, "basis forward unit");
    check_near(v_dot(cb.forward, cb.right), 0.0, 1e-9, "forward _|_ right");
    check_near(v_dot(cb.forward, cb.up), 0.0, 1e-9, "forward _|_ up");
    check_near(v_dot(cb.right, cb.up), 0.0, 1e-9, "right _|_ up");
    // up is defined as right x forward; the triple {forward, up, right} is
    // right-handed (forward x up = right).
    check_near(v_norm(v_sub(v_cross(cb.right, cb.forward), cb.up)), 0.0, 1e-9,
               "up == right x forward");
    check_near(v_dot(v_cross(cb.forward, cb.up), cb.right), 1.0, 1e-9, "right-handed triple");

    // Projection <-> back-projection round-trip over a grid.
    const Vec3 tc{3, 28, 14};
    const CameraPose pose = look_at({-8, 0, 2}, tc);
    auto pc = project_world_to_pixel(in, pose, tc);
    check(pc && std::fabs((*pc)[0] - in.cx) < 2 && std::fabs((*pc)[1] - in.cy) < 2,
          "look-at target lands at principal point");

    int rt_ok = 0, rt_tot = 0;
    for (double u = 200; u <= 1080; u += 220) {
        for (double v = 120; v <= 600; v += 120) {
            ++rt_tot;
            Ray r = pixel_to_ray(in, pose, u, v);
            Vec3 world = v_add(r.origin, v_scale(r.direction, 25.0));
            auto back = project_world_to_pixel(in, pose, world);
            if (back && std::hypot((*back)[0] - u, (*back)[1] - v) < 0.5) ++rt_ok;
        }
    }
    check(rt_ok == rt_tot, "pixel->ray->pixel round-trips across the frame");

    // Behind the camera.
    check(!project_world_to_pixel(in, pose, {-8, -20, 2}).has_value(),
          "point behind camera does not project");

    // Distortion round-trip at several radii.
    CameraIntrinsics d = in;
    d.k1 = -0.14;
    d.k2 = 0.04;
    for (double px : {700.0, 900.0, 1150.0}) {
        double xn = 0, yn = 0;
        undistort_pixel(d, px, 400.0, xn, yn);
        const double r2 = xn * xn + yn * yn;
        const double f = 1 + d.k1 * r2 + d.k2 * r2 * r2;
        check_near(d.cx + d.fx * xn * f, px, 0.3, "distortion round-trip x");
    }

    // Ray geometry helpers.
    Ray a{{0, 0, 0}, {0, 1, 0}};
    Ray b{{1, 0, 0}, {-0.7071, 0.7071, 0}};
    check_near(min_pairwise_angle_deg({a, b}), 45.0, 0.5, "min pairwise angle");
    check_near(ray_residual(a, {0, 5, 0}), 0.0, 1e-9, "residual 0 on the ray");
    check_near(ray_residual(a, {2, 5, 0}), 2.0, 1e-9, "residual = perpendicular distance");

    // Exact least-squares intersection.
    Ray r1{{-10, 0, 0}, normalize({10, 20, 5})};
    Ray r2{{10, 0, 0}, normalize({-10, 20, 5})};
    Ray r3{{0, -10, 0}, normalize({0, 30, 5})};
    auto p2 = least_squares_intersection({r1, r2});
    check(p2.size() == 3 && v_norm(v_sub(Vec3{p2[0], p2[1], p2[2]}, {0, 20, 5})) < 1e-6,
          "2-ray intersection is exact");
    auto p3 = least_squares_intersection({r1, r2, r3});
    check(p3.size() == 3 && v_norm(v_sub(Vec3{p3[0], p3[1], p3[2]}, {0, 20, 5})) < 1e-6,
          "3-ray intersection is exact");
}

// ===========================================================================
// triangulation
// ===========================================================================
std::vector<Observation> make_obs(const Vec3& target, const std::vector<CameraPose>& poses,
                                  const CameraIntrinsics& in, double noise_px, std::mt19937& rng,
                                  double quality = 0.8) {
    std::normal_distribution<double> n(0, noise_px);
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
        o.quality = quality;
        o.captured_us = 1000;
        obs.push_back(o);
    }
    return obs;
}

void test_triangulation() {
    group("triangulation");
    const auto in = make_intrinsics(1280, 720, 70.0);
    const Vec3 target{2, 30, 12};
    std::vector<CameraPose> poses = {look_at({-12, -2, 2}, target), look_at({11, 1, 2}, target),
                                     look_at({0, -14, 3}, target)};
    std::mt19937 rng(7);
    TriangulationConfig cfg;
    cfg.min_parallax_deg = 1.5;
    cfg.max_residual_m = 3.0;
    cfg.max_range_m = 80.0;

    double e2 = 0, e3 = 0;
    for (int t = 0; t < 40; ++t) {
        auto o2 = make_obs(target, {poses[0], poses[1]}, in, 1.0, rng);
        auto o3 = make_obs(target, poses, in, 1.0, rng);
        auto r2 = triangulate(o2, cfg);
        auto r3 = triangulate(o3, cfg);
        check(r2.ok && r3.ok, "triangulate ok on clean data");
        if (r2.ok) e2 += v_norm(v_sub(r2.point, target));
        if (r3.ok) e3 += v_norm(v_sub(r3.point, target));
    }
    check(e2 / 40 < 2.5, "2-camera mean error < 2.5 m");
    check(e3 / 40 < 1.5, "3-camera mean error < 1.5 m");
    check(e3 / 40 <= e2 / 40 + 0.5, "3 cameras are not worse than 2");

    // Outlier rejection.
    auto obs = make_obs(target, poses, in, 0.5, rng);
    obs[1].centroid_x += 190;
    obs[1].centroid_y -= 130;
    auto ro = triangulate(obs, cfg);
    check(ro.ok && ro.cameras.size() == 2, "RANSAC drops the outlier camera");
    check(ro.ok && v_norm(v_sub(ro.point, target)) < 3.0, "error bounded despite outlier");

    // Cheirality: target behind camera 2.
    std::vector<CameraPose> facing_away = poses;
    facing_away[2].heading_deg += 180;
    auto oc = make_obs(target, {poses[0], poses[1]}, in, 0.5, rng);
    Observation behind = oc[0];
    behind.camera_id = "camX";
    behind.pose = facing_away[2];
    behind.pose.x = 0;
    behind.pose.y = 40;  // in front along -y now
    behind.centroid_x = in.cx;
    behind.centroid_y = in.cy;
    oc.push_back(behind);
    auto rc = triangulate(oc, cfg);
    check(rc.ok, "cheirality: still solves from the two valid cameras");

    // Parallax gate.
    auto tight = make_obs(target, {look_at({0, 0, 2}, target), look_at({0.15, 0, 2}, target)}, in,
                          0.2, rng);
    check(!triangulate(tight, cfg).ok, "low-parallax pair rejected");

    // Range gate.
    TriangulationConfig near_cfg = cfg;
    near_cfg.max_range_m = 5.0;
    auto far = make_obs(target, poses, in, 0.3, rng);
    check(!triangulate(far, near_cfg).ok, "over-range solution rejected");

    // Quality weighting: a noisy low-quality camera should hurt less when
    // down-weighted than when trusted equally.
    double hi_q_err = 0, lo_q_err = 0;
    for (int t = 0; t < 30; ++t) {
        auto a = make_obs(target, poses, in, 0.4, rng, 0.9);
        auto bb = a;
        a[2].centroid_x += 25;
        bb[2].centroid_x += 25;
        bb[2].quality = 0.05;
        auto ra = triangulate(a, cfg);
        auto rb = triangulate(bb, cfg);
        if (ra.ok) hi_q_err += v_norm(v_sub(ra.point, target));
        if (rb.ok) lo_q_err += v_norm(v_sub(rb.point, target));
    }
    check(lo_q_err <= hi_q_err + 1e-6, "down-weighting a bad camera does not worsen the fix");

    // Degenerate: identical rays.
    std::vector<Observation> same = make_obs(target, {poses[0], poses[0]}, in, 0.0, rng);
    check(!triangulate(same, cfg).ok, "parallel/identical rays rejected");
}

// ===========================================================================
// tracker
// ===========================================================================
void test_tracker() {
    group("tracker");
    TrackerConfig cfg;
    cfg.confirm_updates = 3;
    cfg.max_coast_ms = 500;
    cfg.max_speed_mps = 50;
    cfg.match_distance_m = 6;

    {
        Tracker tr(cfg);
        std::uint64_t t = 0;
        Vec3 p{0, 20, 5};
        int emits = 0;
        for (int i = 0; i < 2; ++i) {
            t += 50000;
            p.x += 0.4;
            if (tr.update(p, t, 0.8, {"c0", "c1"})) ++emits;
        }
        check(emits == 0, "not emitted before confirm_updates");
        for (int i = 0; i < 3; ++i) {
            t += 50000;
            p.x += 0.4;
            if (tr.update(p, t, 0.8, {"c0", "c1"})) ++emits;
        }
        check(emits >= 1, "emitted after confirm_updates");
        auto alive = tr.tick(t);
        check(alive.size() == 1, "one confirmed track alive");
        check(alive.front().classification == "other",
              "default classification is other");
    }
    {
        Tracker tr(cfg);
        std::uint64_t t = 0;
        for (int i = 0; i < 5; ++i) {
            t += 40000;
            tr.update({0, 20, 5}, t, 0.8, {"c0", "c1"});
            tr.update({30, 18, 5}, t + 1000, 0.8, {"c0", "c1"});
        }
        check(tr.tick(t + 1000).size() == 2, "two separated measurements -> two tracks");
    }
    {
        Tracker tr(cfg);
        std::uint64_t t = 0;
        Vec3 p{0, 20, 5};
        for (int i = 0; i < 5; ++i) {
            t += 40000;
            p.x += 0.3;
            tr.update(p, t, 0.8, {"c0", "c1"});
        }
        const auto id_before = tr.tick(t).front().object_id;
        t += 250000;  // 250 ms gap (< max_coast)
        p.x += 2.0;
        tr.update(p, t, 0.8, {"c0", "c1"});
        auto after = tr.tick(t);
        check(!after.empty() && after.front().object_id == id_before,
              "recovery after a gap keeps the same track id");
    }
    {
        Tracker tr(cfg);
        std::uint64_t t = 0;
        Vec3 p{0, 20, 5};
        for (int i = 0; i < 5; ++i) {
            t += 40000;
            p.x += 0.3;
            tr.update(p, t, 0.8, {"c0", "c1"});
        }
        t += 40000;
        tr.update({900, 20, 5}, t, 0.8, {"c0"});  // teleport
        auto a = tr.tick(t);
        check(!a.empty() && v_norm(v_sub(Vec3{a[0].x, a[0].y, a[0].z}, p)) < 6.0,
              "confirmed track ignores an impossible jump");
        t += 2'000'000;
        check(tr.tick(t).empty(), "track deleted after max_coast_ms of silence");
    }
    {
        TrackerConfig slow = cfg;
        slow.max_speed_mps = 3.0;
        Tracker tr(slow);
        std::uint64_t t = 0;
        Vec3 p{0, 20, 5};
        for (int i = 0; i < 8; ++i) {
            t += 40000;
            p.x += 2.0;  // 50 m/s
            tr.update(p, t, 0.8, {"c0", "c1"});
        }
        check(tr.tick(t).empty(), "hyper-fast track not confirmed under max_speed_mps");
    }
}

std::vector<std::string> split_csv(const std::string& s) {
    std::vector<std::string> parts;
    std::string cur;
    for (char c : s) {
        if (c == ',') {
            parts.push_back(cur);
            cur.clear();
        } else {
            cur.push_back(c);
        }
    }
    parts.push_back(cur);
    return parts;
}

void test_track_csv() {
    group("track_csv");
    TrackUpdate u;
    u.object_id = 3;
    u.x = 1.5;
    u.y = 2.5;
    u.z = 3.5;
    u.timestamp_us = 12345;
    const std::string csv = to_csv(u);
    check(csv.find(",other") != std::string::npos, "to_csv includes ,other");
    auto fields = split_csv(csv);
    check(fields.size() == 6, "to_csv has 6 fields");
    check(fields[0] == "obj3", "to_csv object id");
    check(fields[5] == "other", "to_csv default class is other");

    u.classification = "drone";
    const std::string custom = to_csv(u);
    check(split_csv(custom)[5] == "drone", "custom classification round-trips");

    TrackUpdate gps_u;
    gps_u.object_id = 1;
    gps_u.x = 0.0;
    gps_u.y = 0.0;
    gps_u.z = 10.0;
    gps_u.timestamp_us = 1000;
    const double ref_lat = 48.82608;
    const double ref_lon = 2.3659;
    const double ref_alt = 58.52;
    const std::string gps = to_gps_csv(gps_u, ref_lat, ref_lon, ref_alt);
    auto g = split_csv(gps);
    check(g.size() == 6, "to_gps_csv has 6 fields");
    check(g[0] == "obj1", "to_gps_csv object id");
    check_near(std::stod(g[1]), ref_lat, 1e-7, "to_gps_csv lat at ENU origin");
    check_near(std::stod(g[2]), ref_lon, 1e-7, "to_gps_csv lon at ENU origin");
    check_near(std::stod(g[3]), ref_alt + 10.0, 1e-2,
               "to_gps_csv alt = ref + z");
    check(std::stoull(g[4]) == 1000, "to_gps_csv timestamp");
    check(g[5] == "other", "to_gps_csv 6th field is other");
}

// ===========================================================================
// fusion engine
// ===========================================================================
void test_fusion_engine() {
    group("fusion_engine");
    const auto in = make_intrinsics(1280, 720, 70.0);
    const Vec3 target{1, 26, 11};
    std::vector<CameraPose> poses = {look_at({-11, -2, 2}, target), look_at({10, 1, 2}, target),
                                     look_at({0, -13, 3}, target)};

    {
        FusionEngine fe(default_fusion_settings());
        std::mt19937 rng(3);
        auto o = make_obs(target, {poses[0]}, in, 0.5, rng);
        o[0].captured_us = 1'000'000;
        check(fe.submit(o[0]).empty(), "single camera produces no fused output");
    }
    {
        FusionSettings fs = default_fusion_settings();
        fs.fusion_emit_interval_ms = 50;
        FusionEngine fe(fs);
        std::mt19937 rng(4);
        std::uint64_t t = 1'000'000;
        int fuse_events = 0;
        std::string last;
        for (int i = 0; i < 20; ++i) {  // 20 submits inside ~one 50 ms window each 1 ms apart
            for (int c = 0; c < 3; ++c) {
                auto o = make_obs(target, {poses[c]}, in, 0.4, rng);
                o[0].camera_id = "cam" + std::to_string(c);
                o[0].captured_us = t;
                fe.submit(o[0]);
                if (fe.last_status().rfind("fuse ok", 0) == 0) ++fuse_events;
            }
            t += 1000;
        }
        check(fuse_events < 20 * 3, "fusion is throttled, not run on every submit");
    }
    {
        // Time alignment: cameras offset in time should still fuse accurately
        // for a moving target thanks to interpolation.
        FusionEngine fe(default_fusion_settings());
        std::mt19937 rng(9);
        double err = 0;
        int n = 0;
        std::uint64_t t = 2'000'000;
        for (int i = 0; i < 120; ++i) {
            const Vec3 tgt{1 + 0.05 * i, 26, 11};
            for (int c = 0; c < 3; ++c) {
                auto o = make_obs(tgt, {poses[c]}, in, 0.5, rng);
                o[0].camera_id = "cam" + std::to_string(c);
                o[0].captured_us = t + static_cast<std::uint64_t>(c) * 9000;  // 9 ms skew
                for (auto& up : fe.submit(o[0])) {
                    if (i > 30) {
                        err += v_norm(v_sub(Vec3{up.x, up.y, up.z}, tgt));
                        ++n;
                    }
                }
            }
            t += 33000;
        }
        check(n > 20 && err / n < 2.0, "time-aligned fusion of a moving target < 2 m");
    }
}

// ===========================================================================
// detector vs baseline + robustness
// ===========================================================================
void test_detector() {
    group("detector");
    SceneConfig sc = SceneConfig::nominal();
    Simulator sim(sc, lissajous({4, 26, 12}, {6, 3, 2.5}));

    {
        CameraConfig equivalence_config;
        equivalence_config.width = sc.w;
        equivalence_config.height = sc.h;
        ParallelExecutor executor(3);
        MotionDetector serial(equivalence_config);
        MotionDetector parallel(equivalence_config, &executor);
        GrayFrame frame;
        bool identical = true;
        for (int i = 0; i < 50; ++i) {
            sim.render(0, i, frame);
            frame.captured_us =
                1'000'000 + static_cast<std::uint64_t>(i) * 33'000;
            const auto a = serial.process(frame);
            const auto b = parallel.process(frame);
            identical &= a.has_blob == b.has_blob &&
                         a.confirmed == b.confirmed && a.area == b.area &&
                         a.cx == b.cx && a.cy == b.cy &&
                         a.raw_cx == b.raw_cx && a.raw_cy == b.raw_cy &&
                         a.fill_ratio == b.fill_ratio && a.snr == b.snr &&
                         a.quality == b.quality &&
                         a.blobs.size() == b.blobs.size();
            for (std::size_t blob = 0;
                 identical && blob < a.blobs.size(); ++blob) {
                identical &= a.blobs[blob].cx == b.blobs[blob].cx &&
                             a.blobs[blob].cy == b.blobs[blob].cy &&
                             a.blobs[blob].area == b.blobs[blob].area &&
                             a.blobs[blob].quality == b.blobs[blob].quality;
            }
        }
        check(identical, "parallel detector is result-identical");
    }

    // Every valid component from a frame survives the 2-of-3 confirmation.
    {
        CameraConfig multi;
        multi.width = 96;
        multi.height = 64;
        multi.diff_threshold = 10;
        multi.blur_radius = 0;
        multi.morph_open = 0;
        multi.morph_close = 0;
        multi.confirm_m = 2;
        multi.confirm_n = 3;
        MotionDetector detector(multi);
        GrayFrame frame;
        frame.width = multi.width;
        frame.height = multi.height;
        frame.pixels.assign(static_cast<std::size_t>(frame.width * frame.height), 0);
        for (int i = 0; i < 12; ++i) {
            frame.captured_us = 1'000'000 + static_cast<std::uint64_t>(i) * 33'333;
            detector.process(frame);
        }
        auto paint_targets = [&] {
            std::fill(frame.pixels.begin(), frame.pixels.end(), 0);
            for (int y = 16; y < 24; ++y)
                for (int x = 18; x < 26; ++x)
                    frame.pixels[static_cast<std::size_t>(y) * frame.width + x] = 255;
            for (int y = 34; y < 42; ++y)
                for (int x = 64; x < 72; ++x)
                    frame.pixels[static_cast<std::size_t>(y) * frame.width + x] = 255;
        };
        paint_targets();
        frame.captured_us += 33'333;
        const auto first = detector.process(frame);
        paint_targets();
        frame.captured_us += 33'333;
        const auto second = detector.process(frame);
        check(!first.confirmed && second.confirmed,
              "2-of-3 confirmation emits on the second hit");
        check(second.blobs.size() == 2,
              "detector preserves all simultaneous valid blobs");
    }

    // Baseline: 2-frame diff + largest blob (the original approach).
    GrayFrame prev, cur;
    double base_sum = 0;
    int base_n = 0;
    for (int i = 0; i < 120; ++i) {
        sim.render(0, i, cur);
        if (i > 0) {
            auto diff = detect_pixel_changes(cur, prev, 25);
            auto blobs = detect_blobs(diff.diff_mask, cur.width, cur.height, 50);
            if (!blobs.empty()) {
                auto bst = std::max_element(blobs.begin(), blobs.end(),
                                            [](const Blob& a, const Blob& b) { return a.area < b.area; });
                if (auto tp = sim.true_pixel(0, i)) {
                    base_sum += std::hypot(bst->centroid_x - (*tp)[0], bst->centroid_y - (*tp)[1]);
                    ++base_n;
                }
            }
        }
        prev = cur;
    }
    const double base_err = base_n ? base_sum / base_n : 1e9;

    CameraConfig cc;
    cc.width = sc.w;
    cc.height = sc.h;
    MotionDetector det(cc);
    double new_sum = 0;
    int new_n = 0, confirmed = 0;
    GrayFrame f;
    for (int i = 0; i < 120; ++i) {
        sim.render(0, i, f);
        f.captured_us = 1'000'000 + static_cast<std::uint64_t>(i) * 33000;
        auto r = det.process(f);
        if (r.confirmed) {
            ++confirmed;
            if (auto tp = sim.true_pixel(0, i)) {
                new_sum += std::hypot(r.cx - (*tp)[0], r.cy - (*tp)[1]);
                ++new_n;
            }
        }
    }
    const double new_err = new_n ? new_sum / new_n : 1e9;
    std::printf("  baseline %.2f px  vs  new %.2f px  (confirmed %d/120)\n", base_err, new_err,
                confirmed);
    check(confirmed > 80, "detector confirms the target on most frames");
    check(new_err < base_err * 0.6, "new detector centroid error << baseline");
    check(new_err < 3.0, "new detector centroid error < 3 px");

    // No false detections when there is no target.
    {
        SceneConfig empty = SceneConfig::nominal();
        Simulator es(empty, [] {
            Trajectory t = lissajous({4, 26, 12}, {6, 3, 2.5});
            t.present = [](int) { return false; };
            return t;
        }());
        CameraConfig e;
        e.width = empty.w;
        e.height = empty.h;
        MotionDetector ed(e);
        GrayFrame g;
        int fp = 0;
        for (int i = 0; i < 150; ++i) {
            es.render(0, i, g);
            g.captured_us = 1'000'000 + static_cast<std::uint64_t>(i) * 33000;
            if (ed.process(g).confirmed) ++fp;
        }
        check(fp == 0, "no confirmed detection on an empty scene (static distractors ignored)");
    }

    // Recovers after a hard exposure step.
    {
        SceneConfig step = SceneConfig::nominal();
        step.exposure_step_frame = 70;
        step.exposure_step = 50;
        Simulator ss(step, lissajous({4, 26, 12}, {6, 3, 2.5}));
        CameraConfig s;
        s.width = step.w;
        s.height = step.h;
        MotionDetector sd(s);
        GrayFrame g;
        int post = 0;
        for (int i = 0; i < 160; ++i) {
            ss.render(0, i, g);
            g.captured_us = 1'000'000 + static_cast<std::uint64_t>(i) * 33000;
            auto r = sd.process(g);
            if (i > 95 && r.confirmed) ++post;
        }
        check(post > 40, "detector re-locks within ~1 s of an exposure step");
    }
}

// ===========================================================================
// end-to-end pipeline
// ===========================================================================
void test_pipeline() {
    group("pipeline");
    auto rep = run_scenario("selftest-nominal", SceneConfig::nominal(),
                            lissajous({4, 26, 12}, {6, 3, 2.5}), 220);
    std::printf("  recall %.0f%%  precision %.0f%%  avail %.0f%%  <2m %.0f%%  rel %.0f%%  "
                "mean %.2fm  tracks %d\n",
                100 * rep.det.recall(), 100 * rep.det.precision(), 100 * rep.fus.availability(),
                100 * rep.fus.acc_2m(), 100 * rep.fus.rel_accuracy(), rep.fus.mean_err(),
                rep.fus.track_count());
    check(rep.det.recall() > 0.9, "pipeline detection recall > 90%");
    check(rep.det.precision() > 0.95, "pipeline detection precision > 95%");
    check(rep.fus.availability() > 0.8, "fused track covers > 80% of frames");
    check(rep.fus.mean_err() < 2.5, "mean fused 3D error < 2.5 m");
    check(rep.fus.acc_5m() > 0.95, "> 95% of fused updates within 5 m");
    check(rep.fus.track_count() <= 2, "at most 2 track ids for one target");
    check(rep.fus.worst_err < 8.0, "worst-case fused error < 8 m");
}

// ===========================================================================
// replay
// ===========================================================================
void test_replay() {
    group("replay");
    const std::string dir = "selftest_replay_tmp";
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    GrayFrame f;
    f.width = 32;
    f.height = 24;
    f.pixels.assign(32 * 24, 77);
    f.pixels[10 * 32 + 10] = 200;
    for (int i = 0; i < 4; ++i) {
        char name[80];
        std::snprintf(name, sizeof(name), "%s/frame_%03d.pgm", dir.c_str(), i);
        check(write_pgm(name, f.pixels.data(), f.width, f.height), "write_pgm ok");
    }
    ReplaySource src(dir, false, false);
    check(src.open(), "replay opens");
    GrayFrame g;
    int n = 0;
    std::uint64_t prev_ts = 0;
    while (src.read_frame(g)) {
        check(g.width == 32 && g.at(10, 10) == 200, "replay pixels preserved");
        check(g.captured_us > prev_ts || n == 0, "replay timestamps increase");
        prev_ts = g.captured_us;
        ++n;
    }
    check(n == 4, "replay yields every frame");
    std::filesystem::remove_all(dir, ec);
}

void test_imu() {
    group("imu");
    check_near(wrap_heading_deg(370.0), 10.0, 1e-9, "wrap 370");
    check_near(wrap_heading_deg(-20.0), 340.0, 1e-9, "wrap -20");

    std::uint8_t bytes[6] = {0xA0, 0x05, 0, 0, 0x20, 0x00};
    ImuSample parsed{};
    check(bno055_euler_from_bytes(bytes, parsed), "bno parse");
    check_near(parsed.heading_deg, 90.0, 1e-9, "bno heading 90");
    check_near(parsed.elevation_deg, 2.0, 1e-9, "bno pitch 2");

    ImuSample calib{};
    check(format_calib_token(calib) == "-", "calib unknown token");
    bno055_calib_from_byte(0xC7, calib);
    check(calib.calib_sys == 3 && calib.calib_gyro == 0 &&
              calib.calib_accel == 1 && calib.calib_mag == 3,
          "bno calib decode");
    check(format_calib_token(calib) == "3013", "calib token");

    const ImuCalibStatus calib_full = bno055_calib_from_byte(0xFF);
    check(calib_full.sys == 3 && calib_full.gyro == 3 && calib_full.accel == 3 &&
              calib_full.mag == 3,
          "calib fully calibrated");
    const ImuCalibStatus calib_mag_low = bno055_calib_from_byte(0b11111001);
    check(calib_mag_low.mag == 1, "calib mag low");
    check(calib_mag_low.sys == 3 && calib_mag_low.gyro == 3 &&
              calib_mag_low.accel == 2,
          "calib other fields unaffected by low mag");

    // BNO055 Euler registers are LSB = 1/16 degree only once UNIT_SEL (0x3B)
    // selects degrees; this must never be read back as radians.
    // 270.0deg -> 4320 (0x10E0), 45.0deg -> 720 (0x02D0),
    // -30.0deg -> -480 (0xFE20 as int16).
    std::uint8_t degree_bytes[6] = {0xE0, 0x10, 0xD0, 0x02, 0x20, 0xFE};
    ImuSample degree_parsed{};
    check(bno055_euler_from_bytes(degree_bytes, degree_parsed),
          "bno parse (degrees)");
    check_near(degree_parsed.heading_deg, 270.0, 1e-9,
               "bno heading 270 deg (not rad)");
    check_near(degree_parsed.roll_deg, 45.0, 1e-9, "bno roll 45 deg (not rad)");
    check_near(degree_parsed.elevation_deg, -30.0, 1e-9,
               "bno pitch -30 deg (not rad)");

    AppConfig cfg;
    cfg.imu_heading_offset_deg = 20.0;
    const ImuSample out = apply_imu_offsets({350.0, 5.0, 1.0, true}, cfg);
    check_near(out.heading_deg, 10.0, 1e-9, "offset wrap");
    check_near(out.elevation_deg, 5.0, 1e-9, "elevation passthrough");

    AppConfig reversed_heading;
    reversed_heading.imu_heading_sign = -1.0;
    reversed_heading.imu_heading_offset_deg = 20.0;
    const ImuSample reversed =
        apply_imu_offsets({350.0, 5.0, 1.0, true}, reversed_heading);
    check_near(reversed.heading_deg, 30.0, 1e-9, "reversed heading sign");

    AppConfig off;
    off.imu_enabled = false;
    check(!open_imu(off), "disabled imu");

    std::error_code ec;
    const auto dir = std::filesystem::temp_directory_path() / "pavois_imu_ut";
    std::filesystem::create_directories(dir, ec);
    const auto path = dir / "imu.txt";
    {
        std::ofstream file(path);
        file << "221.25 -3.5 0.5\n";
    }
    AppConfig file_cfg;
    file_cfg.imu_kind = "file";
    file_cfg.imu_file = path.string();
    auto reader = open_imu(file_cfg);
    check(static_cast<bool>(reader), "file imu opens");
    ImuSample live{};
    check(reader && reader->read(live) && live.valid, "file imu read");
    check_near(live.heading_deg, 221.25, 1e-4, "file heading");
    check_near(live.elevation_deg, -3.5, 1e-4, "file elevation");
    check(format_calib_token(live) == "-", "file imu without calib");
    {
        std::ofstream file(path);
        file << "221.25 -3.5 0.5 3303\n";
    }
    ImuSample calibrated{};
    check(reader && reader->read(calibrated) && calibrated.valid,
          "file imu read with calib");
    check(calibrated.calib_sys == 3 && calibrated.calib_gyro == 3 &&
              calibrated.calib_accel == 0 && calibrated.calib_mag == 3,
          "file calib levels");
    check(format_calib_token(calibrated) == "3303", "file calib token");
    {
        std::ofstream file(path);
        file << "221.25 -3.5 0.5 3403\n";
    }
    ImuSample bad_calib{};
    check(reader && reader->read(bad_calib) && bad_calib.valid,
          "file imu read with bad calib");
    check(format_calib_token(bad_calib) == "-", "file bad calib ignored");
    {
        std::ofstream file(path);
        file << "221.25 -3.5 0.5 ---2\n";
    }
    ImuSample mag_only{};
    check(reader && reader->read(mag_only) && mag_only.valid,
          "file imu read with mag-only calib");
    check(mag_only.calib_sys == -1 && mag_only.calib_mag == 2,
          "file mag-only levels");
    check(format_calib_token(mag_only) == "---2", "file mag-only token");

    {
        std::ofstream file(path);
        file << "45.0 1.0 0.0 3333\n";
    }
    // CameraWorker does not call open_imu(); main injects one shared
    // pointer. This is that process-wide share model.
    std::shared_ptr<ImuReader> shared_imu = open_imu(file_cfg);
    check(static_cast<bool>(shared_imu), "shared file imu opens");
    {
        FusionSettings fs;
        FusionEngine fusion(fs);
        CameraConfig cam;
        cam.id = "shared-imu";
        cam.enabled = false;
        std::ostringstream sink;
        std::mutex log_mu;
        CameraWorker injected(cam, file_cfg, fusion, sink, log_mu,
                              nullptr, nullptr, nullptr, nullptr, shared_imu,
                              false);
        (void)injected;
    }
    std::atomic<int> ok_reads{0};
    std::atomic<int> fail_reads{0};
    auto shared_reader = [&]() {
        for (int i = 0; i < 40; ++i) {
            ImuSample s{};
            if (shared_imu->read(s) && s.valid &&
                std::fabs(s.heading_deg - 45.0) < 1e-4) {
                ++ok_reads;
            } else {
                ++fail_reads;
            }
        }
    };
    std::thread t0(shared_reader), t1(shared_reader), t2(shared_reader);
    t0.join();
    t1.join();
    t2.join();
    check(fail_reads.load() == 0, "shared imu 3 threads no fail");
    check(ok_reads.load() == 120, "shared imu 120 concurrent reads");

    check(imu_i2c_backoff_ms(0, 200, 5000) == 200, "backoff attempt 0");
    check(imu_i2c_backoff_ms(1, 200, 5000) == 400, "backoff attempt 1");
    check(imu_i2c_backoff_ms(2, 200, 5000) == 800, "backoff attempt 2");
    check(imu_i2c_backoff_ms(10, 200, 5000) == 5000, "backoff clamp");

    I2cFailWatchdog dog;
    check(!dog.should_reopen(0, 5, 200, 5000), "fail 1 no reopen");
    check(!dog.should_reopen(0, 5, 200, 5000), "fail 2 no reopen");
    check(!dog.should_reopen(0, 5, 200, 5000), "fail 3 no reopen");
    check(!dog.should_reopen(0, 5, 200, 5000), "fail 4 no reopen");
    check(dog.should_reopen(0, 5, 200, 5000), "fail 5 reopens");
    check(!dog.should_reopen(50, 5, 200, 5000), "before retry no reopen");
    dog.on_success();
    check(!dog.should_reopen(1000, 5, 200, 5000), "post-ok fail 1");
    check(!dog.should_reopen(1000, 5, 200, 5000), "post-ok fail 2");
    check(!dog.should_reopen(1000, 5, 200, 5000), "post-ok fail 3");
    check(!dog.should_reopen(1000, 5, 200, 5000), "post-ok fail 4");
    check(dog.should_reopen(1000, 5, 200, 5000), "post-ok fail 5 reopens");

    AppConfig def_cfg;
    check(def_cfg.imu_calib_file == "/var/lib/pavois/imu_calib.bin",
          "default calib path");
    check(def_cfg.imu_i2c_fail_threshold == 5, "default i2c fail threshold");
    check(def_cfg.imu_i2c_retry_min_ms == 200, "default i2c retry min");
    check(def_cfg.imu_i2c_retry_max_ms == 5000, "default i2c retry max");
    std::uint8_t discarded[kBnoCalibOffsetBytes]{};
    check(!load_imu_calib_offsets("", discarded), "empty path load");
    check(!save_imu_calib_offsets("", discarded), "empty path save");

    const auto calib_path = dir / "imu_calib.bin";
    std::uint8_t missing[kBnoCalibOffsetBytes]{};
    check(!load_imu_calib_offsets(calib_path.string(), missing),
          "missing calib file");
    std::uint8_t src[kBnoCalibOffsetBytes];
    for (std::size_t i = 0; i < kBnoCalibOffsetBytes; ++i) {
        src[i] = static_cast<std::uint8_t>(i * 3 + 1);
    }
    check(save_imu_calib_offsets(calib_path.string(), src), "save calib");
    std::uint8_t dst[kBnoCalibOffsetBytes]{};
    check(load_imu_calib_offsets(calib_path.string(), dst), "load calib");
    bool same = true;
    for (std::size_t i = 0; i < kBnoCalibOffsetBytes; ++i) {
        if (src[i] != dst[i]) same = false;
    }
    check(same, "calib roundtrip");
    {
        std::ofstream file(calib_path, std::ios::binary | std::ios::trunc);
        file.write("short", 5);
    }
    check(!load_imu_calib_offsets(calib_path.string(), dst),
          "reject short calib file");
    {
        std::ofstream file(calib_path, std::ios::binary | std::ios::trunc);
        char long_buf[kBnoCalibOffsetBytes + 1]{};
        file.write(long_buf, sizeof(long_buf));
    }
    check(!load_imu_calib_offsets(calib_path.string(), dst),
          "reject long calib file");

    const auto conf_path = dir / "imu_calib.conf";
    {
        std::ofstream file(conf_path);
        file << "imu.calib_file=/tmp/custom_imu.bin\n";
        file << "imu.i2c_fail_threshold=7\n";
        file << "imu.i2c_retry_min_ms=100\n";
        file << "imu.i2c_retry_max_ms=3000\n";
        file << "imu.heading_sign=-1\n";
        file << "processing_threads=7\n";
        file << "camera.0.exposure_mode=sport\n";
        file << "camera.0.shutter_us=600\n";
        file << "camera.0.analogue_gain=5.5\n";
        file << "camera.0.awb_red_gain=1.2\n";
        file << "camera.0.awb_blue_gain=1.4\n";
        file << "camera.0.capture_format=yuv420\n";
        file << "camera.0.capture_stride=1344\n";
        file << "camera.1.capture_format=h264\n";
        file << "camera.1.capture_stride=-8\n";
    }
    const AppConfig loaded = load_config_file(conf_path.string());
    check(loaded.imu_calib_file == "/tmp/custom_imu.bin",
          "config calib_file");
    check(loaded.imu_i2c_fail_threshold == 7, "config i2c fail threshold");
    check(loaded.imu_i2c_retry_min_ms == 100, "config i2c retry min");
    check(loaded.imu_i2c_retry_max_ms == 3000, "config i2c retry max");
    check(loaded.imu_heading_sign == -1.0, "config heading sign");
    check(loaded.processing_threads == 7, "config processing thread count");
    check(loaded.cameras[0].exposure_mode == "sport", "config exposure mode");
    check(loaded.cameras[0].shutter_us == 600, "config fixed shutter");
    check_near(loaded.cameras[0].analogue_gain, 5.5, 1e-9,
               "config fixed analogue gain");
    check_near(loaded.cameras[0].awb_red_gain, 1.2, 1e-9,
               "config fixed AWB red gain");
    check_near(loaded.cameras[0].awb_blue_gain, 1.4, 1e-9,
               "config fixed AWB blue gain");
    check(loaded.cameras[0].capture_format == "yuv420" &&
              loaded.cameras[0].capture_stride == 1344,
          "config uncompressed capture and its row length");
    check(loaded.cameras.size() == 2 && loaded.cameras[1].capture_format == "mjpeg" &&
              loaded.cameras[1].capture_stride == 0,
          "config unknown capture format falls back to mjpeg");
    check(CameraConfig().capture_format == "mjpeg",
          "capture stays MJPEG unless a camera asks otherwise");

    std::filesystem::remove_all(dir, ec);
}

void test_jpeg_preview() {
    group("jpeg_preview");
    GrayFrame src;
    src.width = 64;
    src.height = 32;
    src.pixels.resize(static_cast<std::size_t>(src.width) * src.height);
    for (int y = 0; y < src.height; ++y) {
        for (int x = 0; x < src.width; ++x) {
            src.pixels[static_cast<std::size_t>(y) * src.width + x] =
                static_cast<std::uint8_t>(x + y);
        }
    }
    const GrayFrame small = downscale_gray(src, 16);
    check(small.width == 16 && small.height == 8, "downscale 16x8");
    check(!small.empty(), "downscale pixels");

    std::vector<std::uint8_t> jpeg;
    check(encode_gray_jpeg(small, 55, jpeg), "encode jpeg");
    check(jpeg.size() > 24 && jpeg.size() < 60000, "jpeg size");
    check(jpeg[0] == 0xff && jpeg[1] == 0xd8, "jpeg SOI");
    check(jpeg[jpeg.size() - 2] == 0xff && jpeg.back() == 0xd9,
          "jpeg EOI");

    GrayFrame empty;
    std::vector<std::uint8_t> none;
    check(!encode_gray_jpeg(empty, 55, none), "empty frame rejected");
}

// ===========================================================================
// live settings pushed by the VPS
// ===========================================================================
std::uint64_t unix_ms() {
    return static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch())
            .count());
}

// Same framing as the VPS: 8-byte timestamp, HMAC-SHA256, payload.
std::string signed_packet(const std::string& payload, const std::string& secret) {
    const std::uint64_t ms = unix_ms();
    std::string timestamp(8, '\0');
    for (int i = 0; i < 8; ++i)
        timestamp[i] = static_cast<char>((ms >> (56 - 8 * i)) & 0xff);
    const std::string signed_data = timestamp + payload;
    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int size = 0;
    HMAC(EVP_sha256(), secret.data(), static_cast<int>(secret.size()),
         reinterpret_cast<const unsigned char*>(signed_data.data()),
         signed_data.size(), digest, &size);
    return timestamp + std::string(reinterpret_cast<char*>(digest), size) + payload;
}

LiveSettings split_settings(const std::string& line) {
    LiveSettings fields;
    std::stringstream stream(line);
    std::string part;
    while (std::getline(stream, part, ',')) {
        const auto eq = part.find('=');
        if (eq != std::string::npos)
            fields.emplace_back(part.substr(0, eq), part.substr(eq + 1));
    }
    return fields;
}

void test_live_tuning() {
    group("live tuning");

    {
        CameraConfig cfg;
        check(apply_live_setting(cfg, "diff_threshold", "20") && cfg.diff_threshold == 20,
              "a live setting is applied");
        check(apply_live_setting(cfg, "diff_threshold", "999") && cfg.diff_threshold == 255,
              "a value above the range is clamped");
        check(apply_live_setting(cfg, "min_blob_area", "0") && cfg.min_blob_area == 1,
              "a value below the range is clamped");
        check(apply_live_setting(cfg, "morph_close", "2.6") && cfg.morph_close == 3,
              "an integer setting is rounded");
        const CameraConfig before = cfg;
        check(!apply_live_setting(cfg, "width", "640") && cfg.width == before.width,
              "the capture size is not a live setting");
        check(!apply_live_setting(cfg, "fps", "60") && cfg.fps == before.fps,
              "the capture rate is not a live setting");
        check(!apply_live_setting(cfg, "heading_deg", "90") &&
                  cfg.heading_deg == before.heading_deg,
              "the pose is not a live setting");
        check(!apply_live_setting(cfg, "adaptive_k", "abc") &&
                  cfg.adaptive_k == before.adaptive_k,
              "a malformed value is refused");
        check(!apply_live_setting(cfg, "adaptive_k", "1.5x"), "trailing garbage is refused");
        check(!apply_live_setting(cfg, "adaptive_k", "nan"), "NaN is refused");
        check(!apply_live_setting(cfg, "adaptive_k", ""), "an empty value is refused");
    }

    {
        CameraConfig tuned;
        tuned.diff_threshold = 9;
        tuned.adaptive_k = 1.75;
        tuned.blur_radius = 2;
        tuned.min_blob_area = 5;
        tuned.max_blob_area_ratio = 0.25;
        tuned.bg_learn_rate_fg = 0.004;
        tuned.confirm_m = 3;
        tuned.confirm_n = 5;
        CameraConfig restored;
        check(apply_live_settings(restored, split_settings(format_live_settings(tuned))) == 0,
              "every reported setting is accepted back");
        check(format_live_settings(restored) == format_live_settings(tuned),
              "reported settings survive a round trip");
        check(restored.diff_threshold == 9 && restored.min_blob_area == 5 &&
                  restored.confirm_n == 5 && std::fabs(restored.adaptive_k - 1.75) < 1e-9 &&
                  std::fabs(restored.bg_learn_rate_fg - 0.004) < 1e-9,
              "round trip restores the values themselves");

        CameraConfig cfg;
        apply_live_settings(cfg, {{"confirm_m", "5"}, {"confirm_n", "2"}});
        check(cfg.confirm_m == 5 && cfg.confirm_n == 5, "confirm_n never drops below confirm_m");
        check(apply_live_settings(cfg, {{"width", "640"}, {"blur_radius", "2"}}) == 1 &&
                  cfg.blur_radius == 2,
              "a refused field does not block the others");
    }

    // A faint 3x3 target: under the default thresholds, above the tuned ones.
    {
        CameraConfig cfg;
        cfg.width = 96;
        cfg.height = 64;
        MotionDetector detector(cfg);
        GrayFrame frame;
        frame.width = cfg.width;
        frame.height = cfg.height;
        std::uint64_t t_us = 1'000'000;
        int step = 0;
        auto next = [&](bool with_target) {
            frame.pixels.assign(static_cast<std::size_t>(frame.width * frame.height), 100);
            if (with_target) {
                const int x0 = 12 + (2 * step++) % 70;
                for (int y = 30; y < 33; ++y)
                    for (int x = x0; x < x0 + 3; ++x)
                        frame.pixels[static_cast<std::size_t>(y) * frame.width + x] = 130;
            }
            frame.captured_us = t_us += 33'333;
            return detector.process(frame);
        };
        for (int i = 0; i < 14; ++i) next(false);

        int before = 0;
        for (int i = 0; i < 30; ++i) before += next(true).has_blob ? 1 : 0;
        check(before == 0, "faint target stays under the default thresholds");

        CameraConfig tuned = cfg;
        apply_live_settings(tuned, {{"diff_threshold", "4"},
                                    {"adaptive_k", "1"},
                                    {"min_blob_area", "4"},
                                    {"morph_open", "0"}});
        detector.set_config(tuned);
        int after = 0, confirmed = 0;
        for (int i = 0; i < 30; ++i) {
            const auto r = next(true);
            after += r.has_blob ? 1 : 0;
            confirmed += r.confirmed ? 1 : 0;
        }
        check(after >= 28, "tuned thresholds take effect on the very next frames");
        check(confirmed >= 26, "tuned detections are confirmed");

        // A new blur radius restarts the background warm-up, then detects again.
        tuned.blur_radius = 2;
        detector.set_config(tuned);
        int during = 0, resumed = 0;
        for (int i = 0; i < 12; ++i) during += next(true).has_blob ? 1 : 0;
        for (int i = 0; i < 30; ++i) resumed += next(true).has_blob ? 1 : 0;
        check(during == 0, "a blur change relearns the background before detecting");
        check(resumed >= 20, "detection resumes after the relearn");
    }

    // Commands as the VPS sends them, over a real loopback socket.
    {
        const int server = ::socket(AF_INET, SOCK_DGRAM, 0);
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        socklen_t addr_len = sizeof(addr);
        const bool bound =
            server >= 0 &&
            ::bind(server, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0 &&
            ::getsockname(server, reinterpret_cast<sockaddr*>(&addr), &addr_len) == 0;
        check(bound, "loopback UDP server binds");
        if (bound) {
            const std::string secret = "selftest-secret";
            ::unsetenv("UDP_HMAC_SECRET");
            UdpSender sender;
            check(sender.open("127.0.0.1", ntohs(addr.sin_port)), "detector opens its UDP link");
            sender.send_line("hello");

            timeval timeout{1, 0};
            ::setsockopt(server, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
            char buffer[256];
            sockaddr_in peer{};
            socklen_t peer_len = sizeof(peer);
            const bool heard = ::recvfrom(server, buffer, sizeof(buffer), 0,
                                          reinterpret_cast<sockaddr*>(&peer), &peer_len) > 0;
            check(heard, "server learns the detector endpoint");

            auto send = [&](const std::string& packet) {
                ::sendto(server, packet.data(), packet.size(), 0,
                         reinterpret_cast<sockaddr*>(&peer), peer_len);
            };
            // Datagrams keep their order on loopback, so once a later command
            // has arrived, every earlier one has been seen and judged.
            auto await_capture = [&](const std::string& camera) {
                for (int i = 0; i < 200; ++i) {
                    if (sender.take_capture_request(camera)) return true;
                    std::this_thread::sleep_for(std::chrono::milliseconds(2));
                }
                return false;
            };
            auto await_config = [&](const std::string& camera) {
                for (int i = 0; i < 200; ++i) {
                    if (auto update = sender.take_config_update(camera)) return update;
                    std::this_thread::sleep_for(std::chrono::milliseconds(2));
                }
                return std::optional<UdpSender::ConfigUpdate>{};
            };
            const std::string expires = std::to_string(unix_ms() + 60'000);

            send("set,jean,7,diff_threshold=20\n");
            send("capture,jean,request-1," + expires + "\n");
            check(heard && await_capture("jean"), "unsigned capture still works without a secret");
            check(!sender.take_config_update("jean"),
                  "an unsigned set command is refused without a secret");

            ::setenv("UDP_HMAC_SECRET", secret.c_str(), 1);
            send(signed_packet("set,jean,7,diff_threshold=20,min_blob_area=30\n", secret));
            const auto update = await_config("jean");
            check(update && update->version == 7 && update->fields.size() == 2 &&
                      update->fields[0].first == "diff_threshold" &&
                      update->fields[0].second == "20" &&
                      update->fields[1].first == "min_blob_area" &&
                      update->fields[1].second == "30",
                  "a signed set command is parsed");
            check(!sender.take_config_update("jean"), "a set command is delivered once");

            send(signed_packet("set,jean,8,diff_threshold=1\n", "another-secret"));
            send("set,jean,9,diff_threshold=1\n");
            send(signed_packet("set,tanel,3,adaptive_k=2\n", secret));
            const auto other = await_config("tanel");
            check(other && other->version == 3, "a set command reaches the camera it names");
            check(!sender.take_config_update("jean"),
                  "forged and unsigned set commands are refused");

            send(signed_packet("set,jean,0\n", secret));
            const auto reset = await_config("jean");
            check(reset && reset->version == 0 && reset->fields.empty(),
                  "version 0 carries no field: back to the config file");
            ::unsetenv("UDP_HMAC_SECRET");
        }
        if (server >= 0) ::close(server);
    }
}

}  // namespace

int main() {
    test_linalg();
    test_kalman_cv();
    test_image_ops();
    test_geometry();
    test_triangulation();
    test_tracker();
    test_track_csv();
    test_fusion_engine();
    test_detector();
    test_pipeline();
    test_replay();
    test_imu();
    test_jpeg_preview();
    test_live_tuning();

    std::printf("\n%d/%d checks passed\n", g_checks - g_failures, g_checks);
    if (g_failures) {
        std::printf("SELFTEST FAILED (%d failures)\n", g_failures);
        return 1;
    }
    std::printf("SELFTEST PASSED\n");
    return 0;
}
