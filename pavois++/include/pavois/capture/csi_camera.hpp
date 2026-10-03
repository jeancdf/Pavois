#pragma once

#include "pavois/capture/frame_source.hpp"

#include <cstddef>
#include <cstdio>
#include <cstdint>
#include <deque>
#include <sys/types.h>
#include <string>
#include <vector>

namespace pavois {

// Bytes per luminance row to expect from rpicam-vid in yuv420, or 0 with the
// reason when this configuration cannot be read uncompressed.
//
// The ISP pads every plane's rows to a multiple of 32 bytes on a Pi 4 and of
// 64 on a Pi 5. Chroma rows being half as long, a luminance row is padded to
// 64 and 128 bytes. A width that is a multiple of 128 is therefore unpadded
// on both; for any other width the real row length has to come from
// capture_stride.
int yuv420_stride(const CameraConfig& config, std::string& reason);

// Local CSI capture through rpicam-vid, without a network stream. Frames come
// either as MJPEG decoded by FFmpeg, or as uncompressed YUV420 whose
// luminance plane is read directly.
class CsiCamera final : public FrameSource {
public:
    explicit CsiCamera(const CameraConfig& config);
    ~CsiCamera() override;
    bool open() override;
    bool read_frame(GrayFrame& out) override;
    const std::string& last_error() const override { return last_error_; }

private:
    enum class Format { Mjpeg, Yuv420 };

    bool start();
    void stop();
    // Starts the producer with its standard output on the pipe fds[1].
    bool spawn(const int fds[2]);
    bool read_one(GrayFrame& out);
    bool read_exact(std::uint8_t* data, std::size_t size);
    void notice(const std::string& text) const;
    bool next_sensor_timestamp(std::uint64_t& timestamp_us);
    void drain_metadata();
    void close_metadata();

    CameraConfig config_;
    Format format_ = Format::Mjpeg;
    // Luminance row length in bytes; only meaningful in yuv420.
    std::size_t stride_ = 0;
    // MJPEG only: FFmpeg starts on a short probe of its input. Cleared when
    // that delivers no frame, to fall back on FFmpeg's default probe.
    bool fast_probe_ = true;
    std::uint64_t frames_read_ = 0;
    FILE* pipe_ = nullptr;
    pid_t process_group_ = -1;
    int metadata_fd_ = -1;
    std::string metadata_path_;
    std::string metadata_buffer_;
    std::deque<std::uint64_t> metadata_timestamps_;
    std::vector<std::uint8_t> scratch_;
    std::string last_error_;
};

}  // namespace pavois
