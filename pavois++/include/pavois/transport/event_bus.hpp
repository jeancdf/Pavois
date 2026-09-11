#pragma once

#include "pavois/domain/track_update.hpp"

#include <ostream>
#include <string>

namespace pavois {

std::string to_csv(const TrackUpdate& update);
std::string to_gps_csv(const TrackUpdate& update, double ref_lat,
                       double ref_lon, double ref_alt);
void emit_track_update(std::ostream& out, const TrackUpdate& update);

}  // namespace pavois
