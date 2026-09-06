#pragma once

#include "pavois/domain/observation.hpp"
#include "pavois/math/pose.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace pavois {

struct TriangulationConfig {
    double min_parallax_deg = 2.0;
    double max_residual_m = 3.0;
    double max_range_m = 60.0;
    int ransac_iterations = 24;
};

struct TriangulationResult {
    bool ok = false;
    Vec3 point;
    double residual_m = 0.0;       // mean perpendicular ray residual
    double parallax_deg = 0.0;     // min pairwise angle among inliers
    double confidence = 0.0;       // [0,1]
    std::vector<std::string> cameras;  // inlier camera ids
    std::string reject_reason;
};

// Triangulate a world point from >= 2 time-aligned observations.
// Applies cheirality, parallax and reprojection-residual gates, and (for 3+
// observations) a small RANSAC to drop a single outlier camera.
TriangulationResult triangulate(const std::vector<Observation>& obs,
                                const TriangulationConfig& cfg);

}  // namespace pavois
