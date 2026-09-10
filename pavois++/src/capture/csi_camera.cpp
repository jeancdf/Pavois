#include "pavois/capture/csi_camera.hpp"

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <sstream>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

extern char** environ;

namespace pavois {

CsiCamera::CsiCamera(const CameraConfig& config) : config_(config) {}

CsiCamera::~CsiCamera() {
    // Stop both local producers before closing their output pipe.
    if (process_group_ > 0) ::kill(-process_group_, SIGTERM);
    if (pipe_ != nullptr) std::fclose(pipe_);
    if (process_group_ > 0) {
        while (::waitpid(process_group_, nullptr, 0) < 0 && errno == EINTR) {}
    }
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

    // MJPEG carries dimensions and avoids assuming libcamera's raw buffer stride.
    // Both processes run locally; FFmpeg produces tightly packed grayscale frames.
    std::ostringstream cmd;
    cmd << "rpicam-vid --camera " << index
        << " --timeout 0 --nopreview --codec mjpeg --quality 80"
        << " --width " << config_.width << " --height " << config_.height
        << " --framerate " << config_.fps
        << " --output -"
        << " | ffmpeg -nostdin -loglevel error -threads 1 -f mjpeg -i pipe:0"
        << " -an -sn -vf scale=" << config_.width << ':' << config_.height << ",format=gray"
        << " -threads 1 -f rawvideo -pix_fmt gray pipe:1";
    int fds[2];
    if (::pipe2(fds, O_CLOEXEC) < 0) {
        last_error_ = "CSI pipe: " + std::string(std::strerror(errno));
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
        return false;
    }
    pipe_ = ::fdopen(fds[0], "r");
    if (pipe_ == nullptr) {
        last_error_ = "CSI fdopen: " + std::string(std::strerror(errno));
        ::close(fds[0]);
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
    out.captured_us = wall_clock_us();
    last_error_.clear();
    return true;
}

}  // namespace pavois
