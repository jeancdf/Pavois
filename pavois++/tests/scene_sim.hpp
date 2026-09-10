#pragma once
//
// Synthetic multi-camera simulator shared by the self-tests and the accuracy
// scorecard. Renders a moving point target into N virtual pinhole cameras with
// configurable sensor noise, lighting drift, exposure steps, static bright
// distractors, camera dropout and calibration error, then scores the real
// detection + fusion pipeline against ground truth.
//

#include "pavois/config/app_config.hpp"
#include "pavois/detection/motion_detector.hpp"
#include "pavois/domain/frame.hpp"
#include "pavois/domain/observation.hpp"
#include "pavois/fusion/fusion_engine.hpp"
#include "pavois/math/pose.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <functional>
#include <optional>
#include <random>
#include <set>
#include <string>
#include <vector>

namespace pavois {
namespace sim {

constexpr double kDeg = 3.14159265358979323846 / 180.0;

// --------------------------------------------------------------------------
// Camera helpers
// --------------------------------------------------------------------------
inline CameraIntrinsics make_intrinsics(int w, int h, double fov_deg,
                                        double k1 = 0.0, double k2 = 0.0) {
    CameraIntrinsics in;
    in.image_width = w;
    in.image_height = h;
    in.fov_deg = fov_deg;
    in.fx = (w * 0.5) / std::tan(fov_deg * 0.5 * kDeg);
    in.fy = in.fx;
    in.cx = w * 0.5;
    in.cy = h * 0.5;
    in.k1 = k1;
    in.k2 = k2;
    return in;
}

inline CameraPose look_at(const Vec3& eye, const Vec3& target) {
    CameraPose p;
    p.x = eye.x;
    p.y = eye.y;
    p.z = eye.z;
    const double dx = target.x - eye.x;
    const double dy = target.y - eye.y;
    const double dz = target.z - eye.z;
    p.heading_deg = std::atan2(dx, dy) / kDeg;  // compass, CW from North
    p.elevation_deg = std::atan2(dz, std::sqrt(dx * dx + dy * dy)) / kDeg;
    return p;
}

// --------------------------------------------------------------------------
// Trajectories
// --------------------------------------------------------------------------
struct Trajectory {
    std::function<Vec3(int)> pos;
    std::function<bool(int)> present = [](int) { return true; };
    Vec3 center;  // representative point cameras are aimed at
};

inline Trajectory lissajous(Vec3 c, Vec3 amp, double speed = 0.05) {
    Trajectory t;
    t.center = c;
    t.pos = [c, amp, speed](int i) {
        const double s = i * speed;
        return Vec3{c.x + amp.x * std::sin(s), c.y + amp.y * std::cos(s * 0.7),
                    c.z + amp.z * std::sin(s * 1.3)};
    };
    return t;
}

inline Trajectory linear(Vec3 start, Vec3 vel_per_frame) {
    Trajectory t;
    t.center = Vec3{start.x + vel_per_frame.x * 60, start.y + vel_per_frame.y * 60,
                    start.z + vel_per_frame.z * 60};
    t.pos = [start, vel_per_frame](int i) {
        return Vec3{start.x + vel_per_frame.x * i, start.y + vel_per_frame.y * i,
                    start.z + vel_per_frame.z * i};
    };
    return t;
}

// A "hovering" target still drifts in wind; a pure static point is not
// observable by background subtraction and is intentionally out of scope.
inline Trajectory hover(Vec3 c, double drift = 0.7) {
    Trajectory t;
    t.center = c;
    t.pos = [c, drift](int i) {
        return Vec3{c.x + drift * std::sin(i * 0.05), c.y + drift * std::cos(i * 0.037),
                    c.z + 0.5 * drift * std::sin(i * 0.028)};
    };
    return t;
}

// Present only outside the window [gap_start, gap_end): target leaves view.
inline Trajectory with_gap(Trajectory base, int gap_start, int gap_end) {
    base.present = [gap_start, gap_end](int i) { return i < gap_start || i >= gap_end; };
    return base;
}

// --------------------------------------------------------------------------
// Scene configuration
// --------------------------------------------------------------------------
struct SceneConfig {
    int w = 640;
    int h = 360;
    double fov = 68.0;
    double k1 = 0.0;
    double k2 = 0.0;
    double noise_sigma = 3.0;
    double bg_level = 110.0;
    double target_amp = 150.0;
    double target_radius = 6.0;
    double drift_amp = 12.0;
    double drift_rate = 0.03;
    int exposure_step_frame = -1;
    double exposure_step = 0.0;
    bool distractors = true;
    double heading_bias_deg = 0.0;  // calibration error injected into declared pose
    double elevation_bias_deg = 0.0;
    std::vector<Vec3> eyes;
    int dropout_cam = -1;
    int dropout_frame = -1;
    unsigned seed = 1234;
    int fps = 30;

