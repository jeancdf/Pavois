#pragma once

#include "pavois/math/linalg.hpp"

#include <cstddef>
#include <vector>

namespace pavois {

// Constant-velocity Kalman filter in `dim` spatial dimensions.
// State layout: [p_0..p_{dim-1}, v_0..v_{dim-1}].
class KalmanCV {
public:
    KalmanCV() = default;

    // process_noise: white-noise acceleration PSD (units^2 / s^3-ish).
    // meas_noise: measurement std-dev per axis (units).
    void init(std::size_t dim, const std::vector<double>& p0,
              double process_noise, double meas_noise) {
        dim_ = dim;
        q_ = process_noise;
        r_ = meas_noise * meas_noise;
        const std::size_t n = 2 * dim;
        x_ = Mat(n, 1, 0.0);
        for (std::size_t i = 0; i < dim; ++i) x_(i, 0) = p0[i];
        P_ = Mat::identity(n);
        for (std::size_t i = 0; i < dim; ++i) {
            P_(i, i) = meas_noise * meas_noise;
            P_(dim + i, dim + i) = 100.0;  // wide initial velocity prior
        }
        initialized_ = true;
    }

    bool initialized() const { return initialized_; }
    std::size_t dim() const { return dim_; }

    void predict(double dt) {
        if (!initialized_ || dt <= 0.0) return;
        const std::size_t n = 2 * dim_;
        Mat F = Mat::identity(n);
        for (std::size_t i = 0; i < dim_; ++i) F(i, dim_ + i) = dt;

        // Discrete white-noise acceleration process covariance.
        Mat Q(n, n, 0.0);
        const double t2 = dt * dt, t3 = t2 * dt, t4 = t3 * dt;
        for (std::size_t i = 0; i < dim_; ++i) {
            Q(i, i) = q_ * t4 / 4.0;
            Q(i, dim_ + i) = q_ * t3 / 2.0;
            Q(dim_ + i, i) = q_ * t3 / 2.0;
            Q(dim_ + i, dim_ + i) = q_ * t2;
        }
        x_ = F * x_;
        P_ = F * P_ * F.transpose() + Q;
    }

    void update(const std::vector<double>& z) {
        if (!initialized_) return;
        const std::size_t n = 2 * dim_;
        Mat H(dim_, n, 0.0);
        for (std::size_t i = 0; i < dim_; ++i) H(i, i) = 1.0;
        Mat R(dim_, dim_, 0.0);
        for (std::size_t i = 0; i < dim_; ++i) R(i, i) = r_;

        Mat zz(dim_, 1, 0.0);
        for (std::size_t i = 0; i < dim_; ++i) zz(i, 0) = z[i];

        Mat y = zz - H * x_;
        Mat S = H * P_ * H.transpose() + R;
        Mat K = P_ * H.transpose() * S.inverse();
        x_ = x_ + K * y;
        Mat I = Mat::identity(n);
        P_ = (I - K * H) * P_;
    }

    // Squared Mahalanobis distance of measurement z to the predicted position.
    double gating_distance(const std::vector<double>& z) const {
        const std::size_t n = 2 * dim_;
        Mat H(dim_, n, 0.0);
        for (std::size_t i = 0; i < dim_; ++i) H(i, i) = 1.0;
        Mat R(dim_, dim_, 0.0);
        for (std::size_t i = 0; i < dim_; ++i) R(i, i) = r_;
        Mat zz(dim_, 1, 0.0);
        for (std::size_t i = 0; i < dim_; ++i) zz(i, 0) = z[i];
        Mat y = zz - H * x_;
        Mat S = H * P_ * H.transpose() + R;
        Mat d = y.transpose() * S.inverse() * y;
        return d(0, 0);
    }

    std::vector<double> position() const {
        std::vector<double> p(dim_);
        for (std::size_t i = 0; i < dim_; ++i) p[i] = x_(i, 0);
        return p;
    }
    std::vector<double> velocity() const {
        std::vector<double> v(dim_);
        for (std::size_t i = 0; i < dim_; ++i) v[i] = x_(dim_ + i, 0);
        return v;
    }
    double speed() const {
        double s = 0.0;
        for (std::size_t i = 0; i < dim_; ++i) {
            const double v = x_(dim_ + i, 0);
            s += v * v;
        }
        return std::sqrt(s);
    }
    double position_uncertainty() const {
        double t = 0.0;
        for (std::size_t i = 0; i < dim_; ++i) t += P_(i, i);
        return std::sqrt(t / static_cast<double>(dim_));
    }

private:
    std::size_t dim_ = 0;
    double q_ = 1.0;
    double r_ = 1.0;
    bool initialized_ = false;
    Mat x_;
    Mat P_;
};

}  // namespace pavois
