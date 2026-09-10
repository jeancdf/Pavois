// Pavois++ accuracy scorecard.
//
// Runs the real detection + fusion pipeline over a battery of synthetic
// multi-camera scenarios (no cameras required) and prints an accuracy report
// with per-scenario and overall percentages. Exits non-zero if the overall
// score or any guard drops below threshold, so it doubles as a CI regression
// gate. Scenarios run in parallel across hardware threads.

#include "scene_sim.hpp"

#include <atomic>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>

using namespace pavois;
using namespace pavois::sim;

namespace {

struct Guard {
    double overall_min = 0.85;
    double scenario_min = 0.60;
    double false_alarm_max = 0.02;
};

struct Job {
    std::string name;
    SceneConfig cfg;
    Trajectory traj;
    int frames;
    double px_tol;
};

double false_alarm_rate() {
    SceneConfig cfg = SceneConfig::nominal();
    Trajectory t = lissajous({4, 26, 12}, {6, 3, 2.5});
    t.present = [](int) { return false; };
    Simulator sim(cfg, t);
    std::vector<CameraConfig> cc(sim.n_cams());
    std::vector<MotionDetector> dets;
    for (int c = 0; c < sim.n_cams(); ++c) {
        cc[c].width = cfg.w;
        cc[c].height = cfg.h;
        dets.emplace_back(cc[c]);
    }
    GrayFrame f;
    int checked = 0, confirmed = 0;
    for (int i = 0; i < 150; ++i)
        for (int c = 0; c < sim.n_cams(); ++c) {
            sim.render(c, i, f);
            f.captured_us = 10'000'000ULL + static_cast<std::uint64_t>(i) * 33333ULL;
            auto r = dets[c].process(f);
            if (i > 15) {
                ++checked;
                if (r.confirmed) ++confirmed;
            }
        }
    return checked ? static_cast<double>(confirmed) / checked : 0.0;
}

}  // namespace

