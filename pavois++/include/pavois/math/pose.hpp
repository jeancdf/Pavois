#pragma once

#include "pavois/domain/observation.hpp"
#include "pavois/domain/track_update.hpp"

#include <array>
#include <optional>
#include <vector>

namespace pavois {

struct Vec3 {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
};

struct Ray {
    Vec3 origin;
    Vec3 direction;  // unit
};

struct Mat3 {
    std::array<double, 9> m{};
};

// --- vector helpers ---
Vec3 v_add(const Vec3& a, const Vec3& b);
Vec3 v_sub(const Vec3& a, const Vec3& b);
Vec3 v_scale(const Vec3& v, double s);
double v_dot(const Vec3& a, const Vec3& b);
Vec3 v_cross(const Vec3& a, const Vec3& b);
double v_norm(const Vec3& v);
Vec3 normalize(const Vec3& v);

// Legacy yaw/pitch/roll rotation (kept for compatibility with old tests).
Mat3 rotation_matrix_ypr(double yaw_deg, double pitch_deg, double roll_deg);

// Camera optical basis in the local ENU frame.
// forward = optical axis, right = image +x, up = image -y (i.e. world up-ish).
struct CameraBasis {
    Vec3 forward;
    Vec3 right;
    Vec3 up;
};
CameraBasis camera_basis(const CameraPose& pose);

// Effective intrinsics for an observation (falls back to fov_deg / image size).
CameraIntrinsics effective_intrinsics(const Observation& obs);

// Remove radial distortion: distorted pixel -> normalised, undistorted (x/z,y/z).
void undistort_pixel(const CameraIntrinsics& in, double px, double py,
                     double& xn, double& yn);

// Back-project a distorted pixel to a world-space ray.
Ray pixel_to_ray(const CameraIntrinsics& in, const CameraPose& pose,
                 double px, double py);

// Project a world point into the (distorted) image. nullopt if behind camera.
std::optional<std::array<double, 2>> project_world_to_pixel(
    const CameraIntrinsics& in, const CameraPose& pose, const Vec3& world);

// Convenience: build a world ray straight from an Observation.
Ray pixel_to_world_ray(const Observation& obs);

// Weighted least-squares closest point to a bundle of rays.
// `weights` may be empty (uniform). Returns {} if degenerate.
std::vector<double> least_squares_intersection(const std::vector<Ray>& rays,
                                               const std::vector<double>& weights = {});

// Perpendicular distance from a point to a ray line.
double ray_residual(const Ray& ray, const Vec3& point);

// Smallest angle (deg) between any pair of the given rays.
double min_pairwise_angle_deg(const std::vector<Ray>& rays);

}  // namespace pavois
