#pragma once

#include "pavois/capture/frame_source.hpp"
#include "pavois/domain/frame.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace pavois {

// Replays a directory of binary PGM (P5) frames as a FrameSource.
// Frame timestamps are synthesised from `fps` (dir/fps.txt overrides, default 30)
// with a real-time pace so multi-camera fusion behaves like a live run.
// Playback loops unless `loop` is false.
class ReplaySource : public FrameSource {
public:
    explicit ReplaySource(std::string dir, bool loop = true, bool realtime = true);

    bool open() override;
    bool read_frame(GrayFrame& out) override;
    const std::string& last_error() const override;

    void set_realtime(bool on) { realtime_ = on; }

private:
    std::string dir_;
    bool loop_ = true;
    bool realtime_ = true;
    double fps_ = 30.0;
    std::vector<std::string> files_;
    std::size_t index_ = 0;
    std::uint64_t base_us_ = 0;
    std::uint64_t frame_count_ = 0;
    std::string last_error_;
};

// Writes a grayscale buffer as a binary PGM (P5). Returns false on I/O error.
bool write_pgm(const std::string& path, const std::uint8_t* pixels, int width, int height);

}  // namespace pavois
