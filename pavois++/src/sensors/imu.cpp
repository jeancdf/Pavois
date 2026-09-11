#include "pavois/sensors/imu.hpp"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <sstream>
#include <thread>
#include <vector>

#if defined(__linux__)
#include <fcntl.h>
#include <sys/stat.h>
#include <ctime>
#include <linux/i2c-dev.h>
#include <linux/i2c.h>
#include <sys/ioctl.h>
#include <unistd.h>
#endif

namespace pavois {
namespace {

constexpr std::uint8_t kBnoChipIdReg = 0x00;
constexpr std::uint8_t kBnoChipId = 0xA0;
constexpr std::uint8_t kBnoPageId = 0x07;
constexpr std::uint8_t kBnoOprMode = 0x3D;
constexpr std::uint8_t kBnoConfigMode = 0x00;
constexpr std::uint8_t kBnoNdof = 0x0C;
constexpr std::uint8_t kBnoEulerLsb = 0x1A;
constexpr std::uint8_t kBnoAxisMapConfig = 0x41;
constexpr std::uint8_t kBnoAxisMapSign = 0x42;
constexpr int kBnoAddrA = 0x28;
constexpr int kBnoAddrB = 0x29;

double wrap360(double deg) {
    double x = std::fmod(deg, 360.0);
    if (x < 0.0) x += 360.0;
    return x;
}

#if defined(__linux__)

class I2cBus {
public:
    explicit I2cBus(const std::string& path) {
        fd_ = ::open(path.c_str(), O_RDWR);
        if (fd_ < 0) {
            err_ = std::strerror(errno);
        }
    }

    ~I2cBus() {
        if (fd_ >= 0) ::close(fd_);
    }

    I2cBus(const I2cBus&) = delete;
    I2cBus& operator=(const I2cBus&) = delete;

    bool ok() const { return fd_ >= 0; }
    const std::string& error() const { return err_; }

    bool write_reg(int addr, std::uint8_t reg, std::uint8_t value) {
        std::uint8_t buf[2] = {reg, value};
        return xfer(addr, buf, 2, nullptr, 0);
    }

    bool read_reg(int addr, std::uint8_t reg, std::uint8_t* dst, std::size_t n) {
        return xfer(addr, &reg, 1, dst, n);
    }

private:
    bool xfer(int addr, const std::uint8_t* wr, std::size_t wr_n,
              std::uint8_t* rd, std::size_t rd_n) {
        if (fd_ < 0) return false;
        i2c_msg msgs[2];
        int n = 0;
        if (wr_n > 0) {
            msgs[n].addr = static_cast<std::uint16_t>(addr);
            msgs[n].flags = 0;
            msgs[n].len = static_cast<std::uint16_t>(wr_n);
            msgs[n].buf = const_cast<std::uint8_t*>(wr);
            ++n;
        }
        if (rd_n > 0) {
            msgs[n].addr = static_cast<std::uint16_t>(addr);
            msgs[n].flags = I2C_M_RD;
            msgs[n].len = static_cast<std::uint16_t>(rd_n);
            msgs[n].buf = rd;
            ++n;
        }
        i2c_rdwr_ioctl_data io{};
        io.msgs = msgs;
        io.nmsgs = static_cast<unsigned int>(n);
        if (::ioctl(fd_, I2C_RDWR, &io) < 0) {
            err_ = std::strerror(errno);
            return false;
        }
        return true;
    }

    int fd_ = -1;
    std::string err_;
};

class Bno055Reader final : public ImuReader {
public:
    Bno055Reader(std::string dev, int addr, const AppConfig& cfg)
        : dev_(std::move(dev)), addr_(addr), cfg_(cfg), bus_(dev_) {}

    bool init() {
        if (!bus_.ok()) {
            err_ = "open " + dev_ + ": " + bus_.error();
            return false;
        }
        std::uint8_t id = 0;
        for (int i = 0; i < 12; ++i) {
            if (bus_.read_reg(addr_, kBnoChipIdReg, &id, 1) && id == kBnoChipId) {
                break;
            }
            id = 0;
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
        if (id != kBnoChipId) {
            err_ = "no BNO055 at " + dev_ + " addr 0x" + hex(addr_);
            return false;
        }
        bus_.write_reg(addr_, kBnoPageId, 0);
        bus_.write_reg(addr_, kBnoOprMode, kBnoConfigMode);
        std::this_thread::sleep_for(std::chrono::milliseconds(25));
        // AXIS_MAP_CONFIG/AXIS_MAP_SIGN are only writable in CONFIG mode. Written
        // unconditionally on every init so the mounting-specific remap always takes
        // effect; scalar offsets alone cannot correct a swapped physical axis.
        bus_.write_reg(addr_, kBnoAxisMapConfig, static_cast<std::uint8_t>(cfg_.imu_axis_map));
        bus_.write_reg(addr_, kBnoAxisMapSign, static_cast<std::uint8_t>(cfg_.imu_axis_sign));
        if (!bus_.write_reg(addr_, kBnoOprMode, kBnoNdof)) {
            err_ = "BNO055 mode switch failed: " + bus_.error();
            return false;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(25));
        err_.clear();
        return true;
    }

    bool read(ImuSample& sample) override {
        std::uint8_t bytes[6] = {};
        if (!bus_.read_reg(addr_, kBnoEulerLsb, bytes, 6)) {
            err_ = bus_.error();
            sample.valid = false;
            return false;
        }
        ImuSample raw;
        if (!bno055_euler_from_bytes(bytes, raw)) {
            err_ = "invalid BNO055 euler frame";
            sample.valid = false;
            return false;
        }
        sample = apply_imu_offsets(raw, cfg_);
        err_.clear();
        return sample.valid;
    }

    const std::string& last_error() const override { return err_; }

private:
    static std::string hex(int v) {
        std::ostringstream out;
        out << std::hex << v;
        return out.str();
    }

    std::string dev_;
    int addr_ = 0;
    AppConfig cfg_;
    I2cBus bus_;
    std::string err_;
};

#endif

class FileImuReader final : public ImuReader {
public:
    FileImuReader(std::string path, const AppConfig& cfg)
        : path_(std::move(path)), cfg_(cfg) {}

