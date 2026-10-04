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

    // True when the source finished cleanly rather than failed: a finite replay
    // that reached its last frame. A live camera never ends, so the default is
    // false. Lets a bounded replay run terminate instead of falling through to
    // the attitude-only loop, which never returns when frames=-1.
    virtual bool at_end() const { return false; }
    // The exposure the camera used for its latest frame, when it reports one:
    // shutter time in microseconds and analogue gain as a plain factor.
    // Automatic exposure moves both with the light. False when unknown.
    virtual bool exposure(double& shutter_us, double& analogue_gain) const {
        (void)shutter_us;
        (void)analogue_gain;
        return false;
    }
};

// Picks a concrete source from the camera config:
//   device starting with csi:N -> local rpicam-vid + FFmpeg
//   device starting with rtsp:// http:// https://  -> network (ffmpeg)
//   device starting with replay:PATH  or a directory -> ReplaySource
//   otherwise                                         -> V4L2Camera
std::unique_ptr<FrameSource> make_frame_source(const CameraConfig& cfg);

std::uint64_t wall_clock_us();

}  // namespace pavois
