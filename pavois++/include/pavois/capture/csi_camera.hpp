#pragma once

#include "pavois/capture/frame_source.hpp"

#include <cstdio>
#include <sys/types.h>

namespace pavois {

// Local CSI capture through rpicam-vid and FFmpeg, without a network stream.
class CsiCamera final : public FrameSource {
public:
    explicit CsiCamera(const CameraConfig& config);
    ~CsiCamera() override;
    bool open() override;
    bool read_frame(GrayFrame& out) override;
    const std::string& last_error() const override { return last_error_; }

private:
    CameraConfig config_;
    FILE* pipe_ = nullptr;
    pid_t process_group_ = -1;
    std::string last_error_;
};

}  // namespace pavois
