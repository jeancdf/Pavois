#include "pavois/capture/csi_camera.hpp"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <iostream>
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
namespace {

// A number as a stream prints it ("4", "0.5"), which is what rpicam-vid has
// always been given; std::to_string would write "4.000000".
template <typename T>
std::string text(const T& value) {
    std::ostringstream out;
    out << value;
    return out.str();
}

}  // namespace

int yuv420_stride(const CameraConfig& config, std::string& reason) {
    reason.clear();
    if (config.width % 2 != 0 || config.height % 2 != 0) {
        reason = "yuv420 needs an even width and height";
        return 0;
    }
    if (config.capture_stride > 0) {
        if (config.capture_stride < config.width || config.capture_stride % 2 != 0) {
            reason = "capture_stride must be even and at least the frame width";
            return 0;
        }
        return config.capture_stride;
    }
    if (config.width % 128 != 0) {
        reason = "width " + std::to_string(config.width) +
                 " is not a multiple of 128, set capture_stride to the padded row length";
        return 0;
    }
    return config.width;
}

CsiCamera::CsiCamera(const CameraConfig& config) : config_(config) {}

CsiCamera::~CsiCamera() {
    stop();
}

void CsiCamera::notice(const std::string& text) const {
    // One write, so lines from several camera threads do not interleave.
    std::cerr << "camera " + config_.id + " " + text + "\n";
}

void CsiCamera::stop() {
    // Stop the local producers before closing their output pipe.
    if (process_group_ > 0) ::kill(-process_group_, SIGTERM);
    if (pipe_ != nullptr) {
        std::fclose(pipe_);
        pipe_ = nullptr;
    }
    close_metadata();
    if (process_group_ > 0) {
        while (::waitpid(process_group_, nullptr, 0) < 0 && errno == EINTR) {}
        process_group_ = -1;
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

    // rpicam writes one text block per output frame. FrameWallClock is the
    // libcamera timestamp for the first exposed sensor row, expressed in Unix
    // nanoseconds; order is identical to the frame stream.
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

    format_ = Format::Mjpeg;
    if (config_.capture_format == "yuv420") {
        std::string reason;
        const int stride = yuv420_stride(config_, reason);
        if (stride > 0) {
            format_ = Format::Yuv420;
            stride_ = static_cast<std::size_t>(stride);
        } else {
            notice("yuv420 capture refused, using mjpeg: " + reason);
        }
    }
    if (!start()) return false;

    const std::string size =
        std::to_string(config_.width) + "x" + std::to_string(config_.height);
    notice(format_ == Format::Yuv420
               ? "capture yuv420 " + size + ", stride " + std::to_string(stride_)
               : "capture mjpeg " + size);
    return true;
}

bool CsiCamera::start() {
    // A FIFO carries per-frame libcamera metadata alongside the frame stream.
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

    int fds[2];
    if (::pipe2(fds, O_CLOEXEC) < 0) {
        last_error_ = "CSI pipe: " + std::string(std::strerror(errno));
        close_metadata();
        return false;
    }
#ifdef F_SETPIPE_SZ
    if (format_ == Format::Yuv420) {
        // rpicam-vid gives an uncompressed buffer back to the camera before
        // writing it out, so whatever is not in the pipe yet can be
        // overwritten by a later frame. A pipe that takes the whole luminance
        // plane at once keeps that plane intact, and lets rpicam-vid hand a
        // frame over while the detector is still busy with the previous one.
        // Best effort: an unprivileged process is usually allowed 1 MiB,
        // against 64 KiB by default.
        for (const int size : {4 << 20, 2 << 20, 1 << 20}) {
            if (::fcntl(fds[0], F_SETPIPE_SZ, size) >= 0) break;
        }
        const int capacity = ::fcntl(fds[0], F_GETPIPE_SZ);
        const std::size_t luminance =
            stride_ * static_cast<std::size_t>(config_.height);
        if (capacity >= 0 && static_cast<std::size_t>(capacity) < luminance) {
            notice("pipe holds " + std::to_string(capacity) +
                   " bytes, less than a luminance plane (" +
                   std::to_string(luminance) +
                   "): frames can tear when the detector falls behind the camera");
        }
    }
#endif
    const bool spawned = spawn(fds);
    ::close(fds[1]);
    if (!spawned) {
        ::close(fds[0]);
        close_metadata();
        return false;
    }
    pipe_ = ::fdopen(fds[0], "r");
    if (pipe_ == nullptr) {
        last_error_ = "CSI fdopen: " + std::string(std::strerror(errno));
        ::close(fds[0]);
        stop();
        return false;
    }
    last_error_.clear();
    return true;
}

bool CsiCamera::spawn(const int fds[2]) {
    std::vector<std::string> rpicam = {
        "rpicam-vid", "--camera", config_.device.substr(4),
        "--timeout", "0", "--nopreview",
    };
    if (format_ == Format::Yuv420) {
        // --flush: otherwise the last bytes of a frame wait in rpicam-vid's
        // output buffer until the next frame pushes them out, a frame late.
        rpicam.insert(rpicam.end(), {"--codec", "yuv420", "--flush"});
    } else {
        rpicam.insert(rpicam.end(), {"--codec", "mjpeg", "--quality", "80"});
    }
    if (!config_.sensor_mode.empty()) {
        rpicam.insert(rpicam.end(), {"--mode", config_.sensor_mode});
    }
    rpicam.insert(rpicam.end(), {
        "--width", text(config_.width),
        "--height", text(config_.height),
        "--framerate", text(config_.fps),
        "--exposure", config_.exposure_mode,
        "--shutter", text(config_.shutter_us),
        "--gain", text(config_.analogue_gain),
        "--awb", "custom",
        "--awbgains", text(config_.awb_red_gain) + ',' + text(config_.awb_blue_gain),
        "--metadata", metadata_path_,
        "--metadata-format", "txt",
        "--output", "-",
    });

    std::vector<std::string> arguments;
    if (format_ == Format::Yuv420) {
        // rpicam-vid alone: no JPEG, no decoder, no shell.
        arguments = rpicam;
    } else {
        // MJPEG carries its dimensions; FFmpeg decodes it, on this machine,
        // into tightly packed grayscale frames.
        std::string command;
        for (const auto& argument : rpicam) command += argument + ' ';
        command += "| ffmpeg -nostdin -loglevel error -threads 1 -f mjpeg -i pipe:0"
                   " -an -sn -vf scale=" + text(config_.width) + ':' +
                   text(config_.height) + ",format=gray"
                   " -threads 1 -f rawvideo -pix_fmt gray pipe:1";
        arguments = {"/bin/sh", "-c", command};
    }
    std::vector<char*> argv;
    argv.reserve(arguments.size() + 1);
    for (auto& argument : arguments) argv.push_back(argument.data());
    argv.push_back(nullptr);

    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, fds[1], STDOUT_FILENO);
    posix_spawn_file_actions_addclose(&actions, fds[0]);
    posix_spawn_file_actions_addclose(&actions, fds[1]);
    posix_spawnattr_t attr;
    posix_spawnattr_init(&attr);
    posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETPGROUP);
    posix_spawnattr_setpgroup(&attr, 0);
    const int rc = ::posix_spawnp(&process_group_, argv[0], &actions, &attr,
                                  argv.data(), environ);
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attr);
    if (rc != 0) {
        process_group_ = -1;
        last_error_ = "CSI process: " + std::string(std::strerror(rc));
        return false;
    }
    return true;
}

