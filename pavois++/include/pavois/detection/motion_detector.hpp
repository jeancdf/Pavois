#pragma once

#include "pavois/config/app_config.hpp"
#include "pavois/domain/frame.hpp"
#include "pavois/math/kalman_cv.hpp"

#include <cstdint>
#include <deque>
#include <vector>

namespace pavois {

struct DetectionResult {
    bool has_blob = false;      // a plausible blob was found this frame
    bool confirmed = false;     // passed M-of-N temporal confirmation
    double cx = 0.0;            // filtered sub-pixel centroid (distorted px)
    double cy = 0.0;
    double raw_cx = 0.0;
    double raw_cy = 0.0;
    std::size_t area = 0;
    double fill_ratio = 0.0;
    double snr = 0.0;           // blob energy / background noise
    double quality = 0.0;       // [0,1]

    // Debug artefacts (filled only when want_debug was set on the detector).
    std::vector<std::uint8_t> mask;
    int mask_w = 0;
    int mask_h = 0;
};

// Per-camera moving-target detector:
//   running-average background -> adaptive per-pixel threshold ->
//   morphology -> connected components -> blob filtering & scoring ->
//   2D constant-velocity Kalman on the centroid -> M-of-N confirmation.
class MotionDetector {
public:
    explicit MotionDetector(const CameraConfig& cfg);

    void set_debug(bool on) { want_debug_ = on; }

    DetectionResult process(const GrayFrame& frame);

private:
    struct Blob {
        int x0 = 0, y0 = 0, x1 = 0, y1 = 0;
        std::size_t area = 0;
        double wsum = 0.0, wx = 0.0, wy = 0.0;  // diff-weighted centroid accum
        double energy = 0.0;                     // mean diff over blob
    };

    std::vector<Blob> connected_components(const std::vector<std::uint8_t>& mask,
                                           const std::vector<float>& diff) const;

    CameraConfig cfg_;
    int w_ = 0;
    int h_ = 0;
    bool want_debug_ = false;

    std::vector<float> bg_;        // background model (grey)
    std::vector<float> noise_;     // per-pixel EMA of |frame - bg| (sigma proxy)
    std::vector<std::uint8_t> blur_;
    std::vector<float> diff_;
    std::vector<std::uint8_t> mask_;
    std::vector<std::uint8_t> fg_mask_;  // dilated, for slow background update

    KalmanCV centroid_kf_;
    std::uint64_t last_us_ = 0;
    std::deque<int> confirm_hits_;  // 1 = hit, 0 = miss, most recent at back
    double last_cx_ = 0.0;
    double last_cy_ = 0.0;
    bool have_last_ = false;
    std::uint64_t frames_seen_ = 0;
    int warmup_left_ = 0;
};

}  // namespace pavois
