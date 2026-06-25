#include "pavois/math/pose.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>

namespace pavois {
namespace {

constexpr double kPi = 3.14159265358979323846;

Mat3 multiply(const Mat3& a, const Mat3& b) {
    Mat3 out;
    for (int r = 0; r < 3; ++r) {
        for (int c = 0; c < 3; ++c) {
            out.m[r * 3 + c] =
                a.m[r * 3 + 0] * b.m[0 * 3 + c] +
                a.m[r * 3 + 1] * b.m[1 * 3 + c] +
                a.m[r * 3 + 2] * b.m[2 * 3 + c];
        }
    }
    return out;
}

Vec3 mul(const Mat3& m, const Vec3& v) {
    return {
        m.m[0] * v.x + m.m[1] * v.y + m.m[2] * v.z,
        m.m[3] * v.x + m.m[4] * v.y + m.m[5] * v.z,
        m.m[6] * v.x + m.m[7] * v.y + m.m[8] * v.z,
    };
}

double dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

Vec3 sub(const Vec3& a, const Vec3& b) {
    return {a.x - b.x, a.y - b.y, a.z - b.z};
}

Vec3 scale(const Vec3& v, double s) {
    return {v.x * s, v.y * s, v.z * s};
}

}  // namespace

Mat3 rotation_matrix_ypr(double yaw_deg, double pitch_deg, double roll_deg) {
    const double y = yaw_deg * kPi / 180.0;
    const double p = pitch_deg * kPi / 180.0;
    const double r = roll_deg * kPi / 180.0;

    Mat3 Rz{{std::cos(y), -std::sin(y), 0.0,
             std::sin(y),  std::cos(y), 0.0,
             0.0,          0.0,         1.0}};
    Mat3 Ry{{std::cos(r), 0.0, std::sin(r),
             0.0,         1.0, 0.0,
             -std::sin(r), 0.0, std::cos(r)}};
    Mat3 Rx{{1.0, 0.0,          0.0,
             0.0, std::cos(p), -std::sin(p),
             0.0, std::sin(p),  std::cos(p)}};
    return multiply(multiply(Rz, Ry), Rx);
}

Vec3 normalize(const Vec3& v) {
    const double n = std::sqrt(dot(v, v));
    if (n <= 1e-12) {
        return {0.0, 0.0, 0.0};
    }
    return scale(v, 1.0 / n);
}

Ray pixel_to_world_ray(const Observation& obs) {
    const double fx = (static_cast<double>(obs.image_width) * 0.5) /
                      std::tan(obs.fov_deg * kPi / 360.0);
    const double cx = static_cast<double>(obs.image_width) * 0.5;
    const double cy = static_cast<double>(obs.image_height) * 0.5;

    Vec3 d_cam{
        (obs.centroid_x - cx) / fx,
        (cy - obs.centroid_y) / fx,
        1.0,
    };
    d_cam = normalize(d_cam);

    const Mat3 R = rotation_matrix_ypr(obs.yaw_deg, obs.pitch_deg, obs.roll_deg);
    Vec3 d_world = normalize(mul(R, d_cam));

    return {
        {obs.cam_x, obs.cam_y, obs.cam_z},
        d_world,
    };
}

std::vector<double> least_squares_intersection(const std::vector<Ray>& rays) {
    if (rays.size() < 2) {
        return {};
    }

    std::array<double, 9> A{};
    std::array<double, 3> b{0.0, 0.0, 0.0};

    for (const auto& ray : rays) {
        const Vec3 d = normalize(ray.direction);
        const std::array<double, 9> P = {
            1.0 - d.x * d.x, -d.x * d.y,      -d.x * d.z,
            -d.y * d.x,      1.0 - d.y * d.y, -d.y * d.z,
            -d.z * d.x,      -d.z * d.y,      1.0 - d.z * d.z};

        for (int i = 0; i < 9; ++i) {
            A[i] += P[i];
        }

        const Vec3 p = ray.origin;
        b[0] += P[0] * p.x + P[1] * p.y + P[2] * p.z;
        b[1] += P[3] * p.x + P[4] * p.y + P[5] * p.z;
        b[2] += P[6] * p.x + P[7] * p.y + P[8] * p.z;
    }

    // Gaussian elimination for 3x3.
    double M[3][4] = {
        {A[0], A[1], A[2], b[0]},
        {A[3], A[4], A[5], b[1]},
        {A[6], A[7], A[8], b[2]},
    };

    for (int col = 0; col < 3; ++col) {
        int pivot = col;
        for (int row = col + 1; row < 3; ++row) {
            if (std::fabs(M[row][col]) > std::fabs(M[pivot][col])) {
                pivot = row;
            }
        }
        if (std::fabs(M[pivot][col]) < 1e-12) {
            return {};
        }
        if (pivot != col) {
            for (int k = col; k < 4; ++k) {
                std::swap(M[col][k], M[pivot][k]);
            }
        }

        const double div = M[col][col];
        for (int k = col; k < 4; ++k) {
            M[col][k] /= div;
        }
        for (int row = 0; row < 3; ++row) {
            if (row == col) {
                continue;
            }
            const double factor = M[row][col];
            for (int k = col; k < 4; ++k) {
                M[row][k] -= factor * M[col][k];
            }
        }
    }

    return {M[0][3], M[1][3], M[2][3]};
}

double ray_residual(const Ray& ray, const Vec3& point) {
    const Vec3 d = normalize(ray.direction);
    const Vec3 w = sub(point, ray.origin);
    const Vec3 cross{
        w.y * d.z - w.z * d.y,
        w.z * d.x - w.x * d.z,
        w.x * d.y - w.y * d.x,
    };
    return std::sqrt(dot(cross, cross));
}

}  // namespace pavois
