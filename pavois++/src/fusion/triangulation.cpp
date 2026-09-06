#include "pavois/fusion/triangulation.hpp"

#include <algorithm>
#include <cmath>
#include <numeric>

namespace pavois {
namespace {

struct Solve {
    bool ok = false;
    Vec3 point;
    double residual = 0.0;      // mean perpendicular ray residual
    double max_residual = 0.0;  // worst single-ray residual
    double parallax = 0.0;
};

Solve solve_subset(const std::vector<Observation>& obs, const std::vector<int>& idx,
                   double max_range_m) {
    Solve s;
    std::vector<Ray> rays;
    std::vector<double> weights;
    rays.reserve(idx.size());
    for (int i : idx) {
        rays.push_back(pixel_to_world_ray(obs[i]));
        weights.push_back(std::max(0.05, obs[i].quality));
    }
    const auto pt = least_squares_intersection(rays, weights);
    if (pt.size() != 3) return s;
    const Vec3 p{pt[0], pt[1], pt[2]};

    // Cheirality: the point must be in front of every camera.
    for (std::size_t k = 0; k < rays.size(); ++k) {
        const Vec3 to_p = v_sub(p, rays[k].origin);
        if (v_dot(to_p, rays[k].direction) <= 0.0) return s;
        if (max_range_m > 0.0 && v_norm(to_p) > max_range_m * 1.5) return s;
    }

    double rsum = 0.0;
    for (const auto& r : rays) {
        const double rr = ray_residual(r, p);
        rsum += rr;
        s.max_residual = std::max(s.max_residual, rr);
    }
    s.residual = rsum / static_cast<double>(rays.size());
    s.parallax = min_pairwise_angle_deg(rays);
    s.point = p;
    s.ok = true;
    return s;
}

}  // namespace

TriangulationResult triangulate(const std::vector<Observation>& obs,
                                const TriangulationConfig& cfg) {
    TriangulationResult out;
    if (obs.size() < 2) {
        out.reject_reason = "need >= 2 observations";
        return out;
    }

    std::vector<int> all(obs.size());
    std::iota(all.begin(), all.end(), 0);

    std::vector<int> best_set;
    Solve best;
    double best_score = -1.0;

    auto consider = [&](const std::vector<int>& idx) {
        if (idx.size() < 2) return;
        const Solve s = solve_subset(obs, idx, cfg.max_range_m);
        if (!s.ok) return;
        if (s.parallax < cfg.min_parallax_deg) return;
        // Every contributing ray must agree with the solution, not just on
        // average -- this is what forces a lone bad blob out of the inlier set.
        if (s.max_residual > cfg.max_residual_m) return;
        // Prefer more inliers, then lower residual.
        const double score = idx.size() * 100.0 - s.residual;
        if (score > best_score) {
            best_score = score;
            best_set = idx;
            best = s;
        }
    };

    consider(all);

    // RANSAC-lite: for 3+ cameras, also try every leave-one-out subset so a
    // single bad blob cannot drag the solution.
    if (obs.size() >= 3) {
        for (std::size_t drop = 0; drop < obs.size(); ++drop) {
            std::vector<int> sub;
            for (std::size_t i = 0; i < obs.size(); ++i)
                if (i != drop) sub.push_back(static_cast<int>(i));
            consider(sub);
        }
    }

    if (best_set.empty()) {
        out.reject_reason = "no subset passed parallax/residual gates";
        return out;
    }

    out.ok = true;
    out.point = best.point;
    out.residual_m = best.residual;
    out.parallax_deg = best.parallax;
    for (int i : best_set) out.cameras.push_back(obs[i].camera_id);

    const double n_score = std::min(1.0, 0.3 + 0.2 * static_cast<double>(best_set.size()));
    const double res_score = std::clamp(1.0 - best.residual / std::max(0.5, cfg.max_residual_m), 0.0, 1.0);
    const double par_score = std::clamp(best.parallax / 25.0, 0.2, 1.0);
    double q_mean = 0.0;
    for (int i : best_set) q_mean += std::max(0.05, obs[i].quality);
    q_mean /= static_cast<double>(best_set.size());
    out.confidence = std::clamp(n_score * (0.4 * res_score + 0.3 * par_score + 0.3 * q_mean) * 1.6,
                                0.0, 0.99);
    return out;
}

}  // namespace pavois
