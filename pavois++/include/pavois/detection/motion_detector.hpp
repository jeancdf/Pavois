#pragma once

#include "pavois/config/app_config.hpp"
#include "pavois/domain/frame.hpp"
#include "pavois/math/kalman_cv.hpp"

#include <cstdint>
#include <deque>
#include <vector>

namespace pavois {

class ParallelExecutor;

struct BlobDetection {
    double cx = 0.0;            // sub-pixel centroid (distorted px)
    double cy = 0.0;
    std::size_t area = 0;
    double fill_ratio = 0.0;
    double snr = 0.0;
    double quality = 0.0;       // [0,1]
    int x0 = 0;
    int y0 = 0;
    int x1 = 0;
    int y1 = 0;
};

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

    // Every component that passed the spatial/shape filters, best candidate
    // first. Temporal confirmation is frame-wide so fast targets are not lost
    // by a restrictive per-blob association gate.
    std::vector<BlobDetection> blobs;

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
    explicit MotionDetector(const CameraConfig& cfg,
                            ParallelExecutor* executor = nullptr);

    void set_debug(bool on) { want_debug_ = on; }

    // Swaps the settings between two frames, keeping the learned background.
    // Call from the thread that calls process().
    void set_config(const CameraConfig& cfg);

    // Forgets the background: the next frame starts a new warm-up, as the
    // first one did. For a restarted capture, whose image no longer matches.
    void reset() { reinit_pending_ = true; }

    DetectionResult process(const GrayFrame& frame);

private:
    struct Blob {
        int x0 = 0, y0 = 0, x1 = 0, y1 = 0;
        std::size_t area = 0;
        double wsum = 0.0, wx = 0.0, wy = 0.0;  // diff-weighted centroid accum
        double energy = 0.0;                     // mean diff over blob
    };

    // A blob that passed the shape filters, with what is needed to rank it.
    struct Candidate {
        const Blob* blob = nullptr;
        double cx = 0.0;
        double cy = 0.0;
        double fill = 0.0;
        double snr = 0.0;
        double score = 0.0;
        bool clipped = false;   // bounding box touches the frame edge
    };

    std::vector<Blob> connected_components(const std::vector<std::uint8_t>& mask,
                                           const std::vector<float>& diff);

    // The steps of process(), in the order it runs them.
    void reinitialise(const GrayFrame& frame);
    double advance_clock(const GrayFrame& frame);
    void learn_warmup();
    double brightness_bias() const;
    bool threshold_against_background(double bias);

    CameraConfig cfg_;
    ParallelExecutor* executor_ = nullptr;
    int w_ = 0;
    int h_ = 0;
    bool want_debug_ = false;
    bool reinit_pending_ = false;  // set by reset(), honoured by the next frame

    std::vector<float> bg_;        // background model (grey)
    std::vector<float> noise_;     // per-pixel EMA of |frame - bg| (sigma proxy)
    std::vector<std::uint8_t> blur_;
    std::vector<float> diff_;
    std::vector<std::uint8_t> mask_;
    std::vector<std::uint8_t> fg_mask_;  // dilated, for slow background update
    std::vector<std::uint16_t> fg_hold_;    // frames of slow-alpha protection left
    std::vector<std::uint16_t> fg_streak_;  // consecutive frames actually protected
    std::vector<std::uint8_t> cc_visited_;
    std::vector<int> cc_stack_;

    KalmanCV centroid_kf_;
    std::uint64_t last_us_ = 0;
    std::deque<int> confirm_hits_;  // 1 = hit, 0 = miss, most recent at back
    double last_cx_ = 0.0;
    double last_cy_ = 0.0;
    bool have_last_ = false;
    int warmup_left_ = 0;
};

}  // namespace pavois
