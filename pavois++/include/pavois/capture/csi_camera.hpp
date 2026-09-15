#pragma once

#include "pavois/capture/frame_source.hpp"

#include <cstdio>
#include <cstdint>
#include <deque>
#include <sys/types.h>
#include <string>
#include <vector>

namespace pavois {

// Local CSI capture as native YUV420 through rpicam/libcamera. Only the Y
// plane is retained, so there is no JPEG encode/decode or FFmpeg process.
class CsiCamera final : public FrameSource {
public:
    explicit CsiCamera(const CameraConfig& config);
    ~CsiCamera() override;
    bool open() override;
    bool read_frame(GrayFrame& out) override;
    const std::string& last_error() const override { return last_error_; }

private:
    bool next_sensor_timestamp(std::uint64_t& timestamp_us);
    void drain_metadata();
    void close_metadata();

    CameraConfig config_;
    FILE* pipe_ = nullptr;
    pid_t process_group_ = -1;
    int metadata_fd_ = -1;
    std::string metadata_path_;
    std::string metadata_buffer_;
    std::deque<std::uint64_t> metadata_timestamps_;
    std::vector<std::uint8_t> chroma_scratch_;
    std::string last_error_;
};

}  // namespace pavois