int main() {
    const Guard guard;
    const Vec3 c{4, 26, 12};
    const Vec3 amp{6, 3, 2.5};
    const int F = 200;

    std::vector<Job> jobs;
    auto add = [&](const std::string& n, SceneConfig s, Trajectory t, int frames = 0,
                   double tol = 6.0) {
        jobs.push_back({n, std::move(s), std::move(t), frames ? frames : F, tol});
    };

    add("nominal", SceneConfig::nominal(), lissajous(c, amp));
    { SceneConfig s = SceneConfig::nominal(); s.noise_sigma = 8.0;
      add("high sensor noise (sigma 8)", s, lissajous(c, amp)); }
    { SceneConfig s = SceneConfig::nominal(); s.noise_sigma = 12.0;
      add("severe sensor noise (sigma 12)", s, lissajous(c, amp)); }
    { SceneConfig s = SceneConfig::nominal(); s.target_amp = 55.0;
      add("low-contrast target", s, lissajous(c, amp), 0, 7.0); }
    { SceneConfig s = SceneConfig::nominal(); s.drift_amp = 32.0;
      add("strong lighting drift", s, lissajous(c, amp)); }
    { SceneConfig s = SceneConfig::nominal(); s.exposure_step_frame = 90; s.exposure_step = 45.0;
      add("sudden exposure step (+45)", s, lissajous(c, amp)); }
    { SceneConfig s = SceneConfig::nominal(); s.dropout_cam = 2; s.dropout_frame = 110;
      add("camera 2 dropout mid-run", s, lissajous(c, amp)); }
    { SceneConfig s = SceneConfig::nominal(); s.eyes = {{-13, -3, 2.0}, {12, 2, 2.2}};
      add("two cameras only", s, lissajous(c, amp)); }
    add("fast linear target", SceneConfig::nominal(), linear({-9, 24, 9}, {0.14, 0.04, 0.05}));
    add("near-hovering target", SceneConfig::nominal(), hover({2, 27, 12}));
    { SceneConfig s = SceneConfig::nominal(); s.heading_bias_deg = 3.0;
      add("heading miscalibration +3 deg", s, lissajous(c, amp)); }
    { SceneConfig s = SceneConfig::nominal(); s.heading_bias_deg = -2.0; s.elevation_bias_deg = 1.5;
      add("heading -2 / elevation +1.5 deg", s, lissajous(c, amp)); }
    { SceneConfig s = SceneConfig::nominal(); s.k1 = -0.16; s.k2 = 0.05;
      add("uncorrected lens distortion", s, lissajous(c, amp), 0, 8.0); }
    add("target leaves frame then returns", SceneConfig::nominal(),
        with_gap(lissajous(c, amp), 90, 120));
    { SceneConfig s = SceneConfig::nominal();
      s.eyes = {{-22, -8, 2.0}, {21, 4, 3.0}, {-2, -26, 4.0}};
      add("far target / wide baseline", s, lissajous({0, 55, 20}, {10, 5, 4})); }
    { SceneConfig s = SceneConfig::nominal();
      s.eyes = {{-4, -2, 2.0}, {4, -1, 2.2}, {0, -6, 3.0}};
      add("tight geometry (small parallax)", s, lissajous(c, amp)); }

    // ---- run scenarios in parallel -------------------------------------
    std::vector<ScenarioReport> reports(jobs.size());
    std::atomic<std::size_t> next{0};
    double far = 0.0;
    auto worker = [&] {
        for (;;) {
            const std::size_t i = next.fetch_add(1);
            if (i >= jobs.size()) break;
            reports[i] = run_scenario(jobs[i].name, jobs[i].cfg, jobs[i].traj, jobs[i].frames,
                                      jobs[i].px_tol);
        }
    };
    const unsigned nthreads = std::max(1u, std::min<unsigned>(jobs.size(),
                                                             std::thread::hardware_concurrency()));
    std::vector<std::thread> pool;
    std::thread fa([&] { far = false_alarm_rate(); });
    for (unsigned k = 0; k < nthreads; ++k) pool.emplace_back(worker);
    for (auto& t : pool) t.join();
    fa.join();

    // ---- report ------------------------------------------------------
    std::printf(
        "\n=================================  PAVOIS++ ACCURACY SCORECARD  "
        "=================================\n\n");
    std::printf("%-34s  %6s %6s %7s  %6s %6s %6s %6s  %5s\n", "scenario", "recall", "prec",
                "px<tol", "avail", "<2m", "<5m", "relacc", "score");
    std::printf("%s\n", std::string(104, '-').c_str());

    double sum_score = 0, sum_f1 = 0, sum_pxacc = 0, sum_avail = 0, sum_acc2 = 0, sum_relacc = 0,
           sum_purity = 0, mean_err_sum = 0;
    int mean_err_scen = 0;
    double worst = 1e9;
    std::string worst_name;

    for (const auto& r : reports) {
        std::printf("%-34s  %5.1f%% %5.1f%% %6.1f%%  %5.1f%% %5.1f%% %5.1f%% %5.1f%%  %4.0f%%\n",
                    r.name.c_str(), 100 * r.det.recall(), 100 * r.det.precision(),
                    100 * r.det.px_accuracy(), 100 * r.fus.availability(), 100 * r.fus.acc_2m(),
                    100 * r.fus.acc_5m(), 100 * r.fus.rel_accuracy(), 100 * r.score());
        sum_score += r.score();
        sum_f1 += r.det.f1();
        sum_pxacc += r.det.px_accuracy();
        sum_avail += r.fus.availability();
        sum_acc2 += r.fus.acc_2m();
        sum_relacc += r.fus.rel_accuracy();
        sum_purity += r.fus.track_purity();
        if (r.fus.err_n) {
            mean_err_sum += r.fus.mean_err();
            ++mean_err_scen;
        }
        if (r.score() < worst) {
            worst = r.score();
            worst_name = r.name;
        }
    }

    const int n = static_cast<int>(reports.size());
    std::printf("%s\n\n", std::string(104, '-').c_str());
    std::printf("Aggregate over %d scenarios:\n", n);
    std::printf("  detection F1 ......................  %5.1f %%\n", 100 * sum_f1 / n);
    std::printf("  pixel accuracy (centroid in tol) .  %5.1f %%\n", 100 * sum_pxacc / n);
    std::printf("  fusion availability ..............  %5.1f %%\n", 100 * sum_avail / n);
    std::printf("  fusion accuracy (<2 m absolute) ..  %5.1f %%\n", 100 * sum_acc2 / n);
    std::printf("  fusion relative accuracy .........  %5.1f %%   (1 - error/range)\n",
                100 * sum_relacc / n);
    std::printf("  track continuity (1 id / target) .  %5.1f %%\n", 100 * sum_purity / n);
    std::printf("  mean 3D error ...................  %5.2f m\n",
                mean_err_scen ? mean_err_sum / mean_err_scen : -1.0);
    std::printf("  false-alarm rate (empty scene) ...  %5.2f %%\n", 100 * far);

    const double overall = sum_score / n;
    std::printf("\n  ============================================================\n");
    std::printf("   OVERALL PIPELINE ACCURACY:  %.1f %%\n", 100 * overall);
    std::printf("  ============================================================\n");
    std::printf("   weakest scenario: \"%s\" at %.0f %%\n\n", worst_name.c_str(), 100 * worst);

    bool ok = true;
    if (overall < guard.overall_min) {
        std::printf("GATE FAIL: overall %.1f%% < %.1f%%\n", 100 * overall, 100 * guard.overall_min);
        ok = false;
    }
    if (worst < guard.scenario_min) {
        std::printf("GATE FAIL: \"%s\" %.1f%% < %.1f%%\n", worst_name.c_str(), 100 * worst,
                    100 * guard.scenario_min);
        ok = false;
    }
    if (far > guard.false_alarm_max) {
        std::printf("GATE FAIL: false-alarm rate %.2f%% > %.2f%%\n", 100 * far,
                    100 * guard.false_alarm_max);
        ok = false;
    }
    std::printf("%s\n", ok ? "ACCURACY GATE PASSED" : "ACCURACY GATE FAILED");
    return ok ? 0 : 1;
}
