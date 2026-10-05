#include "pavois/detection/motion_detector.hpp"

#include "pavois/detection/image_ops.hpp"
#include "pavois/util/parallel_executor.hpp"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <numeric>

namespace pavois {
namespace {
constexpr double kDefaultDt = 1.0 / 30.0;
constexpr int kWarmupFrames = 12;
// A longer gap is a pause, not motion: dt is capped so the Kalman filter does
// not extrapolate across it.
constexpr double kMaxFrameGapS = 1.0;

// Per-pixel noise, in grey levels: a mean of |frame - background| that sets
// how far above diff_threshold the pixel's own threshold sits.
constexpr float kInitialNoise = 4.0f;      // before the warm-up has measured it
constexpr float kNoiseFloor = 1.5f;        // a calm pixel keeps some margin
constexpr float kNoiseCeiling = 18.0f;     // a busy pixel never goes blind
constexpr float kWarmupNoiseRate = 0.1f;   // learning rate during the warm-up
constexpr float kNoiseLearnRate = 0.03f;   // learning rate afterwards
// Only residuals below this many diff_threshold feed the noise estimate, so a
// target never raises the threshold that has to find it.
constexpr float kNoiseResidualFactor = 3.0f;

// Ranking of the candidates of one frame. Empirical weights: they only order
// the candidates; the shape filters decide which ones are kept.
constexpr double kAreaForFullScore = 800.0;     // px; larger counts as 1
constexpr double kEnergyForFullScore = 60.0;    // mean grey-level difference
constexpr double kContinuityScalePx = 40.0;     // exp(-distance / scale)
constexpr double kScoreAreaWeight = 0.35;
constexpr double kScoreFillWeight = 0.20;
constexpr double kScoreEnergyWeight = 0.20;
constexpr double kScoreContinuityWeight = 0.25;

// Quality in [0, 1] sent with every blob; the VPS weights the triangulation
// by it.
constexpr double kQualityBase = 0.15;
constexpr double kQualitySupportWeight = 0.35;  // hits in the confirm window
constexpr double kQualitySnrWeight = 0.25;
constexpr double kQualityFillWeight = 0.15;
constexpr double kQualityFilterWeight = 0.10;   // how sure the Kalman filter is
constexpr double kSnrForFullScore = 6.0;
constexpr double kFillForFullScore = 0.6;
constexpr double kTightnessScalePx = 12.0;      // filter uncertainty that scores 0
constexpr double kUntrackedFilterScore = 0.5;   // blobs the filter does not follow
// A blob cut by the frame edge has a biased centroid: its bearing is worth less.
constexpr double kClippedQualityFactor = 0.6;

// Reported centroid: mostly the measurement, which blur, morphology and
// weighting already make precise; the filter adds smoothing.
constexpr double kMeasurementWeight = 0.85;
constexpr double kFilterWeight = 0.15;

// Background learning rate right after a global illumination jump.
constexpr float kCatchUpLearnRate = 0.25f;
// Margin around a target, in pixels, that the background must not learn.
constexpr int kProtectionPadPx = 2;

// At least one hit to confirm, in a window at least that long: "2 of 1"
// could never be reached.
void sanitize_confirmation(CameraConfig& cfg) {
    cfg.confirm_m = std::max(1, cfg.confirm_m);
    cfg.confirm_n = std::max(cfg.confirm_m, cfg.confirm_n);
}
}

MotionDetector::MotionDetector(const CameraConfig& cfg,
                               ParallelExecutor* executor)
    : cfg_(cfg), executor_(executor) {
    sanitize_confirmation(cfg_);
}

void MotionDetector::set_config(const CameraConfig& cfg) {
    // The background was learned from frames blurred at the old radius, so a
    // new radius mismatches it along every edge. Relearn it rather than emit
    // that mismatch as blobs.
    const bool blur_changed = cfg.blur_radius != cfg_.blur_radius;
    cfg_ = cfg;
    sanitize_confirmation(cfg_);
    if (blur_changed && w_ > 0) warmup_left_ = kWarmupFrames;
}

std::vector<MotionDetector::Blob> MotionDetector::connected_components(
    const std::vector<std::uint8_t>& mask, const std::vector<float>& diff) {
    std::vector<Blob> blobs;
    cc_visited_.assign(mask.size(), 0);
    auto& stack = cc_stack_;

    for (int y = 0; y < h_; ++y) {
        for (int x = 0; x < w_; ++x) {
            const std::size_t s = static_cast<std::size_t>(y) * w_ + x;
            if (!mask[s] || cc_visited_[s]) continue;

            Blob b;
            b.x0 = b.x1 = x;
            b.y0 = b.y1 = y;
            stack.clear();
            stack.push_back(static_cast<int>(s));
            cc_visited_[s] = 1;
            double esum = 0.0;
            while (!stack.empty()) {
                const int ci = stack.back();
                stack.pop_back();
                const int cx = ci % w_;
                const int cy = ci / w_;
                const double wgt = std::max(1.0, static_cast<double>(diff[ci]));
                ++b.area;
                b.wsum += wgt;
                b.wx += wgt * cx;
                b.wy += wgt * cy;
                esum += diff[ci];
                b.x0 = std::min(b.x0, cx);
                b.x1 = std::max(b.x1, cx);
                b.y0 = std::min(b.y0, cy);
                b.y1 = std::max(b.y1, cy);
                const int x0 = std::max(0, cx - 1), x1 = std::min(w_ - 1, cx + 1);
                const int y0 = std::max(0, cy - 1), y1 = std::min(h_ - 1, cy + 1);
                for (int ny = y0; ny <= y1; ++ny) {
                    for (int nx = x0; nx <= x1; ++nx) {
                        const std::size_t ni = static_cast<std::size_t>(ny) * w_ + nx;
                        if (!mask[ni] || cc_visited_[ni]) continue;
                        cc_visited_[ni] = 1;
                        stack.push_back(static_cast<int>(ni));
                    }
                }
            }
            b.energy = esum / static_cast<double>(std::max<std::size_t>(1, b.area));
            blobs.push_back(b);
        }
    }
    return blobs;
}

DetectionResult MotionDetector::process(const GrayFrame& frame) {
    DetectionResult out;
    if (frame.width <= 0 || frame.height <= 0 || frame.empty()) return out;

    if (w_ != frame.width || h_ != frame.height) {
        w_ = frame.width;
        h_ = frame.height;
        bg_.resize(frame.size());
        noise_.assign(frame.size(), kInitialNoise);
        fg_hold_.assign(frame.size(), 0);
        fg_streak_.assign(frame.size(), 0);
        for_each_range(executor_, 0, frame.size(),
                       [&](std::size_t first, std::size_t last) {
            for (std::size_t i = first; i < last; ++i) {
                bg_[i] = frame.pixels[i];
            }
        });
        centroid_kf_ = KalmanCV();
        warmup_left_ = kWarmupFrames;
        confirm_hits_.clear();
        have_last_ = false;
        frames_seen_ = 0;
    }

    double dt = kDefaultDt;
    if (last_us_ != 0 && frame.captured_us > last_us_) {
        dt = std::min(kMaxFrameGapS, (frame.captured_us - last_us_) / 1e6);
    }
    last_us_ = frame.captured_us;
    ++frames_seen_;

    box_blur(frame.pixels, blur_, w_, h_, std::max(0, cfg_.blur_radius),
             executor_);

    // Warm-up: build the background from a short temporal mean before detecting.
    // Seeding from a single frame would bake any object present at t=0 into the
    // model as a permanent negative ghost; averaging washes a moving target out.
    if (warmup_left_ > 0) {
        const float n = static_cast<float>(kWarmupFrames - warmup_left_ + 1);
        for_each_range(executor_, 0, frame.size(),
                       [&](std::size_t first, std::size_t last) {
            for (std::size_t i = first; i < last; ++i) {
                bg_[i] += (static_cast<float>(blur_[i]) - bg_[i]) / n;
                const float d =
                    std::fabs(static_cast<float>(blur_[i]) - bg_[i]);
                noise_[i] += kWarmupNoiseRate * (d - noise_[i]);
                noise_[i] = std::clamp(noise_[i], kNoiseFloor, kNoiseCeiling);
            }
        });
        --warmup_left_;
        return out;
    }

    // Global brightness bias (exposure / white-balance drift): the mean signed
    // delta over the whole frame is dominated by the illumination shift, not by
    // the tiny target, so subtracting it makes the detector shift-invariant.
    // Deliberately offset-only. Modelling auto-exposure as gain+offset needs
    // enough variance in the background to identify the gain; on a low-texture
    // scene it is ill-conditioned and corrupts every pixel.
    double bias = 0.0;
    for (std::size_t i = 0; i < frame.size(); ++i) {
        bias += static_cast<double>(blur_[i]) - bg_[i];
    }
    bias /= static_cast<double>(frame.size());

    diff_.resize(frame.size());
    mask_.resize(frame.size());
    const double base = static_cast<double>(cfg_.diff_threshold);
    std::atomic<std::size_t> hot{0};
    for_each_range(executor_, 0, frame.size(),
                   [&](std::size_t first, std::size_t last) {
        std::size_t local_hot = 0;
        for (std::size_t i = first; i < last; ++i) {
            const float d = std::fabs(
                (static_cast<float>(blur_[i]) - bg_[i]) -
                static_cast<float>(bias));
            diff_[i] = d;
            const double threshold = base + cfg_.adaptive_k * noise_[i];
            if (d > threshold) {
                mask_[i] = 255;
                ++local_hot;
            } else {
                mask_[i] = 0;
            }
        }
        hot.fetch_add(local_hot, std::memory_order_relaxed);
    });

    // Global illumination / exposure jump: almost everything moved -> bail,
    // and let the background catch up fast.
    const double hot_ratio = static_cast<double>(hot.load(std::memory_order_relaxed)) /
                             static_cast<double>(frame.size());
    const bool illumination_event = hot_ratio > cfg_.illumination_hot_ratio;

    std::vector<Blob> blobs;
    if (!illumination_event) {
        morph_open(mask_, w_, h_, std::max(0, cfg_.morph_open), executor_);
        morph_close(mask_, w_, h_, std::max(0, cfg_.morph_close), executor_);
        blobs = connected_components(mask_, diff_);
    }

    const double frame_area = static_cast<double>(w_) * static_cast<double>(h_);
    const int b = std::max(0, cfg_.border_ignore_px);

    struct Candidate {
        const Blob* blob = nullptr;
        double cx = 0.0;
        double cy = 0.0;
        double fill = 0.0;
        double snr = 0.0;
        double score = 0.0;
        bool clipped = false;   // bounding box touches the frame edge
    };
    std::vector<Candidate> candidates;
    candidates.reserve(blobs.size());
    for (const auto& bl : blobs) {
        const int bw = bl.x1 - bl.x0 + 1;
        const int bh = bl.y1 - bl.y0 + 1;
        if (bl.area < cfg_.min_blob_area) continue;
        if (static_cast<double>(bl.area) > cfg_.max_blob_area_ratio * frame_area) continue;
        const double fill = static_cast<double>(bl.area) / static_cast<double>(std::max(1, bw * bh));
        if (fill < cfg_.min_blob_fill_ratio) continue;
        const double aspect = static_cast<double>(std::max(bw, bh)) / static_cast<double>(std::max(1, std::min(bw, bh)));
        if (aspect > cfg_.max_blob_aspect) continue;

        const double cx = bl.wx / std::max(1e-6, bl.wsum);
        const double cy = bl.wy / std::max(1e-6, bl.wsum);
        // Reject on the CENTROID, not the bounding box: a target crossing the
        // frame edge keeps a centroid well inside and stays detectable. Even in
        // the margin, keep a blob that is far too big to be edge speckle --
        // that is a real object on its way in or out of frame.
        const bool in_margin =
            cx < b || cy < b || cx >= w_ - b || cy >= h_ - b;
        const double edge_keep_area =
            cfg_.border_keep_area_mult * static_cast<double>(cfg_.min_blob_area);
        if (in_margin && static_cast<double>(bl.area) < edge_keep_area) continue;
        // A clipped bounding box means the measured centroid is biased toward
        // frame centre, so flag it and let quality carry the uncertainty.
        const bool clipped =
            bl.x0 <= 0 || bl.y0 <= 0 || bl.x1 >= w_ - 1 || bl.y1 >= h_ - 1;
        double continuity = 0.0;
        if (have_last_) {
            const double dist = std::hypot(cx - last_cx_, cy - last_cy_);
            continuity = std::exp(-dist / kContinuityScalePx);
        }
        const double area_score = std::min(1.0, static_cast<double>(bl.area) / kAreaForFullScore);
        const double energy_score = std::min(1.0, bl.energy / kEnergyForFullScore);
        const double score = kScoreAreaWeight * area_score + kScoreFillWeight * fill +
                             kScoreEnergyWeight * energy_score +
                             kScoreContinuityWeight * continuity;
        const std::size_t ci =
            static_cast<std::size_t>(std::clamp<int>(static_cast<int>(cy), 0, h_ - 1)) * w_ +
            std::clamp<int>(static_cast<int>(cx), 0, w_ - 1);
        const double noise_here = std::max(1.0, static_cast<double>(noise_[ci]));
        candidates.push_back({&bl, cx, cy, fill, bl.energy / noise_here, score, clipped});
    }
    std::stable_sort(candidates.begin(), candidates.end(),
                     [](const Candidate& a, const Candidate& b) {
                         return a.score > b.score;
                     });
    const Candidate* best = candidates.empty() ? nullptr : &candidates.front();

    // Kalman predict step happens every frame.
    if (centroid_kf_.initialized()) centroid_kf_.predict(dt);

    fg_mask_.resize(frame.size());
    for_each_range(executor_, 0, frame.size(),
                   [&](std::size_t first, std::size_t last) {
        std::fill(fg_mask_.begin() + static_cast<std::ptrdiff_t>(first),
                  fg_mask_.begin() + static_cast<std::ptrdiff_t>(last), 0);
    });
    if (best != nullptr) {
        const double mx = best->cx;
        const double my = best->cy;
        out.has_blob = true;
        out.raw_cx = mx;
        out.raw_cy = my;
        out.area = best->blob->area;
        out.fill_ratio = best->fill;
        out.snr = best->snr;

        if (!centroid_kf_.initialized()) {
            centroid_kf_.init(2, {mx, my}, cfg_.centroid_process_noise, cfg_.centroid_meas_noise);
        } else {
            centroid_kf_.update({mx, my});
        }
        const auto p = centroid_kf_.position();
        // The weighted measurement is trustworthy after blur+morph+weighting;
        // blend mostly toward it and let the filter mainly supply smoothing and
        // a velocity estimate for coasting.
        out.cx = kMeasurementWeight * mx + kFilterWeight * p[0];
        out.cy = kMeasurementWeight * my + kFilterWeight * p[1];
        last_cx_ = mx;
        last_cy_ = my;
        have_last_ = true;
        confirm_hits_.push_back(1);

    } else {
        confirm_hits_.push_back(0);
        if (centroid_kf_.initialized()) {
            const auto p = centroid_kf_.position();
            out.cx = p[0];
            out.cy = p[1];
        }
    }

    // Preserve every valid component in the slow-update foreground mask. If
    // only the best one is protected, simultaneous targets are absorbed into
    // the background before they can be emitted on following frames.
    for (const auto& candidate : candidates) {
        const Blob& blob = *candidate.blob;
        for (int y = std::max(0, blob.y0 - kProtectionPadPx);
             y <= std::min(h_ - 1, blob.y1 + kProtectionPadPx); ++y) {
            for (int x = std::max(0, blob.x0 - kProtectionPadPx);
                 x <= std::min(w_ - 1, blob.x1 + kProtectionPadPx); ++x) {
                const std::size_t bi = static_cast<std::size_t>(y) * w_ + x;
                if (mask_[bi]) {
                    fg_mask_[bi] = 1;
                    fg_hold_[bi] =
                        static_cast<std::uint16_t>(std::max(0, cfg_.bg_hold_frames));
                }
            }
        }
    }
    if (!candidates.empty()) dilate(fg_mask_, w_, h_, kProtectionPadPx, executor_);

    while (static_cast<int>(confirm_hits_.size()) > cfg_.confirm_n) confirm_hits_.pop_front();
    const int hits = std::accumulate(confirm_hits_.begin(), confirm_hits_.end(), 0);
    out.confirmed = out.has_blob && hits >= cfg_.confirm_m && frames_seen_ > 3;

    // Quality: temporal support, fill, SNR, filter tightness.
    if (out.has_blob) {
        const double support = static_cast<double>(hits) / static_cast<double>(cfg_.confirm_n);
        const double tight = std::clamp(
            1.0 - centroid_kf_.position_uncertainty() / kTightnessScalePx, 0.0, 1.0);
        out.blobs.reserve(candidates.size());
        for (std::size_t index = 0; index < candidates.size(); ++index) {
            const Candidate& candidate = candidates[index];
            const double snr_score = std::min(1.0, candidate.snr / kSnrForFullScore);
            const double fill_score = std::clamp(candidate.fill / kFillForFullScore, 0.0, 1.0);
            const double filter_score = index == 0 ? tight : kUntrackedFilterScore;
            double quality = std::clamp(
                kQualityBase + kQualitySupportWeight * support +
                    kQualitySnrWeight * snr_score + kQualityFillWeight * fill_score +
                    kQualityFilterWeight * filter_score,
                0.0, 1.0);
            // Clipped target: the centroid is biased, so the bearing is worth
            // less to triangulation even though the detection itself is real.
            if (candidate.clipped) quality *= kClippedQualityFactor;
            out.blobs.push_back({
                index == 0 ? out.cx : candidate.cx,
                index == 0 ? out.cy : candidate.cy,
                candidate.blob->area,
                candidate.fill,
                candidate.snr,
                quality,
                candidate.blob->x0,
                candidate.blob->y0,
                candidate.blob->x1,
                candidate.blob->y1,
            });
        }
        out.quality = out.blobs.front().quality;
    }

    // Background + per-pixel noise update.
    const float a_bg = static_cast<float>(std::clamp(cfg_.bg_learn_rate, 0.0, 1.0));
    const float a_fg = static_cast<float>(std::clamp(cfg_.bg_learn_rate_fg, 0.0, 1.0));
    const float a_catchup = illumination_event ? kCatchUpLearnRate : a_bg;
    for_each_range(executor_, 0, frame.size(),
                   [&](std::size_t first, std::size_t last) {
        for (std::size_t i = first; i < last; ++i) {
            // Recently-foreground pixels keep the slow alpha even once the blob
            // has faded, which is what stops a hovering target being absorbed.
            bool held = false;
            if (fg_hold_[i] > 0) {
                held = true;
                if (!illumination_event) --fg_hold_[i];
                else fg_hold_[i] = 0;
            }
            bool protect = (fg_mask_[i] || held) && !illumination_event;
            if (protect) {
                // Bounded: once a pixel has been protected for this long without
                // a break it is scenery that changed, not a target, so let the
                // background learn it.
                if (fg_streak_[i] >= cfg_.bg_hold_max_frames) {
                    protect = false;
                    fg_hold_[i] = 0;
                } else {
                    ++fg_streak_[i];
                }
            } else {
                fg_streak_[i] = 0;
            }
            const float rate = protect ? a_fg : a_catchup;
            bg_[i] += rate * (static_cast<float>(blur_[i]) - bg_[i]);
            // Update the noise estimate only from quiet pixels, and only from
            // small residuals, so it remains a floor and never chases signal.
            if (!fg_mask_[i] &&
                diff_[i] < kNoiseResidualFactor * static_cast<float>(base)) {
                noise_[i] += kNoiseLearnRate * (diff_[i] - noise_[i]);
                noise_[i] = std::clamp(noise_[i], kNoiseFloor, kNoiseCeiling);
            }
        }
    });

    if (want_debug_) {
        out.mask = mask_;
        out.mask_w = w_;
        out.mask_h = h_;
    }
    return out;
}

}  // namespace pavois
