#pragma once

#include "pavois/config/app_config.hpp"
#include "pavois/domain/frame.hpp"

#include <memory>
#include <string>

namespace pavois {

// Common interface for anything that produces grayscale frames.
class FrameSource {
public:
    virtual ~FrameSource() = default;
    virtual bool open() = 0;
    virtual bool read_frame(GrayFrame& out) = 0;
    virtual const std::string& last_error() const = 0;
};

// Picks a concrete source from the camera config:
//   device starting with rtsp:// http:// https://  -> network (ffmpeg)
//   device starting with replay:PATH  or a directory -> ReplaySource
//   otherwise                                         -> V4L2Camera
std::unique_ptr<FrameSource> make_frame_source(const CameraConfig& cfg);

std::uint64_t wall_clock_us();

}  // namespace pavois
