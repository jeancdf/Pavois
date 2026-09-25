#pragma once

#include "pavois/domain/observation.hpp"
#include "pavois/domain/track_update.hpp"
#include "pavois/fusion/tracker.hpp"
#include "pavois/fusion/triangulation.hpp"

#include <cstdint>
#include <deque>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace pavois {

struct FusionSettings {
    int fusion_window_ms = 20;
    int fusion_emit_interval_ms = 60;
    TriangulationConfig triangulation;
    TrackerConfig tracker;
};

class FusionEngine {
public:
    explicit FusionEngine(const FusionSettings& settings);

    // Ingest one camera observation. Returns any track updates ready to emit
    // (immediate promotions + fixed-cadence refreshes of confirmed tracks).
    std::vector<TrackUpdate> submit(const Observation& obs);

    // Diagnostics for the last fuse attempt (thread-safe snapshot).
    std::string last_status() const;

private:
    std::vector<Observation> time_align_locked(std::uint64_t t_ref) const;

    mutable std::mutex mutex_;
    FusionSettings settings_;
    // A coasted track is a Kalman prediction, not a measurement, so it can
    // drift somewhere the geometry rules out even though every triangulation
    // was gated. Drop those before they reach the map.
    bool plausible_locked(const TrackUpdate& update) const;

    std::unordered_map<std::string, std::deque<Observation>> history_;
    Tracker tracker_;
    std::uint64_t last_emit_us_ = 0;
    std::uint64_t last_fuse_us_ = 0;
    std::string last_status_;
};

}  // namespace pavois
