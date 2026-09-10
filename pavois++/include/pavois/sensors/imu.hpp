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
};

double wrap_heading_deg(double deg);
ImuSample apply_imu_offsets(const ImuSample& raw, const AppConfig& cfg);
bool bno055_euler_from_bytes(const std::uint8_t bytes[6], ImuSample& out);

class ImuReader {
public:
    virtual ~ImuReader() = default;
    virtual bool read(ImuSample& sample) = 0;
    virtual const std::string& last_error() const = 0;
};

// Returns null when IMU is disabled or the source cannot be opened.
std::unique_ptr<ImuReader> open_imu(const AppConfig& cfg);

}  // namespace pavois
