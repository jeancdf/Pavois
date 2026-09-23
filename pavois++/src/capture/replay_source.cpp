#include "pavois/capture/replay_source.hpp"

#include "pavois/capture/frame_source.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <thread>

namespace pavois {
namespace fs = std::filesystem;

ReplaySource::ReplaySource(std::string dir, bool loop, bool realtime)
    : dir_(std::move(dir)), loop_(loop), realtime_(realtime) {}

bool ReplaySource::open() {
    std::error_code ec;
    if (!fs::is_directory(dir_, ec)) {
        last_error_ = "replay dir not found: " + dir_;
        return false;
    }
    for (const auto& e : fs::directory_iterator(dir_, ec)) {
        if (!e.is_regular_file()) continue;
        const auto ext = e.path().extension().string();
        if (ext == ".pgm" || ext == ".PGM") files_.push_back(e.path().string());
    }
    std::sort(files_.begin(), files_.end());
    if (files_.empty()) {
        last_error_ = "no .pgm frames in " + dir_;
        return false;
    }
    std::ifstream fps_in(dir_ + "/fps.txt");
    if (fps_in) {
        double v = 0.0;
        if (fps_in >> v && v > 0.0) fps_ = v;
    }

    // Recorded capture times, one per frame, in the same order as the sorted
    // files. Only trusted when the count matches, so a stale file can never
    // silently pair a frame with another frame's timestamp.
    timestamps_.clear();
    std::ifstream ts_in(dir_ + "/timestamps.txt");
    if (ts_in) {
        std::uint64_t t = 0;
        while (ts_in >> t) timestamps_.push_back(t);
        if (timestamps_.size() != files_.size()) {
            last_error_ = "timestamps.txt has " + std::to_string(timestamps_.size()) +
                          " entries for " + std::to_string(files_.size()) + " frames in " + dir_;
            return false;
        }
    }

    base_us_ = wall_clock_us();
    index_ = 0;
    frame_count_ = 0;
    last_error_.clear();
    return true;
}

bool ReplaySource::read_frame(GrayFrame& out) {
    if (files_.empty()) {
        last_error_ = "replay not opened";
        return false;
    }
    if (index_ >= files_.size()) {
        if (!loop_) {
            last_error_ = "end of replay";
            return false;
        }
        index_ = 0;
    }

    const std::size_t file_index = index_++;
    const std::string& path = files_[file_index];
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        last_error_ = "cannot open " + path;
        return false;
    }
    std::string magic;
    int w = 0, h = 0, maxv = 0;
    in >> magic >> w >> h >> maxv;
    if (magic != "P5" || w <= 0 || h <= 0 || maxv <= 0 || maxv > 255) {
        last_error_ = "bad PGM header in " + path;
        return false;
    }
    in.get();  // single whitespace after maxval
    out.width = w;
    out.height = h;
    out.pixels.resize(static_cast<std::size_t>(w) * static_cast<std::size_t>(h));
    in.read(reinterpret_cast<char*>(out.pixels.data()),
            static_cast<std::streamsize>(out.pixels.size()));
    if (in.gcount() != static_cast<std::streamsize>(out.pixels.size())) {
        last_error_ = "short PGM body in " + path;
        return false;
    }

    const std::uint64_t dt_us = static_cast<std::uint64_t>(1e6 / fps_);
    out.frame_id = frame_count_;
    if (!timestamps_.empty()) {
        // Replay the recorded clock. Every loop pass is shifted by one full
        // span so timestamps stay monotonic across repeats.
        const std::uint64_t span =
            timestamps_.back() - timestamps_.front() + dt_us;
        const std::uint64_t laps = frame_count_ / files_.size();
        out.captured_us = timestamps_[file_index] + laps * span;
    } else {
        out.captured_us = base_us_ + frame_count_ * dt_us;
    }
    ++frame_count_;

    if (realtime_) {
        // Pace against elapsed wall time since open(), using the recorded
        // spacing when we have it so a variable-rate recording replays at its
        // true speed rather than a nominal constant fps.
        const std::uint64_t offset =
            timestamps_.empty()
                ? frame_count_ * dt_us
                : out.captured_us - timestamps_.front() + dt_us;
        const std::uint64_t target = base_us_ + offset;
        const std::uint64_t now = wall_clock_us();
        if (target > now) {
            std::this_thread::sleep_for(std::chrono::microseconds(target - now));
        }
    }
    last_error_.clear();
    return true;
}

const std::string& ReplaySource::last_error() const { return last_error_; }

bool write_pgm(const std::string& path, const std::uint8_t* pixels, int width, int height) {
    std::ofstream out(path, std::ios::binary);
    if (!out) return false;
    out << "P5\n" << width << ' ' << height << "\n255\n";
    out.write(reinterpret_cast<const char*>(pixels),
              static_cast<std::streamsize>(width) * height);
    return static_cast<bool>(out);
}

}  // namespace pavois
