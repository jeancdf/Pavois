#pragma once

#include "pavois/domain/track_update.hpp"

#include <ostream>
#include <string>

namespace pavois {

std::string to_csv(const TrackUpdate& update);
void emit_track_update(std::ostream& out, const TrackUpdate& update);

}  // namespace pavois
