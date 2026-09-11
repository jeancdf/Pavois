#pragma once

#include "pavois/config/app_config.hpp"

#include <cstdint>
#include <memory>
#include <string>

namespace pavois {

struct ImuSample {
    double heading_deg = 0.0;
    double elevation_deg = 0.0;
    double roll_deg = 0.0;
    bool valid = false;
    // BNO055 CALIB_STAT levels 0..3, -1 when unknown.
    int calib_sys = -1;
    int calib_gyro = -1;
    int calib_accel = -1;
    int calib_mag = -1;
};

double wrap_heading_deg(double deg);
ImuSample apply_imu_offsets(const ImuSample& raw, const AppConfig& cfg);
bool bno055_euler_from_bytes(const std::uint8_t bytes[6], ImuSample& out);
void bno055_calib_from_byte(std::uint8_t stat, ImuSample& out);
// "SGAM" levels (sys, gyro, accel, mag) for the att frame: '-' marks an
// unknown level, and the whole token is "-" when every level is unknown.
std::string format_calib_token(const ImuSample& sample);

// Decoded BNO055 CALIB_STAT (0x35): each field is 0 (uncalibrated) to 3 (fully calibrated).
struct ImuCalibStatus {
    int sys = 0;
    int gyro = 0;
    int accel = 0;
    int mag = 0;

    bool operator==(const ImuCalibStatus& other) const {
        return sys == other.sys && gyro == other.gyro &&
               accel == other.accel && mag == other.mag;
    }
    bool operator!=(const ImuCalibStatus& other) const { return !(*this == other); }
};

ImuCalibStatus bno055_calib_from_byte(std::uint8_t byte);

class ImuReader {
public:
    virtual ~ImuReader() = default;
    virtual bool read(ImuSample& sample) = 0;
    virtual const std::string& last_error() const = 0;
};

// Returns null when IMU is disabled or the source cannot be opened.
std::unique_ptr<ImuReader> open_imu(const AppConfig& cfg);

}  // namespace pavois
