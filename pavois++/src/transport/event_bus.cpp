#include "pavois/transport/event_bus.hpp"

#include <iomanip>
#include <ostream>
#include <sstream>
#include <string>

namespace pavois {
namespace {

std::string json_escape(const std::string& input) {
    std::ostringstream out;
    for (char c : input) {
        switch (c) {
            case '\\': out << "\\\\"; break;
            case '"': out << "\\\""; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default: out << c; break;
        }
    }
    return out.str();
}

}  // namespace

std::string to_json(const DetectionEvent& event) {
    std::ostringstream out;
    out << "{";
    out << "\"type\":\"" << json_escape(event.type) << "\",";
    out << "\"frame_id\":" << event.frame_id << ",";
    out << "\"camera_id\":\"" << json_escape(event.camera_id) << "\",";
    out << "\"blob_area\":" << event.blob_area << ",";
    out << "\"centroid\":["
        << std::fixed << std::setprecision(2)
        << event.centroid_x << "," << event.centroid_y << "],";
    out << "\"confidence\":" << std::fixed << std::setprecision(3) << event.confidence;
    out << "}";
    return out.str();
}

void emit_event(std::ostream& out, const DetectionEvent& event) {
    out << to_json(event) << '\n';
}

}  // namespace pavois

