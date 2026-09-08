#include "pavois/transport/event_bus.hpp"

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
        << update.timestamp_us;
    return out.str();
}

void emit_track_update(std::ostream& out, const TrackUpdate& update) {
    out << to_csv(update) << '\n';
}

}  // namespace pavois
