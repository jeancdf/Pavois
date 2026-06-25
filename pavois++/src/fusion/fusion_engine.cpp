#include "pavois/fusion/fusion_engine.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace pavois {
namespace {

std::uint64_t ms_to_us(int ms) {
    return static_cast<std::uint64_t>(ms) * 1000ULL;
}

double distance3(const Vec3& a, const Vec3& b) {
    const double dx = a.x - b.x;
    const double dy = a.y - b.y;
    const double dz = a.z - b.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

}  // namespace

FusionEngine::FusionEngine(int fusion_window_ms)
    : fusion_window_ms_(fusion_window_ms) {}

std::optional<TrackUpdate> FusionEngine::submit(const Observation& obs) {
    std::lock_guard<std::mutex> lock(mutex_);
    latest_[obs.camera_id] = obs;
    return fuse_locked();
}

std::optional<TrackUpdate> FusionEngine::update_track_locked(
    const Vec3& position,
    std::uint64_t timestamp_us,
    double confidence,
    const std::vector<std::string>& cameras) {
    TrackState* best = nullptr;
    double best_dist = std::numeric_limits<double>::max();
    for (auto& [id, track] : tracks_) {
        const double d = distance3(track.position, position);
        if (d < best_dist) {
            best_dist = d;
            best = &track;
        }
    }

    if (best == nullptr || best_dist > 120.0) {
        TrackState track;
        track.object_id = next_track_id_++;
        track.position = position;
        track.timestamp_us = timestamp_us;
        track.confidence = confidence;
        tracks_[track.object_id] = track;

        TrackUpdate out;
        out.object_id = track.object_id;
        out.timestamp_us = timestamp_us;
        out.x = position.x;
        out.y = position.y;
        out.z = position.z;
        out.confidence = confidence;
        out.cameras = cameras;
        return out;
    }

    best->position = position;
    best->timestamp_us = timestamp_us;
    best->confidence = confidence;

    TrackUpdate out;
    out.object_id = best->object_id;
    out.timestamp_us = timestamp_us;
    out.x = position.x;
    out.y = position.y;
    out.z = position.z;
    out.confidence = confidence;
    out.cameras = cameras;
    return out;
}

std::optional<TrackUpdate> FusionEngine::fuse_locked() {
    if (latest_.size() < 2) {
        return std::nullopt;
    }

    std::uint64_t newest = 0;
    for (const auto& [camera, obs] : latest_) {
        (void)camera;
        newest = std::max(newest, obs.timestamp_us);
    }

    const std::uint64_t window_us = ms_to_us(fusion_window_ms_);
    std::vector<Observation> usable;
    usable.reserve(latest_.size());
    for (const auto& [camera, obs] : latest_) {
        (void)camera;
        if (newest >= obs.timestamp_us && (newest - obs.timestamp_us) <= window_us) {
            usable.push_back(obs);
        }
    }

    if (usable.size() < 2) {
        return std::nullopt;
    }

    std::vector<Ray> rays;
    rays.reserve(usable.size());
    std::vector<std::string> cameras;
    cameras.reserve(usable.size());
    for (const auto& obs : usable) {
        rays.push_back(pixel_to_world_ray(obs));
        cameras.push_back(obs.camera_id);
    }

    const std::vector<double> point = least_squares_intersection(rays);
    if (point.size() != 3) {
        return std::nullopt;
    }

    Vec3 pos{point[0], point[1], point[2]};
    double residual_sum = 0.0;
    for (const auto& ray : rays) {
        residual_sum += ray_residual(ray, pos);
    }
    const double residual = residual_sum / static_cast<double>(rays.size());

    double confidence = std::min(0.99, 0.35 + 0.18 * static_cast<double>(rays.size()));
    confidence = std::max(0.0, confidence - std::min(0.4, residual / 100.0));

    return update_track_locked(pos, newest, confidence, cameras);
}

}  // namespace pavois