    bool read(ImuSample& sample) override {
#if defined(__linux__)
        struct stat info{};
        if (::stat(path_.c_str(), &info) != 0 || std::time(nullptr) - info.st_mtime > 2) {
            err_ = "IMU file missing or stale";
            sample.valid = false;
            return false;
        }
#endif
        std::ifstream in(path_);
        if (!in) {
            err_ = "cannot read " + path_;
            sample.valid = false;
            return false;
        }
        ImuSample raw;
        if (!(in >> raw.heading_deg >> raw.elevation_deg >> raw.roll_deg)) {
            err_ = "bad IMU file " + path_;
            sample.valid = false;
            return false;
        }
        raw.valid = true;
        sample = apply_imu_offsets(raw, cfg_);
        err_.clear();
        return sample.valid;
    }

    const std::string& last_error() const override { return err_; }

private:
    std::string path_;
    AppConfig cfg_;
    std::string err_;
};

std::unique_ptr<ImuReader> open_file_imu(const AppConfig& cfg) {
    if (cfg.imu_file.empty()) return nullptr;
    auto reader = std::make_unique<FileImuReader>(cfg.imu_file, cfg);
    // Keep the reader while the bridge starts or reconnects; read() checks freshness.
    return reader;
}

#if defined(__linux__)
std::unique_ptr<ImuReader> open_bno(const AppConfig& cfg, int addr) {
    auto reader = std::make_unique<Bno055Reader>(cfg.imu_i2c_dev, addr, cfg);
    if (!reader->init()) return nullptr;
    return reader;
}
#endif

}  // namespace

double wrap_heading_deg(double deg) { return wrap360(deg); }

ImuSample apply_imu_offsets(const ImuSample& raw, const AppConfig& cfg) {
    ImuSample out = raw;
    if (!raw.valid) return out;
    out.heading_deg = wrap360(raw.heading_deg + cfg.imu_heading_offset_deg);
    const double sign = cfg.imu_elevation_sign < 0.0 ? -1.0 : 1.0;
    out.elevation_deg = std::clamp(
        sign * raw.elevation_deg + cfg.imu_elevation_offset_deg, -90.0, 90.0);
    out.roll_deg = raw.roll_deg + cfg.imu_roll_offset_deg;
    out.valid = true;
    return out;
}

bool bno055_euler_from_bytes(const std::uint8_t bytes[6], ImuSample& out) {
    auto i16 = [](std::uint8_t lsb, std::uint8_t msb) {
        return static_cast<std::int16_t>(
            static_cast<std::uint16_t>(lsb) |
            (static_cast<std::uint16_t>(msb) << 8));
    };
    const double heading = static_cast<double>(i16(bytes[0], bytes[1])) / 16.0;
    const double roll = static_cast<double>(i16(bytes[2], bytes[3])) / 16.0;
    const double pitch = static_cast<double>(i16(bytes[4], bytes[5])) / 16.0;
    if (!std::isfinite(heading) || !std::isfinite(roll) || !std::isfinite(pitch)) {
        out.valid = false;
        return false;
    }
    out.heading_deg = wrap360(heading);
    out.elevation_deg = std::clamp(pitch, -90.0, 90.0);
    out.roll_deg = roll;
    out.valid = true;
    return true;
}

std::unique_ptr<ImuReader> open_imu(const AppConfig& cfg) {
    if (!cfg.imu_enabled) return nullptr;
    const std::string kind = cfg.imu_kind;
    if (kind == "none") return nullptr;
    if (kind == "file" || !cfg.imu_file.empty()) {
        return open_file_imu(cfg);
    }
#if defined(__linux__)
    if (kind == "bno055" || kind == "auto") {
        std::vector<int> addrs;
        if (cfg.imu_i2c_address > 0) {
            addrs.push_back(cfg.imu_i2c_address);
        } else {
            addrs.push_back(kBnoAddrA);
            addrs.push_back(kBnoAddrB);
        }
        for (int addr : addrs) {
            if (auto reader = open_bno(cfg, addr)) return reader;
        }
    }
#endif
    return nullptr;
}

}  // namespace pavois