    static SceneConfig nominal() {
        SceneConfig c;
        c.eyes = {{-13, -3, 2.0}, {12, 2, 2.2}, {1, -15, 3.0}};
        return c;
    }
};

// --------------------------------------------------------------------------
// Simulator
// --------------------------------------------------------------------------
class Simulator {
public:
    Simulator(SceneConfig cfg, Trajectory traj) : cfg_(std::move(cfg)), traj_(std::move(traj)) {
        intr_ = make_intrinsics(cfg_.w, cfg_.h, cfg_.fov, cfg_.k1, cfg_.k2);
        for (const auto& eye : cfg_.eyes) {
            true_poses_.push_back(look_at(eye, traj_.center));
            CameraPose declared = true_poses_.back();
            declared.heading_deg += cfg_.heading_bias_deg;
            declared.elevation_deg += cfg_.elevation_bias_deg;
            declared_poses_.push_back(declared);
        }
    }

    int n_cams() const { return static_cast<int>(cfg_.eyes.size()); }
    const CameraIntrinsics& intrinsics() const { return intr_; }
    const CameraPose& declared_pose(int c) const { return declared_poses_[c]; }
    const SceneConfig& config() const { return cfg_; }
    Vec3 target(int frame) const { return traj_.pos(frame); }
    bool present(int frame) const { return traj_.present(frame); }

    std::optional<std::array<double, 2>> true_pixel(int cam, int frame) const {
        return project_world_to_pixel(intr_, true_poses_[cam], traj_.pos(frame));
    }

    bool in_view(int cam, int frame) const {
        if (!present(frame)) return false;
        auto p = true_pixel(cam, frame);
        return p && (*p)[0] > 4 && (*p)[0] < cfg_.w - 4 && (*p)[1] > 4 && (*p)[1] < cfg_.h - 4;
    }

    void render(int cam, int frame, GrayFrame& out) const {
        out.width = cfg_.w;
        out.height = cfg_.h;
        out.pixels.assign(static_cast<std::size_t>(cfg_.w) * cfg_.h, 0);
        out.frame_id = static_cast<std::uint64_t>(frame);

        const bool black = (cfg_.dropout_cam == cam && cfg_.dropout_frame >= 0 &&
                            frame >= cfg_.dropout_frame);

        std::mt19937 rng(cfg_.seed + static_cast<unsigned>(cam) * 100003u +
                         static_cast<unsigned>(frame) * 97u);
        std::normal_distribution<double> noise(0.0, black ? 1.0 : cfg_.noise_sigma);

        double expose = cfg_.drift_amp * std::sin(frame * cfg_.drift_rate);
        if (cfg_.exposure_step_frame >= 0 && frame >= cfg_.exposure_step_frame) {
            expose += cfg_.exposure_step;
        }
        const double base = black ? 4.0 : cfg_.bg_level;

        for (int y = 0; y < cfg_.h; ++y) {
            for (int x = 0; x < cfg_.w; ++x) {
                double v = base + expose + 0.02 * x + 0.01 * y + noise(rng);
                if (!black && cfg_.distractors) {
                    if (x > 90 && x < 130 && y > 60 && y < 110) v += 80.0;
                    if (x > cfg_.w - 120 && x < cfg_.w - 70 && y > 40 && y < 90) v += 70.0;
                }
                out.pixels[static_cast<std::size_t>(y) * cfg_.w + x] =
                    static_cast<std::uint8_t>(std::clamp(v, 0.0, 255.0));
            }
        }

        if (black || !present(frame)) return;
        auto px = true_pixel(cam, frame);
        if (!px) return;
        const double cx = (*px)[0], cy = (*px)[1];
        const double rad = cfg_.target_radius;
        const int reach = static_cast<int>(rad * 2 + 2);
        for (int dy = -reach; dy <= reach; ++dy) {
            for (int dx = -reach; dx <= reach; ++dx) {
                const int x = static_cast<int>(cx) + dx;
                const int y = static_cast<int>(cy) + dy;
                if (x < 0 || y < 0 || x >= cfg_.w || y >= cfg_.h) continue;
                const double g =
                    cfg_.target_amp * std::exp(-(dx * dx + dy * dy) / (2 * rad * rad / 3.0));
                auto& pix = out.pixels[static_cast<std::size_t>(y) * cfg_.w + x];
                pix = static_cast<std::uint8_t>(std::clamp(pix + g, 0.0, 255.0));
            }
        }
    }

private:
    SceneConfig cfg_;
    Trajectory traj_;
    CameraIntrinsics intr_;
    std::vector<CameraPose> true_poses_;
    std::vector<CameraPose> declared_poses_;
};

// --------------------------------------------------------------------------
// Metrics
// --------------------------------------------------------------------------
struct DetectionMetrics {
    int opportunities = 0;   // frames where target was in view for a camera
    int true_positives = 0;  // confirmed detection near ground truth
    int false_positives = 0; // confirmed detection far from truth / when absent
    int false_negatives = 0; // in view but no confirmed detection
    double px_err_sum = 0.0;
    int px_err_n = 0;
    int px_within_tol = 0;

