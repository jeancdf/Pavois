#include "pavois/fusion/tracker.hpp"

#include <algorithm>
#include <cmath>

namespace pavois {
namespace {
constexpr double kEmitGraceMs = 220.0;  // stop emitting a track that hasn't been
                                        // measured this recently (CV coast only)
}

Tracker::Tracker(TrackerConfig cfg) : cfg_(cfg) {}

void Tracker::predict_to(Track& t, std::uint64_t now_us) {
    if (now_us <= t.last_update_us) return;
    const double dt = (now_us - t.last_update_us) / 1e6;
    t.kf.predict(dt);
    t.last_update_us = now_us;
}

TrackUpdate Tracker::make_update(const Track& t) const {
    TrackUpdate u;
    u.object_id = t.id;
    u.timestamp_us = t.last_update_us;
    const auto p = t.kf.position();
    u.x = p[0];
    u.y = p[1];
    u.z = p[2];
    u.confidence = t.confidence;
    u.cameras = t.cameras;
    return u;
}

std::optional<TrackUpdate> Tracker::update(const Vec3& z, std::uint64_t ts_us,
                                           double meas_conf,
                                           const std::vector<std::string>& cameras) {
    const std::vector<double> zv{z.x, z.y, z.z};

    // Associate to the nearest track by distance-to-prediction. A tight gate
    // does a normal update; a wider "recovery" gate re-seeds the velocity so a
    // track that lagged through a manoeuvre snaps back instead of fragmenting.
    Track* best = nullptr;
    double best_d = 1e18;
    for (auto& t : tracks_) {
        Track probe = t;
        predict_to(probe, ts_us);
        const auto pp = probe.kf.position();
        const double euclid = std::sqrt((pp[0] - z.x) * (pp[0] - z.x) +
                                        (pp[1] - z.y) * (pp[1] - z.y) +
                                        (pp[2] - z.z) * (pp[2] - z.z));
        if (euclid < best_d) {
            best_d = euclid;
            best = &t;
        }
    }

    const double normal_gate = cfg_.match_distance_m;
    const double recovery_gate = std::max(cfg_.match_distance_m * 3.0, 12.0);

    if (best == nullptr || best_d > recovery_gate) {
        Track t;
        t.id = next_id_++;
        t.kf.init(3, zv, cfg_.process_noise, cfg_.meas_noise);
        t.last_update_us = ts_us;
        t.created_us = ts_us;
        t.hits = 1;
        t.confidence = meas_conf * 0.5;
        t.cameras = cameras;
        tracks_.push_back(std::move(t));
        return std::nullopt;
    }

    predict_to(*best, ts_us);

    if (best_d > normal_gate) {
        // Recovery: accept the measurement but forget the stale velocity.
        const auto v = best->kf.velocity();
        best->kf.init(3, zv, cfg_.process_noise, cfg_.meas_noise);
        (void)v;
        best->hits = std::max(best->hits, cfg_.confirm_updates);  // keep identity
        best->last_update_us = ts_us;
        best->cameras = cameras;
        best->confidence = std::clamp(0.5 * best->confidence + 0.3 * meas_conf, 0.0, 0.9);
        return best->confirmed ? std::optional<TrackUpdate>(make_update(*best)) : std::nullopt;
    }

    best->kf.update(zv);
    best->hits++;
    best->misses = 0;
    best->last_update_us = ts_us;
    best->cameras = cameras;
    best->confidence = std::clamp(0.6 * best->confidence + 0.4 * meas_conf +
                                      0.02 * std::min(10, best->hits),
                                  0.0, 0.99);

    if (best->hits >= cfg_.confirm_updates && best->kf.speed() <= cfg_.max_speed_mps) {
        best->confirmed = true;
    }
    return best->confirmed ? std::optional<TrackUpdate>(make_update(*best)) : std::nullopt;
}

std::vector<TrackUpdate> Tracker::tick(std::uint64_t now_us) {
    std::vector<TrackUpdate> alive;
    for (auto& t : tracks_) {
        const double since_ms =
            now_us > t.last_update_us ? (now_us - t.last_update_us) / 1000.0 : 0.0;
        if (!t.confirmed) continue;
        if (since_ms > kEmitGraceMs) continue;  // coasted too long to trust
        Track probe = t;
        predict_to(probe, now_us);
        if (probe.kf.speed() <= cfg_.max_speed_mps) {
            alive.push_back(make_update(probe));
        }
    }

    tracks_.erase(std::remove_if(tracks_.begin(), tracks_.end(),
                                 [&](const Track& t) {
                                     const double coast_ms =
                                         now_us > t.last_update_us
                                             ? (now_us - t.last_update_us) / 1000.0
                                             : 0.0;
                                     return coast_ms > cfg_.max_coast_ms;
                                 }),
                  tracks_.end());
    return alive;
}

}  // namespace pavois
