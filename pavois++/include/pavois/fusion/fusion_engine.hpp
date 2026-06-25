#pragma once

#include "pavois/domain/observation.hpp"
#include "pavois/domain/track_update.hpp"
#include "pavois/math/pose.hpp"

#include <chrono>
#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

namespace pavois {

class FusionEngine {
public:
    explicit FusionEngine(int fusion_window_ms);

    std::optional<TrackUpdate> submit(const Observation& obs);

private:
    struct TrackState {
        std::uint32_t object_id = 0;
        Vec3 position;
        std::uint64_t timestamp_us = 0;
        double confidence = 0.0;
    };

    std::mutex mutex_;
    std::unordered_map<std::string, Observation> latest_;
    std::unordered_map<std::uint32_t, TrackState> tracks_;
    std::uint32_t next_track_id_ = 1;
    int fusion_window_ms_ = 150;

    std::optional<TrackUpdate> fuse_locked();
    std::optional<TrackUpdate> update_track_locked(const Vec3& position, std::uint64_t timestamp_us, double confidence, const std::vector<std::string>& cameras);
};

}  // namespace pavois

