#include "pavois/fusion/fusion_engine.hpp"

#include <algorithm>
#include <sstream>

namespace pavois {
namespace {

std::uint64_t ms_to_us(int ms) { return static_cast<std::uint64_t>(std::max(0, ms)) * 1000ULL; }

std::uint64_t obs_time(const Observation& o) {
    return o.captured_us != 0 ? o.captured_us : o.timestamp_us;
}

Observation lerp_obs(const Observation& a, const Observation& b, double f) {
    Observation o = (f < 0.5) ? a : b;  // carry pose/intrinsics from the nearer
    o.centroid_x = a.centroid_x + (b.centroid_x - a.centroid_x) * f;
    o.centroid_y = a.centroid_y + (b.centroid_y - a.centroid_y) * f;
    o.quality = std::min(a.quality, b.quality);
    return o;
}

}  // namespace

FusionEngine::FusionEngine(const FusionSettings& settings)
    : settings_(settings), tracker_(settings.tracker) {}

std::vector<Observation> FusionEngine::time_align_locked(std::uint64_t t_ref) const {
    const std::uint64_t window = ms_to_us(settings_.fusion_window_ms);
    std::vector<Observation> aligned;
    for (const auto& [cam, hist] : history_) {
        (void)cam;
        if (hist.empty()) continue;

        const Observation* lo = nullptr;
        const Observation* hi = nullptr;
        for (const auto& o : hist) {
            const std::uint64_t t = obs_time(o);
            if (t <= t_ref && (lo == nullptr || t > obs_time(*lo))) lo = &o;
            if (t >= t_ref && (hi == nullptr || t < obs_time(*hi))) hi = &o;
        }

        if (lo != nullptr && hi != nullptr && lo != hi) {
            const std::uint64_t span = obs_time(*hi) - obs_time(*lo);
            const double f = span == 0 ? 0.0 : static_cast<double>(t_ref - obs_time(*lo)) /
                                                   static_cast<double>(span);
            aligned.push_back(lerp_obs(*lo, *hi, f));
        } else if (lo != nullptr && lo == hi) {
            aligned.push_back(*lo);
        } else if (lo != nullptr && t_ref - obs_time(*lo) <= window) {
            Observation o = *lo;
            o.quality *= 0.8;  // extrapolation penalty
            aligned.push_back(o);
        } else if (hi != nullptr && obs_time(*hi) - t_ref <= window) {
            Observation o = *hi;
            o.quality *= 0.8;
            aligned.push_back(o);
        }
    }
    return aligned;
}

std::vector<TrackUpdate> FusionEngine::submit(const Observation& obs) {
    std::lock_guard<std::mutex> lock(mutex_);

    auto& hist = history_[obs.camera_id];
    hist.push_back(obs);
    const std::uint64_t now = obs_time(obs);
    const std::uint64_t keep = ms_to_us(std::max(settings_.fusion_window_ms * 6, 1000));
    while (!hist.empty() && now > keep && obs_time(hist.front()) < now - keep) {
        hist.pop_front();
    }

    std::vector<TrackUpdate> out;

    // Throttle: fuse at most once per fusion cycle. Each camera calls submit()
    // on every frame, but triangulating (and stepping the tracker) three times
    // per cycle with near-identical measurements starves the velocity estimate
    // and makes the track lag on manoeuvres.
    const std::uint64_t fuse_interval =
        ms_to_us(std::max(1, settings_.fusion_emit_interval_ms));
    const bool do_fuse = (last_fuse_us_ == 0) || (now >= last_fuse_us_ + fuse_interval);

    const std::vector<Observation> aligned =
        do_fuse ? time_align_locked(now) : std::vector<Observation>{};
    if (do_fuse && aligned.size() >= 2) {
        last_fuse_us_ = now;
        const TriangulationResult tri = triangulate(aligned, settings_.triangulation);
        std::ostringstream st;
        if (tri.ok) {
            st << "fuse ok n=" << tri.cameras.size()
               << " res=" << tri.residual_m << "m par=" << tri.parallax_deg
               << "deg conf=" << tri.confidence;
            if (auto up = tracker_.update(tri.point, now, tri.confidence, tri.cameras)) {
                out.push_back(*up);
            }
        } else {
            st << "fuse reject: " << tri.reject_reason << " (n=" << aligned.size() << ")";
        }
        last_status_ = st.str();
    } else if (do_fuse) {
        last_status_ = "waiting for >=2 cameras";
    }

    // Fixed-cadence refresh of confirmed tracks.
    if (last_emit_us_ == 0 ||
        now >= last_emit_us_ + ms_to_us(settings_.fusion_emit_interval_ms)) {
        last_emit_us_ = now;
        for (auto& u : tracker_.tick(now)) {
            const bool dup = std::any_of(out.begin(), out.end(), [&](const TrackUpdate& e) {
                return e.object_id == u.object_id;
            });
            if (!dup) out.push_back(u);
        }
    }
    return out;
}

std::string FusionEngine::last_status() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return last_status_;
}

}  // namespace pavois
