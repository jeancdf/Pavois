#pragma once

#include "pavois/domain/track_update.hpp"
#include "pavois/math/kalman_cv.hpp"
#include "pavois/math/pose.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace pavois {

struct TrackerConfig {
    double gate_mahalanobis = 9.21;
    double match_distance_m = 6.0;
    double process_noise = 4.0;
    double meas_noise = 1.5;
    int confirm_updates = 3;
    int max_coast_ms = 1200;
    double max_speed_mps = 120.0;
};

// Multi-target tracker: constant-velocity Kalman filter per track, Mahalanobis
// gating, M-of-N confirmation, coast + delete on misses, speed sanity.
class Tracker {
public:
    explicit Tracker(TrackerConfig cfg);

    // Feed a fused measurement. Returns a confirmed track update if one is ready.
    std::optional<TrackUpdate> update(const Vec3& measurement,
                                      std::uint64_t timestamp_us,
                                      double meas_confidence,
                                      const std::vector<std::string>& cameras);

    // Advance all tracks to `now_us`, dropping stale ones. Returns confirmed
    // tracks that are still alive (for fixed-cadence emission).
    std::vector<TrackUpdate> tick(std::uint64_t now_us);

private:
    struct Track {
        std::uint32_t id = 0;
        KalmanCV kf;
        std::uint64_t last_update_us = 0;
        std::uint64_t created_us = 0;
        int hits = 0;
        int misses = 0;
        bool confirmed = false;
        double confidence = 0.0;
        std::vector<std::string> cameras;
    };

    TrackUpdate make_update(const Track& t) const;
    void predict_to(Track& t, std::uint64_t now_us);

    TrackerConfig cfg_;
    std::vector<Track> tracks_;
    std::uint32_t next_id_ = 1;
};

}  // namespace pavois
