#pragma once

#include <cassert>
#include <cmath>
#include <cstddef>
#include <initializer_list>
#include <vector>

namespace pavois {

// Minimal dense row-major matrix for small Kalman filters (<= ~8x8).
// Not fast, but predictable and dependency-free.
class Mat {
public:
    Mat() = default;
    Mat(std::size_t rows, std::size_t cols, double fill = 0.0)
        : rows_(rows), cols_(cols), d_(rows * cols, fill) {}
    Mat(std::size_t rows, std::size_t cols, std::initializer_list<double> vals)
        : rows_(rows), cols_(cols), d_(vals) {
        assert(d_.size() == rows * cols);
    }

    static Mat identity(std::size_t n) {
        Mat m(n, n, 0.0);
        for (std::size_t i = 0; i < n; ++i) m(i, i) = 1.0;
        return m;
    }

    std::size_t rows() const { return rows_; }
    std::size_t cols() const { return cols_; }

    double& operator()(std::size_t r, std::size_t c) { return d_[r * cols_ + c]; }
    double operator()(std::size_t r, std::size_t c) const { return d_[r * cols_ + c]; }

    Mat operator+(const Mat& o) const {
        Mat r(rows_, cols_);
        for (std::size_t i = 0; i < d_.size(); ++i) r.d_[i] = d_[i] + o.d_[i];
        return r;
    }
    Mat operator-(const Mat& o) const {
        Mat r(rows_, cols_);
        for (std::size_t i = 0; i < d_.size(); ++i) r.d_[i] = d_[i] - o.d_[i];
        return r;
    }
    Mat operator*(const Mat& o) const {
        assert(cols_ == o.rows_);
        Mat r(rows_, o.cols_, 0.0);
        for (std::size_t i = 0; i < rows_; ++i)
            for (std::size_t k = 0; k < cols_; ++k) {
                const double a = (*this)(i, k);
                if (a == 0.0) continue;
                for (std::size_t j = 0; j < o.cols_; ++j)
                    r(i, j) += a * o(k, j);
            }
        return r;
    }
    Mat operator*(double s) const {
        Mat r(rows_, cols_);
        for (std::size_t i = 0; i < d_.size(); ++i) r.d_[i] = d_[i] * s;
        return r;
    }

    Mat transpose() const {
        Mat r(cols_, rows_);
        for (std::size_t i = 0; i < rows_; ++i)
            for (std::size_t j = 0; j < cols_; ++j)
                r(j, i) = (*this)(i, j);
        return r;
    }

    // Gauss-Jordan inverse; returns identity-sized zero matrix on singularity.
    Mat inverse() const {
        assert(rows_ == cols_);
        const std::size_t n = rows_;
        Mat a = *this;
        Mat inv = identity(n);
        for (std::size_t col = 0; col < n; ++col) {
            std::size_t piv = col;
            for (std::size_t r = col + 1; r < n; ++r)
                if (std::fabs(a(r, col)) > std::fabs(a(piv, col))) piv = r;
            if (std::fabs(a(piv, col)) < 1e-15) return Mat(n, n, 0.0);
            if (piv != col) {
                for (std::size_t k = 0; k < n; ++k) {
                    std::swap(a(col, k), a(piv, k));
                    std::swap(inv(col, k), inv(piv, k));
                }
            }
            const double d = a(col, col);
            for (std::size_t k = 0; k < n; ++k) {
                a(col, k) /= d;
                inv(col, k) /= d;
            }
            for (std::size_t r = 0; r < n; ++r) {
                if (r == col) continue;
                const double f = a(r, col);
                if (f == 0.0) continue;
                for (std::size_t k = 0; k < n; ++k) {
                    a(r, k) -= f * a(col, k);
                    inv(r, k) -= f * inv(col, k);
                }
            }
        }
        return inv;
    }

private:
    std::size_t rows_ = 0;
    std::size_t cols_ = 0;
    std::vector<double> d_;
};

}  // namespace pavois
