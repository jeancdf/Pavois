#pragma once

#include "pavois/domain/observation.hpp"
#include "pavois/domain/track_update.hpp"

#include <array>
#include <vector>

namespace pavois {

struct Vec3 {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
};

struct Ray {
    Vec3 origin;
    Vec3 direction;
};

struct Mat3 {
    std::array<double, 9> m{};
};

Mat3 rotation_matrix_ypr(double yaw_deg, double pitch_deg, double roll_deg);
Vec3 normalize(const Vec3& v);
Ray pixel_to_world_ray(const Observation& obs);
std::vector<double> least_squares_intersection(const std::vector<Ray>& rays);
double ray_residual(const Ray& ray, const Vec3& point);

}  // namespace pavois

