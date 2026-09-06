#pragma once

#include "pavois/detection/motion_detector.hpp"
#include "pavois/domain/frame.hpp"

#include <cstdint>
#include <string>

namespace pavois {

// Dumps frames / masks / centroid overlays to a directory for visual tuning.
// A no-op when dir is empty.
class DebugSink {
public:
    DebugSink(std::string dir, int every, std::string camera_id);

    bool active() const { return !dir_.empty(); }

    void dump(const GrayFrame& frame, const DetectionResult& det);

private:
    std::string dir_;
    int every_ = 15;
    std::string cam_;
    std::uint64_t counter_ = 0;
    bool ready_ = false;
};

}  // namespace pavois