    double recall() const {
        const int d = true_positives + false_negatives;
        return d ? static_cast<double>(true_positives) / d : 1.0;
    }
    double precision() const {
        const int d = true_positives + false_positives;
        return d ? static_cast<double>(true_positives) / d : 1.0;
    }
    double f1() const {
        const double p = precision(), r = recall();
        return (p + r > 0) ? 2 * p * r / (p + r) : 0.0;
    }
    double mean_px_err() const { return px_err_n ? px_err_sum / px_err_n : 0.0; }
    double px_accuracy() const {
        return px_err_n ? static_cast<double>(px_within_tol) / px_err_n : 0.0;
    }
};

struct FusionMetrics {
    int opportunities = 0;  // frames the target was visible to >=2 cameras
    int covered = 0;        // distinct frames with a fused update
    double err_sum = 0.0;
    int err_n = 0;
    int within_1m = 0, within_2m = 0, within_5m = 0;
    double rel_err_sum = 0.0;
    std::set<std::uint32_t> track_ids;
    double worst_err = 0.0;

    double availability() const {
        return opportunities ? std::min(1.0, static_cast<double>(covered) / opportunities) : 0.0;
    }
    double mean_err() const { return err_n ? err_sum / err_n : 0.0; }
    double acc_1m() const { return err_n ? static_cast<double>(within_1m) / err_n : 0.0; }
    double acc_2m() const { return err_n ? static_cast<double>(within_2m) / err_n : 0.0; }
    double acc_5m() const { return err_n ? static_cast<double>(within_5m) / err_n : 0.0; }
    double rel_accuracy() const {
        return err_n ? std::clamp(1.0 - rel_err_sum / err_n, 0.0, 1.0) : 0.0;
    }
    int track_count() const { return static_cast<int>(track_ids.size()); }
    double track_purity() const {
        return track_ids.empty() ? 0.0 : 1.0 / static_cast<double>(track_ids.size());
    }
};

struct ScenarioReport {
    std::string name;
    DetectionMetrics det;
    FusionMetrics fus;

