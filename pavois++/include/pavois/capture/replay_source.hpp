#pragma once

#include "pavois/capture/frame_source.hpp"
#include "pavois/domain/frame.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace pavois {

// Replays a directory of binary PGM (P5) frames as a FrameSource.
// If dir/timestamps.txt exists it supplies one capture time in Unix microseconds
// per frame, which is what a recorded multi-camera run needs: the cameras then
// replay on their ORIGINAL shared clock and fusion can time-align them exactly
// as it would live. Without that file, timestamps are synthesised from `fps`
// (dir/fps.txt overrides, default 30) starting at open() time -- which gives
// every camera its own arbitrary epoch and defeats cross-camera alignment.
// Playback is paced in real time and loops unless `loop` is false.
class ReplaySource : public FrameSource {
public:
    explicit ReplaySource(std::string dir, bool loop = true, bool realtime = true);

    bool open() override;
    bool read_frame(GrayFrame& out) override;
    const std::string& last_error() const override;
    bool at_end() const override { return !loop_ && index_ >= files_.size(); }

    void set_realtime(bool on) { realtime_ = on; }

private:
    std::string dir_;
    bool loop_ = true;
    bool realtime_ = true;
    double fps_ = 30.0;
    std::vector<std::string> files_;
    std::vector<std::uint64_t> timestamps_;  // Unix us, one per file, may be empty
    std::size_t index_ = 0;
    std::uint64_t base_us_ = 0;
    std::uint64_t frame_count_ = 0;
    std::string last_error_;
};

// Writes a grayscale buffer as a binary PGM (P5). Returns false on I/O error.
bool write_pgm(const std::string& path, const std::uint8_t* pixels, int width, int height);

}  // namespace pavois