bool CsiCamera::read_exact(std::uint8_t* data, std::size_t size) {
    std::size_t offset = 0;
    while (offset < size) {
        const std::size_t n = std::fread(data + offset, 1, size - offset, pipe_);
        if (n == 0) return false;
        offset += n;
    }
    return true;
}

bool CsiCamera::read_one(GrayFrame& out) {
    const auto width = static_cast<std::size_t>(config_.width);
    const auto height = static_cast<std::size_t>(config_.height);
    out.width = config_.width;
    out.height = config_.height;
    out.pixels.resize(width * height);

    bool complete = false;
    if (format_ == Format::Mjpeg || stride_ == width) {
        // Tightly packed rows: FFmpeg's grayscale output, or an unpadded
        // luminance plane, land straight in the frame.
        complete = read_exact(out.pixels.data(), out.pixels.size());
    } else {
        // Padded rows: take the whole plane, keep the pixels of each row.
        scratch_.resize(stride_ * height);
        complete = read_exact(scratch_.data(), scratch_.size());
        for (std::size_t y = 0; complete && y < height; ++y) {
            std::memcpy(out.pixels.data() + y * width,
                        scratch_.data() + y * stride_, width);
        }
    }
    if (complete && format_ == Format::Yuv420) {
        // The two chroma planes follow, each a quarter of the luminance. They
        // are read and dropped so the next frame starts on its boundary.
        scratch_.resize(stride_ * height / 2);
        complete = read_exact(scratch_.data(), scratch_.size());
    }
    if (!complete) {
        last_error_ = format_ == Format::Yuv420
                          ? "CSI yuv420 stream ended; check rpicam-vid logs and camera availability"
                          : "CSI stream ended; check rpicam-vid/ffmpeg logs and camera availability";
        return false;
    }
    if (!next_sensor_timestamp(out.captured_us)) {
        last_error_ = "CSI sensor timestamp missing; refusing a decode-time timestamp";
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
    if (read_one(out)) {
        ++frames_read_;
        return true;
    }
    // A yuv420 pipeline that never delivered a frame is most likely not
    // supported by this rpicam-vid or ISP. Detecting matters more than how
    // the frames are carried, so go back to MJPEG, once.
    if (format_ != Format::Yuv420 || frames_read_ > 0) return false;
    notice("yuv420 capture delivered no frame (" + last_error_ +
           "), falling back to mjpeg");
    stop();
    format_ = Format::Mjpeg;
    if (!start() || !read_one(out)) return false;
    ++frames_read_;
    return true;
}

}  // namespace pavois
