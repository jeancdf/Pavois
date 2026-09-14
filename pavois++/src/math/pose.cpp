#include "pavois/math/pose.hpp"

#include <algorithm>
#include <array>
#include <cmath>

namespace pavois {
namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr double kDeg = kPi / 180.0;

Mat3 multiply(const Mat3& a, const Mat3& b) {
    Mat3 out;
    for (int r = 0; r < 3; ++r)
        for (int c = 0; c < 3; ++c)
            out.m[r * 3 + c] = a.m[r * 3 + 0] * b.m[0 * 3 + c] +
                               a.m[r * 3 + 1] * b.m[1 * 3 + c] +
                               a.m[r * 3 + 2] * b.m[2 * 3 + c];
    return out;
}
}  // namespace

Vec3 v_add(const Vec3& a, const Vec3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
Vec3 v_sub(const Vec3& a, const Vec3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
Vec3 v_scale(const Vec3& v, double s) { return {v.x * s, v.y * s, v.z * s}; }
double v_dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
Vec3 v_cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
double v_norm(const Vec3& v) { return std::sqrt(v_dot(v, v)); }
Vec3 normalize(const Vec3& v) {
    const double n = v_norm(v);
    return (n <= 1e-12) ? Vec3{0, 0, 0} : v_scale(v, 1.0 / n);
}

Mat3 rotation_matrix_ypr(double yaw_deg, double pitch_deg, double roll_deg) {
    const double y = yaw_deg * kDeg, p = pitch_deg * kDeg, r = roll_deg * kDeg;
    Mat3 Rz{{std::cos(y), -std::sin(y), 0, std::sin(y), std::cos(y), 0, 0, 0, 1}};
    Mat3 Ry{{std::cos(r), 0, std::sin(r), 0, 1, 0, -std::sin(r), 0, std::cos(r)}};
    Mat3 Rx{{1, 0, 0, 0, std::cos(p), -std::sin(p), 0, std::sin(p), std::cos(p)}};
    return multiply(multiply(Rz, Ry), Rx);
}

CameraBasis camera_basis(const CameraPose& pose) {
    const double h = pose.heading_deg * kDeg;
    const double e = pose.elevation_deg * kDeg;
    const double roll = pose.roll_deg * kDeg;

    // ENU: x = East, y = North, z = Up. Compass heading is CW from North.
    const Vec3 forward{std::sin(h) * std::cos(e), std::cos(h) * std::cos(e), std::sin(e)};
    // right is horizontal, 90 deg CW from the ground track (East when facing North).
    Vec3 right{std::cos(h), -std::sin(h), 0.0};
    Vec3 up = normalize(v_cross(right, forward));

    if (roll != 0.0) {
        const double cr = std::cos(roll), sr = std::sin(roll);
        const Vec3 r2 = v_add(v_scale(right, cr), v_scale(up, sr));
        const Vec3 u2 = v_add(v_scale(up, cr), v_scale(right, -sr));
        right = r2;
        up = u2;
    }
    return {normalize(forward), normalize(right), up};
}

CameraIntrinsics effective_intrinsics(const Observation& obs) {
    CameraIntrinsics in = obs.intrinsics;
    if (in.image_width <= 0) in.image_width = obs.image_width;
    if (in.image_height <= 0) in.image_height = obs.image_height;
    if (in.fov_deg <= 0.0) in.fov_deg = obs.fov_deg;
    if (in.fx <= 0.0) {
        const double half = in.fov_deg * 0.5 * kDeg;
        in.fx = (half > 1e-6 && in.image_width > 0)
                    ? (in.image_width * 0.5) / std::tan(half)
                    : std::max(1, in.image_width);
    }
    if (in.fy <= 0.0) in.fy = in.fx;
    if (in.cx <= 0.0) in.cx = in.image_width * 0.5;
    if (in.cy <= 0.0) in.cy = in.image_height * 0.5;
    return in;
}

void undistort_pixel(const CameraIntrinsics& in, double px, double py,
                     double& xn, double& yn) {
    const double xd = (px - in.cx) / in.fx;
    const double yd = (py - in.cy) / in.fy;
    xn = xd;
    yn = yd;
    if (in.k1 == 0.0 && in.k2 == 0.0 && in.p1 == 0.0 &&
        in.p2 == 0.0 && in.k3 == 0.0) return;
    // Iterative inverse of OpenCV's Brown-Conrady model.
    for (int i = 0; i < 8; ++i) {
        const double r2 = xn * xn + yn * yn;
        const double radial = 1.0 + in.k1 * r2 + in.k2 * r2 * r2 +
                              in.k3 * r2 * r2 * r2;
        const double dx = 2.0 * in.p1 * xn * yn +
                          in.p2 * (r2 + 2.0 * xn * xn);
        const double dy = in.p1 * (r2 + 2.0 * yn * yn) +
                          2.0 * in.p2 * xn * yn;
        if (std::fabs(radial) < 1e-12) break;
        xn = (xd - dx) / radial;
        yn = (yd - dy) / radial;
    }
}

Ray pixel_to_ray(const CameraIntrinsics& in, const CameraPose& pose,
                 double px, double py) {
    double xn = 0.0, yn = 0.0;
    undistort_pixel(in, px, py, xn, yn);
    const CameraBasis b = camera_basis(pose);
    // image +x -> right, image +y is down -> -up.
    Vec3 dir = v_add(b.forward, v_add(v_scale(b.right, xn), v_scale(b.up, -yn)));
    return {{pose.x, pose.y, pose.z}, normalize(dir)};
}

std::optional<std::array<double, 2>> project_world_to_pixel(
    const CameraIntrinsics& in, const CameraPose& pose, const Vec3& world) {
    const CameraBasis b = camera_basis(pose);
    const Vec3 rel = v_sub(world, Vec3{pose.x, pose.y, pose.z});
    const double zc = v_dot(rel, b.forward);
    if (zc <= 1e-6) return std::nullopt;
    const double xc = v_dot(rel, b.right);
    const double yc = -v_dot(rel, b.up);
    double xn = xc / zc, yn = yc / zc;
    const double r2 = xn * xn + yn * yn;
    const double radial = 1.0 + in.k1 * r2 + in.k2 * r2 * r2 +
                          in.k3 * r2 * r2 * r2;
    const double xd = xn * radial + 2.0 * in.p1 * xn * yn +
                      in.p2 * (r2 + 2.0 * xn * xn);
    const double yd = yn * radial + in.p1 * (r2 + 2.0 * yn * yn) +
                      2.0 * in.p2 * xn * yn;
    return std::array<double, 2>{in.cx + in.fx * xd, in.cy + in.fy * yd};
}

Ray pixel_to_world_ray(const Observation& obs) {
    CameraPose pose = obs.pose;
    // Fall back to legacy flat fields if the structured pose is unset.
    if (pose.x == 0.0 && pose.y == 0.0 && pose.z == 0.0 &&
        (obs.cam_x != 0.0 || obs.cam_y != 0.0 || obs.cam_z != 0.0)) {
        pose.x = obs.cam_x;
        pose.y = obs.cam_y;
        pose.z = obs.cam_z;
    }
    if (pose.heading_deg == 0.0 && pose.elevation_deg == 0.0 && obs.yaw_deg != 0.0) {
        pose.heading_deg = obs.yaw_deg;
    }
    return pixel_to_ray(effective_intrinsics(obs), pose, obs.centroid_x, obs.centroid_y);
}

std::vector<double> least_squares_intersection(const std::vector<Ray>& rays,
                                               const std::vector<double>& weights) {
    if (rays.size() < 2) return {};
    std::array<double, 9> A{};
    std::array<double, 3> b{0.0, 0.0, 0.0};
    for (std::size_t idx = 0; idx < rays.size(); ++idx) {
        const Vec3 d = normalize(rays[idx].direction);
        const double w = weights.empty() ? 1.0 : std::max(1e-6, weights[idx]);
        const std::array<double, 9> P = {
            w * (1.0 - d.x * d.x), w * (-d.x * d.y),       w * (-d.x * d.z),
            w * (-d.y * d.x),      w * (1.0 - d.y * d.y),  w * (-d.y * d.z),
            w * (-d.z * d.x),      w * (-d.z * d.y),       w * (1.0 - d.z * d.z)};
        for (int i = 0; i < 9; ++i) A[i] += P[i];
        const Vec3 p = rays[idx].origin;
        b[0] += P[0] * p.x + P[1] * p.y + P[2] * p.z;
        b[1] += P[3] * p.x + P[4] * p.y + P[5] * p.z;
        b[2] += P[6] * p.x + P[7] * p.y + P[8] * p.z;
    }
    double M[3][4] = {{A[0], A[1], A[2], b[0]},
                      {A[3], A[4], A[5], b[1]},
                      {A[6], A[7], A[8], b[2]}};
    for (int col = 0; col < 3; ++col) {
        int pivot = col;
        for (int row = col + 1; row < 3; ++row)
            if (std::fabs(M[row][col]) > std::fabs(M[pivot][col])) pivot = row;
        if (std::fabs(M[pivot][col]) < 1e-12) return {};
        if (pivot != col)
            for (int k = col; k < 4; ++k) std::swap(M[col][k], M[pivot][k]);
        const double div = M[col][col];
        for (int k = col; k < 4; ++k) M[col][k] /= div;
        for (int row = 0; row < 3; ++row) {
            if (row == col) continue;
            const double factor = M[row][col];
            for (int k = col; k < 4; ++k) M[row][k] -= factor * M[col][k];
        }
    }
    return {M[0][3], M[1][3], M[2][3]};
}

double ray_residual(const Ray& ray, const Vec3& point) {
    const Vec3 d = normalize(ray.direction);
    const Vec3 w = v_sub(point, ray.origin);
    return v_norm(v_cross(w, d));
}

double min_pairwise_angle_deg(const std::vector<Ray>& rays) {
    double best = 180.0;
    for (std::size_t i = 0; i < rays.size(); ++i)
        for (std::size_t j = i + 1; j < rays.size(); ++j) {
            const double c = std::clamp(
                v_dot(normalize(rays[i].direction), normalize(rays[j].direction)), -1.0, 1.0);
            best = std::min(best, std::acos(c) / kDeg);
        }
    return best;
}

}  // namespace pavois