    // Blended 0..1 accuracy score for this scenario.
    // Localisation leans on range-relative accuracy (fair across near/far
    // targets and calibration error) rather than a fixed metre threshold.
    double score() const {
        const double detection = 0.5 * det.f1() + 0.5 * det.px_accuracy();
        const double localisation = 0.45 * fus.rel_accuracy() + 0.25 * fus.acc_2m() +
                                    0.15 * fus.acc_5m() + 0.15 * fus.availability();
        const double continuity = fus.track_purity();
        return 0.38 * detection + 0.47 * localisation + 0.15 * continuity;
    }
};

// --------------------------------------------------------------------------
// Full-pipeline scenario run
// --------------------------------------------------------------------------
inline FusionSettings default_fusion_settings() {
    FusionSettings fs;
    fs.fusion_window_ms = 120;
    fs.fusion_emit_interval_ms = 40;
    fs.triangulation.min_parallax_deg = 1.5;
    fs.triangulation.max_residual_m = 4.0;
    fs.triangulation.max_range_m = 120.0;
    fs.tracker.confirm_updates = 3;
    fs.tracker.match_distance_m = 8.0;
    fs.tracker.max_coast_ms = 900;
    fs.tracker.max_speed_mps = 60.0;
    fs.tracker.process_noise = 200.0;
    fs.tracker.meas_noise = 2.5;
    return fs;
}

inline ScenarioReport run_scenario(const std::string& name, const SceneConfig& cfg,
                                   const Trajectory& traj, int frames,
                                   double px_tol = 6.0,
                                   const FusionSettings& fs = default_fusion_settings()) {
    Simulator sim(cfg, traj);
    const int nc = sim.n_cams();

    std::vector<CameraConfig> cam_cfg(nc);
    std::vector<MotionDetector> dets;
    for (int c = 0; c < nc; ++c) {
        cam_cfg[c].width = cfg.w;
        cam_cfg[c].height = cfg.h;
        dets.emplace_back(cam_cfg[c]);
    }
    FusionEngine fusion(fs);

    ScenarioReport rep;
    rep.name = name;
    std::set<int> fused_frames;
    const std::uint64_t t0 = 10'000'000ULL;
    const std::uint64_t dt_us = static_cast<std::uint64_t>(1e6 / cfg.fps);

    GrayFrame f;
    for (int i = 0; i < frames; ++i) {
        const Vec3 tgt = sim.target(i);
        int in_view_count = 0;
        for (int c = 0; c < nc; ++c) if (sim.in_view(c, i)) ++in_view_count;
        const bool fusion_opportunity = in_view_count >= 2 && i > 20;
        if (fusion_opportunity) ++rep.fus.opportunities;

        for (int c = 0; c < nc; ++c) {
            sim.render(c, i, f);
            f.frame_id = static_cast<std::uint64_t>(i);
            f.captured_us = t0 + static_cast<std::uint64_t>(i) * dt_us +
                            static_cast<std::uint64_t>(c) * (dt_us / 8);
            const DetectionResult r = dets[c].process(f);

            const bool visible = sim.in_view(c, i);
            auto tp = sim.true_pixel(c, i);
            if (i > 15) {
                if (visible) ++rep.det.opportunities;
                if (r.confirmed && tp) {
                    const double e = std::hypot(r.cx - (*tp)[0], r.cy - (*tp)[1]);
                    if (visible && e <= px_tol * 3.0) {
                        ++rep.det.true_positives;
                        rep.det.px_err_sum += e;
                        ++rep.det.px_err_n;
                        if (e <= px_tol) ++rep.det.px_within_tol;
                    } else {
                        ++rep.det.false_positives;
                    }
                } else if (r.confirmed && !tp) {
                    ++rep.det.false_positives;
                } else if (visible) {
                    ++rep.det.false_negatives;
                }
            }

            if (!r.confirmed) continue;
            Observation o;
            o.camera_id = "cam" + std::to_string(c);
            o.frame_id = static_cast<std::uint64_t>(i);
            o.captured_us = f.captured_us;
            o.timestamp_us = f.captured_us;
            o.image_width = cfg.w;
            o.image_height = cfg.h;
            o.intrinsics = sim.intrinsics();
            o.intrinsics.image_width = cfg.w;
            o.intrinsics.image_height = cfg.h;
            o.pose = sim.declared_pose(c);
            o.centroid_x = r.cx;
            o.centroid_y = r.cy;
            o.blob_area = r.area;
            o.quality = r.quality;

            for (const auto& up : fusion.submit(o)) {
                if (i <= 20) continue;
                rep.fus.track_ids.insert(up.object_id);
                fused_frames.insert(i);
                const Vec3 fp{up.x, up.y, up.z};
                const double e = v_norm(v_sub(fp, tgt));
                double range = 0.0;
                for (const auto& eye : cfg.eyes) range += v_norm(v_sub(tgt, eye));
                range /= static_cast<double>(cfg.eyes.size());
                rep.fus.err_sum += e;
                ++rep.fus.err_n;
                rep.fus.rel_err_sum += e / std::max(1.0, range);
                rep.fus.worst_err = std::max(rep.fus.worst_err, e);
                if (e <= 1.0) ++rep.fus.within_1m;
                if (e <= 2.0) ++rep.fus.within_2m;
                if (e <= 5.0) ++rep.fus.within_5m;
            }
        }
    }
    rep.fus.covered = static_cast<int>(fused_frames.size());
    return rep;
}

}  // namespace sim
}  // namespace pavois
