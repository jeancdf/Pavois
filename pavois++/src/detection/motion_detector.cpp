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

template <typename Function>
void for_each_range(ParallelExecutor* executor, std::size_t begin,
                    std::size_t end, Function&& function) {
    if (executor != nullptr && executor->thread_count() > 1) {
        executor->for_each_range(begin, end, function);
    } else {
        function(begin, end);
    }
}
}

MotionDetector::MotionDetector(const CameraConfig& cfg,
                               ParallelExecutor* executor)
    : cfg_(cfg), executor_(executor) {
    cfg_.confirm_m = std::max(1, cfg_.confirm_m);
    cfg_.confirm_n = std::max(cfg_.confirm_m, cfg_.confirm_n);
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
        noise_.assign(frame.size(), 4.0f);
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
        dt = std::min(1.0, (frame.captured_us - last_us_) / 1e6);
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
                noise_[i] += 0.1f * (d - noise_[i]);
                noise_[i] = std::clamp(noise_[i], 1.5f, 18.0f);
            }
        });
        --warmup_left_;
        return out;
    }

    // Global brightness bias (exposure / white-balance drift): the mean signed
    // delta over the whole frame is dominated by the illumination shift, not by
    // the tiny target, so subtracting it makes the detector shift-invariant.
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
    const bool illumination_event = hot_ratio > cfg_.max_blob_area_ratio;

    std::vector<Blob> blobs;
    if (!illumination_event) {
        morph_open(mask_, w_, h_, std::max(0, cfg_.morph_open), executor_);
        morph_close(mask_, w_, h_, std::max(0, cfg_.morph_close), executor_);
        blobs = connected_components(mask_, diff_);
    }

    const double frame_area = static_cast<double>(w_) * static_cast<double>(h_);
    const int b = std::max(0, cfg_.border_ignore_px);

    const Blob* best = nullptr;
    double best_score = -1.0;
    for (const auto& bl : blobs) {
        const int bw = bl.x1 - bl.x0 + 1;
        const int bh = bl.y1 - bl.y0 + 1;
        if (bl.area < cfg_.min_blob_area) continue;
        if (static_cast<double>(bl.area) > cfg_.max_blob_area_ratio * frame_area) continue;
        const double fill = static_cast<double>(bl.area) / static_cast<double>(std::max(1, bw * bh));
        if (fill < cfg_.min_blob_fill_ratio) continue;
        const double aspect = static_cast<double>(std::max(bw, bh)) / static_cast<double>(std::max(1, std::min(bw, bh)));
        if (aspect > cfg_.max_blob_aspect) continue;
        if (bl.x0 < b || bl.y0 < b || bl.x1 >= w_ - b || bl.y1 >= h_ - b) continue;

        const double cx = bl.wx / std::max(1e-6, bl.wsum);
        const double cy = bl.wy / std::max(1e-6, bl.wsum);
        double continuity = 0.0;
        if (have_last_) {
            const double dist = std::hypot(cx - last_cx_, cy - last_cy_);
            continuity = std::exp(-dist / 40.0);
        }
        const double area_score = std::min(1.0, static_cast<double>(bl.area) / 800.0);
        const double energy_score = std::min(1.0, bl.energy / 60.0);
        const double score = 0.35 * area_score + 0.20 * fill + 0.20 * energy_score + 0.25 * continuity;
        if (score > best_score) {
            best_score = score;
            best = &bl;
        }
    }

    // Kalman predict step happens every frame.
    if (centroid_kf_.initialized()) centroid_kf_.predict(dt);

    fg_mask_.resize(frame.size());
    for_each_range(executor_, 0, frame.size(),
                   [&](std::size_t first, std::size_t last) {
        std::fill(fg_mask_.begin() + static_cast<std::ptrdiff_t>(first),
                  fg_mask_.begin() + static_cast<std::ptrdiff_t>(last), 0);
    });
    if (best != nullptr) {
        const double mx = best->wx / std::max(1e-6, best->wsum);
        const double my = best->wy / std::max(1e-6, best->wsum);
        out.has_blob = true;
        out.raw_cx = mx;
        out.raw_cy = my;
        out.area = best->area;
        const int bw = best->x1 - best->x0 + 1;
        const int bh = best->y1 - best->y0 + 1;
        out.fill_ratio = static_cast<double>(best->area) / static_cast<double>(std::max(1, bw * bh));

        double noise_here = 0.0;
        {
            const std::size_t ci = static_cast<std::size_t>(std::clamp<int>(static_cast<int>(my), 0, h_ - 1)) * w_ +
                                   std::clamp<int>(static_cast<int>(mx), 0, w_ - 1);
            noise_here = std::max(1.0, static_cast<double>(noise_[ci]));
        }
        out.snr = best->energy / noise_here;

        if (!centroid_kf_.initialized()) {
            centroid_kf_.init(2, {mx, my}, cfg_.centroid_process_noise, cfg_.centroid_meas_noise);
        } else {
            centroid_kf_.update({mx, my});
        }
        const auto p = centroid_kf_.position();
        // The weighted measurement is trustworthy after blur+morph+weighting;
        // blend mostly toward it and let the filter mainly supply smoothing and
        // a velocity estimate for coasting.
        out.cx = 0.85 * mx + 0.15 * p[0];
        out.cy = 0.85 * my + 0.15 * p[1];
        last_cx_ = mx;
        last_cy_ = my;
        have_last_ = true;
        confirm_hits_.push_back(1);

        // Freeze the background only over pixels of the chosen blob itself
        // (dilated a little), so a target that moves on cannot leave a
        // permanently frozen ghost behind it.
        const int pad = 2;
        for (int y = std::max(0, best->y0 - pad); y <= std::min(h_ - 1, best->y1 + pad); ++y) {
            for (int x = std::max(0, best->x0 - pad); x <= std::min(w_ - 1, best->x1 + pad); ++x) {
                const std::size_t bi = static_cast<std::size_t>(y) * w_ + x;
                if (mask_[bi]) fg_mask_[bi] = 1;
            }
        }
        // dilate fg_mask_ by `pad` so the blob's soft edge is covered too
        if (pad > 0) dilate(fg_mask_, w_, h_, pad, executor_);
    } else {
        confirm_hits_.push_back(0);
        if (centroid_kf_.initialized()) {
            const auto p = centroid_kf_.position();
            out.cx = p[0];
            out.cy = p[1];
        }
    }
    while (static_cast<int>(confirm_hits_.size()) > cfg_.confirm_n) confirm_hits_.pop_front();
    const int hits = std::accumulate(confirm_hits_.begin(), confirm_hits_.end(), 0);
    out.confirmed = out.has_blob && hits >= cfg_.confirm_m && frames_seen_ > 3;

    // Quality: temporal support, fill, SNR, filter tightness.
    if (out.has_blob) {
        const double support = static_cast<double>(hits) / static_cast<double>(cfg_.confirm_n);
        const double snr_score = std::min(1.0, out.snr / 6.0);
        const double fill_score = std::clamp(out.fill_ratio / 0.6, 0.0, 1.0);
        const double tight = std::clamp(1.0 - centroid_kf_.position_uncertainty() / 12.0, 0.0, 1.0);
        out.quality = std::clamp(0.15 + 0.35 * support + 0.25 * snr_score +
                                     0.15 * fill_score + 0.10 * tight,
                                 0.0, 1.0);
    }

    // Background + per-pixel noise update.
    const float a_bg = static_cast<float>(std::clamp(cfg_.bg_learn_rate, 0.0, 1.0));
    const float a_fg = static_cast<float>(std::clamp(cfg_.bg_learn_rate_fg, 0.0, 1.0));
    const float a_catchup = illumination_event ? 0.25f : a_bg;
    const float a_noise = 0.03f;
    const float noise_cap = 18.0f;
    for_each_range(executor_, 0, frame.size(),
                   [&](std::size_t first, std::size_t last) {
        for (std::size_t i = first; i < last; ++i) {
            const float rate = (fg_mask_[i] && !illumination_event)
                                   ? a_fg
                                   : a_catchup;
            bg_[i] += rate * (static_cast<float>(blur_[i]) - bg_[i]);
            // Update the noise estimate only from quiet pixels, and only from
            // small residuals, so it remains a floor and never chases signal.
            if (!fg_mask_[i] &&
                diff_[i] < 3.0f * static_cast<float>(base)) {
                noise_[i] += a_noise * (diff_[i] - noise_[i]);
                noise_[i] = std::clamp(noise_[i], 1.5f, noise_cap);
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
