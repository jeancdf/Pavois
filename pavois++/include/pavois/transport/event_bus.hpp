#pragma once

#include "pavois/domain/detection_event.hpp"

#include <ostream>
#include <string>

namespace pavois {

std::string to_json(const DetectionEvent& event);
void emit_event(std::ostream& out, const DetectionEvent& event);

}  // namespace pavois
