#include "pavois/capture/csi_camera.hpp"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <sstream>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

extern char** environ;

namespace pavois {

CsiCamera::CsiCamera(const CameraConfig& config) : config_(config) {}

CsiCamera::~CsiCamera() {
    // Stop both local producers before closing their output pipe.
    if (process_group_ > 0) ::kill(-process_group_, SIGTERM);
    if (pipe_ != nullptr) std::fclose(pipe_);
    close_metadata();
    if (process_group_ > 0) {
        while (::waitpid(process_group_, nullptr, 0) < 0 && errno == EINTR) {}
    }
}

void CsiCamera::close_metadata() {
    if (metadata_fd_ >= 0) {
        ::close(metadata_fd_);
        metadata_fd_ = -1;
    }
    if (!metadata_path_.empty()) {
        ::unlink(metadata_path_.c_str());
        metadata_path_.clear();
    }
    metadata_buffer_.clear();
    metadata_timestamps_.clear();
}

void CsiCamera::drain_metadata() {
    if (metadata_fd_ < 0) return;
    char chunk[4096];
    for (;;) {
        const ssize_t count = ::read(metadata_fd_, chunk, sizeof(chunk));
        if (count > 0) {
            metadata_buffer_.append(chunk, static_cast<std::size_t>(count));
            continue;
        }
        if (count < 0 && errno == EINTR) continue;
        break;
    }

    // rpicam writes one text block per encoded frame. FrameWallClock is the
    // libcamera timestamp for the first exposed sensor row, expressed in Unix
    // nanoseconds; order is identical to the MJPEG stream.
    std::size_t newline = 0;
    while ((newline = metadata_buffer_.find('\n')) != std::string::npos) {
        std::string line = metadata_buffer_.substr(0, newline);
        metadata_buffer_.erase(0, newline + 1);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        constexpr char prefix[] = "FrameWallClock=";
        if (line.rfind(prefix, 0) != 0) continue;
        try {
            const auto timestamp_ns = std::stoull(line.substr(sizeof(prefix) - 1));
            if (timestamp_ns > 0) metadata_timestamps_.push_back(timestamp_ns / 1000ULL);
        } catch (...) {
            // Ignore a malformed metadata line. The bounded wait below will
            // fail the frame instead of silently assigning a late timestamp.
        }
    }
}

bool CsiCamera::next_sensor_timestamp(std::uint64_t& timestamp_us) {
    using clock = std::chrono::steady_clock;
    const auto deadline = clock::now() + std::chrono::milliseconds(250);
    while (metadata_timestamps_.empty()) {
        drain_metadata();
        if (!metadata_timestamps_.empty()) break;
        const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(
            deadline - clock::now());
        if (left.count() <= 0) return false;
        pollfd pfd{};
        pfd.fd = metadata_fd_;
        pfd.events = POLLIN;
        const int rc = ::poll(&pfd, 1, static_cast<int>(left.count()));
        if (rc < 0 && errno == EINTR) continue;
        if (rc <= 0 || (pfd.revents & (POLLERR | POLLNVAL))) return false;
    }
    timestamp_us = metadata_timestamps_.front();
    metadata_timestamps_.pop_front();
    return true;
}

bool CsiCamera::open() {
    if (pipe_ != nullptr) return true;
    const std::string index = config_.device.substr(4);  // csi:N
    if (index.empty() || index.size() > 3 ||
        !std::all_of(index.begin(), index.end(), [](char c) { return c >= '0' && c <= '9'; }) ||
        config_.width <= 0 || config_.height <= 0 || config_.fps <= 0) {
        last_error_ = "CSI capture requires csi:N and positive width, height and fps";
        return false;
    }

    // A FIFO carries per-frame libcamera metadata alongside the MJPEG stream.
    // Unlike save-pts this works on Pi 5, and FrameWallClock gives a common
    // NTP-disciplined Unix clock rather than a timestamp taken after decoding.
    char metadata_template[] = "/tmp/pavois-camera-meta.XXXXXX";
    const int temp_fd = ::mkstemp(metadata_template);
    if (temp_fd < 0) {
        last_error_ = "CSI metadata temp file: " + std::string(std::strerror(errno));
        return false;
    }
    ::close(temp_fd);
    ::unlink(metadata_template);
    if (::mkfifo(metadata_template, 0600) < 0) {
        last_error_ = "CSI metadata fifo: " + std::string(std::strerror(errno));
        return false;
    }
    metadata_path_ = metadata_template;
    metadata_fd_ = ::open(metadata_path_.c_str(), O_RDONLY | O_NONBLOCK);
    if (metadata_fd_ < 0) {
        last_error_ = "CSI metadata open: " + std::string(std::strerror(errno));
        close_metadata();
        return false;
    }

    // MJPEG carries dimensions and avoids assuming libcamera's raw buffer stride.
    // Both processes run locally; FFmpeg produces tightly packed grayscale frames.
    std::ostringstream cmd;
    cmd << "rpicam-vid --camera " << index
        << " --timeout 0 --nopreview --codec mjpeg --quality 80"
        << " --width " << config_.width << " --height " << config_.height
        << " --framerate " << config_.fps
        << " --metadata " << metadata_path_ << " --metadata-format txt"
        << " --output -"
        << " | ffmpeg -nostdin -loglevel error -threads 1 -f mjpeg -i pipe:0"
        << " -an -sn -vf scale=" << config_.width << ':' << config_.height << ",format=gray"
        << " -threads 1 -f rawvideo -pix_fmt gray pipe:1";
    int fds[2];
    if (::pipe2(fds, O_CLOEXEC) < 0) {
        last_error_ = "CSI pipe: " + std::string(std::strerror(errno));
        close_metadata();
        return false;
    }
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, fds[1], STDOUT_FILENO);
    posix_spawn_file_actions_addclose(&actions, fds[0]);
    posix_spawn_file_actions_addclose(&actions, fds[1]);
    posix_spawnattr_t attr;
    posix_spawnattr_init(&attr);
    posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETPGROUP);
    posix_spawnattr_setpgroup(&attr, 0);
    std::string command = cmd.str();
    char shell[] = "/bin/sh", option[] = "-c";
    char* argv[] = {shell, option, command.data(), nullptr};
    const int rc = ::posix_spawn(&process_group_, shell, &actions, &attr, argv, environ);
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attr);
    ::close(fds[1]);
    if (rc != 0) {
        ::close(fds[0]);
        process_group_ = -1;
        last_error_ = "CSI process: " + std::string(std::strerror(rc));
        close_metadata();
        return false;
    }
    pipe_ = ::fdopen(fds[0], "r");
    if (pipe_ == nullptr) {
        last_error_ = "CSI fdopen: " + std::string(std::strerror(errno));
        ::close(fds[0]);
        if (process_group_ > 0) ::kill(-process_group_, SIGTERM);
        close_metadata();
        return false;
    }
    last_error_.clear();
    return true;
}

bool CsiCamera::read_frame(GrayFrame& out) {
    if (pipe_ == nullptr) {
        last_error_ = "CSI camera not open";
        return false;
    }
    out.width = config_.width;
    out.height = config_.height;
    out.pixels.resize(static_cast<std::size_t>(out.width) * out.height);
    std::size_t offset = 0;
    while (offset < out.pixels.size()) {
        const std::size_t n = std::fread(out.pixels.data() + offset, 1,
                                       out.pixels.size() - offset, pipe_);
        if (n == 0) {
            last_error_ = "CSI stream ended; check rpicam-vid/ffmpeg logs and camera availability";
            return false;
        }
        offset += n;
    }
    if (!next_sensor_timestamp(out.captured_us)) {
        last_error_ = "CSI sensor timestamp missing; refusing a decode-time timestamp";
        return false;
    }
    last_error_.clear();
    return true;
}

}  // namespace pavois
