#include "pavois/transport/event_bus.hpp"

#include <iomanip>
#include <ostream>
#include <sstream>
#include <string>

namespace pavois {
namespace {

std::string join_cameras(const std::vector<std::string>& cameras) {
    std::ostringstream out;
    for (std::size_t i = 0; i < cameras.size(); ++i) {
        if (i > 0) {
            out << '|';
        }
        out << cameras[i];
    }
    return out.str();
}

}  // namespace

std::string to_csv(const TrackUpdate& update) {
    std::ostringstream out;
    out << update.object_id << ','
        << update.timestamp_us << ','
        << std::fixed << std::setprecision(3)
        << update.x << ','
        << update.y << ','
        << update.z << ','
        << std::setprecision(4)
        << update.confidence << ','
        << join_cameras(update.cameras);
    return out.str();
}

void emit_track_update(std::ostream& out, const TrackUpdate& update) {
    out << to_csv(update) << '\n';
}

}  // namespace pavois
