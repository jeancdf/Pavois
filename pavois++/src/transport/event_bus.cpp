#include "pavois/transport/event_bus.hpp"

#include <cmath>
#include <iomanip>
#include <ostream>
#include <sstream>
#include <string>

namespace pavois {

std::string to_csv(const TrackUpdate& update) {
    std::ostringstream out;
    out << "obj" << update.object_id << ','
        << update.x << ','
        << update.y << ','
        << update.z << ','
        << update.timestamp_us << ','
        << update.classification;
    return out.str();
}

std::string to_gps_csv(const TrackUpdate& u, double ref_lat, double ref_lon,
                       double ref_alt) {
    constexpr double kPi = 3.14159265358979323846;
    constexpr double kEarthRadiusM = 6378137.0;
    const double ref_lat_rad = ref_lat * kPi / 180.0;
    const double lat = ref_lat + (u.y / kEarthRadiusM) * (180.0 / kPi);
    const double lon = ref_lon + (u.x / (kEarthRadiusM * std::cos(ref_lat_rad))) * (180.0 / kPi);
    const double alt = ref_alt + u.z;
    std::ostringstream out;
    out << "obj" << u.object_id << ',' << std::fixed << std::setprecision(7)
        << lat << ',' << lon << ',' << std::setprecision(2) << alt << ','
        << u.timestamp_us << ',' << u.classification;
    return out.str();
}

void emit_track_update(std::ostream& out, const TrackUpdate& update) {
    out << to_csv(update) << '\n';
}

}  // namespace pavois
