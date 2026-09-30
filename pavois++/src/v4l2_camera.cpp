#include "pavois/capture/camera.hpp"
#include "pavois/capture/frame_source.hpp"

#include <fcntl.h>
#include <linux/videodev2.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/select.h>
#include <unistd.h>

#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <sstream>
#include <thread>
#include <utility>

namespace pavois {

namespace {

// Kernel capture time (CLOCK_MONOTONIC) mapped onto the wall clock, so the
// VPS aligns frames on when they were exposed rather than when this thread
// got around to dequeuing them. Falls back to "now" when the driver gives
// no usable monotonic timestamp.
std::uint64_t buffer_capture_wall_us(const v4l2_buffer& buf) {
    const std::uint64_t wall = wall_clock_us();
    if ((buf.flags & V4L2_BUF_FLAG_TIMESTAMP_MASK) != V4L2_BUF_FLAG_TIMESTAMP_MONOTONIC) {
        return wall;
    }
    const std::uint64_t captured =
        static_cast<std::uint64_t>(buf.timestamp.tv_sec) * 1000000ULL +
        static_cast<std::uint64_t>(buf.timestamp.tv_usec);
    timespec now{};
    if (captured == 0 || clock_gettime(CLOCK_MONOTONIC, &now) != 0) return wall;
    const std::uint64_t mono = static_cast<std::uint64_t>(now.tv_sec) * 1000000ULL +
                               static_cast<std::uint64_t>(now.tv_nsec) / 1000ULL;
    // A stale or future stamp means a clock we do not understand.
    if (captured > mono || mono - captured > 1000000ULL) return wall;
    return wall - (mono - captured);
}

}  // namespace

V4L2Camera::V4L2Camera(std::string device, int requested_width, int requested_height)
    : device_(std::move(device)),
      requested_width_(requested_width),
      requested_height_(requested_height) {}

V4L2Camera::~V4L2Camera() {
    stop_streaming();
    close_device();
}

bool V4L2Camera::open() {
    if (is_network_source(device_)) {
        network_mode_ = true;
        width_ = requested_width_;
        height_ = requested_height_;
        return open_network_stream();
    }

    network_mode_ = false;
    fd_ = ::open(device_.c_str(), O_RDWR | O_NONBLOCK, 0);
    if (fd_ < 0) {
        last_error_ = "open(" + device_ + "): " + std::strerror(errno);
        return false;
    }

    if (!configure_device()) {
        close_device();
        return false;
    }
    if (!init_mmap()) {
        close_device();
        return false;
    }
    if (!start_streaming()) {
        close_device();
        return false;
    }
    return true;
}

bool V4L2Camera::is_network_source(const std::string& source) {
    return source.rfind("rtsp://", 0) == 0 ||
           source.rfind("http://", 0) == 0 ||
           source.rfind("https://", 0) == 0;
}

std::string V4L2Camera::shell_escape_single_quotes(const std::string& value) {
    std::string escaped;
    escaped.reserve(value.size() + 16);
    escaped.push_back('\'');
    for (char c : value) {
        if (c == '\'') {
            escaped += "'\\''";
        } else {
            escaped.push_back(c);
        }
    }
    escaped.push_back('\'');
    return escaped;
}

bool V4L2Camera::open_network_stream() {
    const std::string url = shell_escape_single_quotes(device_);
    const bool is_rtsp = device_.rfind("rtsp://", 0) == 0;
    std::ostringstream cmd;
    cmd << "ffmpeg -nostdin -loglevel error"
        << " -fflags nobuffer -flags low_delay -probesize 32 -analyzeduration 0";
    if (is_rtsp) cmd << " -rtsp_transport tcp";
    cmd << " -i " << url
        << " -an -sn"
        << " -vf scale=" << requested_width_ << ':' << requested_height_ << ",format=gray"
        << " -f rawvideo -pix_fmt gray pipe:1";

    pipe_ = ::popen(cmd.str().c_str(), "r");
    if (pipe_ == nullptr) {
        last_error_ = "popen(ffmpeg): " + std::string(std::strerror(errno));
        return false;
    }

    last_error_.clear();
    return true;
}

int V4L2Camera::xioctl(unsigned long request, void* arg) {
    int r;
    do {
        r = ioctl(fd_, request, arg);
    } while (r == -1 && errno == EINTR);
    return r;
}

bool V4L2Camera::configure_device() {
    v4l2_capability cap{};
    if (xioctl(VIDIOC_QUERYCAP, &cap) < 0) {
        last_error_ = "VIDIOC_QUERYCAP: " + std::string(std::strerror(errno));
        return false;
    }

    if (!(cap.capabilities & V4L2_CAP_VIDEO_CAPTURE) ||
        !(cap.capabilities & V4L2_CAP_STREAMING)) {
        last_error_ = "device does not support capture + streaming";
        return false;
    }

    v4l2_format fmt{};
    fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    fmt.fmt.pix.width = static_cast<__u32>(requested_width_);
    fmt.fmt.pix.height = static_cast<__u32>(requested_height_);
    fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_YUYV;
    fmt.fmt.pix.field = V4L2_FIELD_ANY;

    if (xioctl(VIDIOC_S_FMT, &fmt) < 0) {
        last_error_ = "VIDIOC_S_FMT: " + std::string(std::strerror(errno));
        return false;
    }

    if (fmt.fmt.pix.pixelformat != V4L2_PIX_FMT_YUYV) {
        last_error_ = "camera refused YUYV format";
        return false;
    }

    width_ = static_cast<int>(fmt.fmt.pix.width);
    height_ = static_cast<int>(fmt.fmt.pix.height);
    return true;
}

bool V4L2Camera::init_mmap() {
    v4l2_requestbuffers req{};
    req.count = 4;
    req.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    req.memory = V4L2_MEMORY_MMAP;

    if (xioctl(VIDIOC_REQBUFS, &req) < 0) {
        last_error_ = "VIDIOC_REQBUFS: " + std::string(std::strerror(errno));
        return false;
    }
    if (req.count < 2) {
        last_error_ = "not enough V4L2 buffers";
        return false;
    }

    buffers_.resize(req.count);
    for (std::size_t i = 0; i < buffers_.size(); ++i) {
        v4l2_buffer buf{};
        buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        buf.memory = V4L2_MEMORY_MMAP;
        buf.index = static_cast<__u32>(i);

        if (xioctl(VIDIOC_QUERYBUF, &buf) < 0) {
            last_error_ = "VIDIOC_QUERYBUF: " + std::string(std::strerror(errno));
            return false;
        }

        buffers_[i].length = buf.length;
        buffers_[i].start = mmap(nullptr, buf.length, PROT_READ | PROT_WRITE, MAP_SHARED, fd_, buf.m.offset);
        if (buffers_[i].start == MAP_FAILED) {
            last_error_ = "mmap: " + std::string(std::strerror(errno));
            return false;
        }
    }

    for (std::size_t i = 0; i < buffers_.size(); ++i) {
        v4l2_buffer buf{};
        buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        buf.memory = V4L2_MEMORY_MMAP;
        buf.index = static_cast<__u32>(i);

        if (xioctl(VIDIOC_QBUF, &buf) < 0) {
            last_error_ = "VIDIOC_QBUF: " + std::string(std::strerror(errno));
            return false;
        }
    }

    return true;
}

bool V4L2Camera::start_streaming() {
    v4l2_buf_type type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (xioctl(VIDIOC_STREAMON, &type) < 0) {
        last_error_ = "VIDIOC_STREAMON: " + std::string(std::strerror(errno));
        return false;
    }
    streaming_ = true;
    return true;
}

void V4L2Camera::stop_streaming() {
    if (network_mode_) {
        return;
    }
    if (fd_ < 0 || !streaming_) {
        return;
    }
    v4l2_buf_type type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    xioctl(VIDIOC_STREAMOFF, &type);
    streaming_ = false;
}

void V4L2Camera::close_device() {
    if (pipe_ != nullptr) {
        ::pclose(pipe_);
        pipe_ = nullptr;
    }

    for (auto& buffer : buffers_) {
        if (buffer.start && buffer.start != MAP_FAILED) {
            munmap(buffer.start, buffer.length);
        }
        buffer.start = nullptr;
        buffer.length = 0;
    }
    buffers_.clear();

    if (fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
    }
}

bool V4L2Camera::read_one_network_frame(GrayFrame& out) {
    out.width = width_;
    out.height = height_;
    out.pixels.resize(static_cast<std::size_t>(width_) * static_cast<std::size_t>(height_));
    std::size_t offset = 0;
    while (offset < out.pixels.size()) {
        const std::size_t n =
            std::fread(out.pixels.data() + offset, 1, out.pixels.size() - offset, pipe_);
        if (n == 0) {
            last_error_ = "ffmpeg stream ended";
            return false;
        }
        offset += n;
    }
    return true;
}

bool V4L2Camera::reconnect_network_stream() {
    if (pipe_ != nullptr) {
        ::pclose(pipe_);
        pipe_ = nullptr;
    }
    int attempt = 0;
    while (reconnect_max_attempts_ <= 0 || attempt < reconnect_max_attempts_) {
        ++attempt;
        std::this_thread::sleep_for(std::chrono::milliseconds(std::max(0, reconnect_backoff_ms_)));
        if (open_network_stream()) {
            last_error_.clear();
            return true;
        }
    }
    last_error_ = "network reconnect gave up after " + std::to_string(attempt) + " attempts";
    return false;
}

bool V4L2Camera::read_network_frame(GrayFrame& out) {
    if (pipe_ == nullptr && !reconnect_network_stream()) {
        return false;
    }

    if (!read_one_network_frame(out)) {
        if (!reconnect_network_stream() || !read_one_network_frame(out)) {
            return false;
        }
    }

    // Drop already-buffered whole frames so we always process the freshest one.
    const int fd = ::fileno(pipe_);
    const std::size_t frame_bytes = out.pixels.size();
    for (int guard = 0; guard < 8 && fd >= 0 && frame_bytes > 0; ++guard) {
        int available = 0;
        if (ioctl(fd, FIONREAD, &available) < 0) break;
        if (static_cast<std::size_t>(available) < frame_bytes) break;
        GrayFrame skip;
        if (!read_one_network_frame(skip)) break;
        out.pixels.swap(skip.pixels);
    }

    out.captured_us = wall_clock_us();
    last_error_.clear();
    return true;
}

bool V4L2Camera::dequeue_frame(GrayFrame& out) {
    fd_set fds;
    FD_ZERO(&fds);
    FD_SET(fd_, &fds);

    timeval tv{};
    tv.tv_sec = 2;
    tv.tv_usec = 0;

    int ready = select(fd_ + 1, &fds, nullptr, nullptr, &tv);
    if (ready == 0) {
        last_error_ = "camera read timed out";
        return false;
    }
    if (ready < 0) {
        last_error_ = "select: " + std::string(std::strerror(errno));
        return false;
    }

    v4l2_buffer buf{};
    buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    buf.memory = V4L2_MEMORY_MMAP;
    if (xioctl(VIDIOC_DQBUF, &buf) < 0) {
        last_error_ = "VIDIOC_DQBUF: " + std::string(std::strerror(errno));
        return false;
    }

    if (buf.index >= buffers_.size()) {
        last_error_ = "bad buffer index";
        return false;
    }

    const auto* data = static_cast<const std::uint8_t*>(buffers_[buf.index].start);
    out.width = width_;
    out.height = height_;
    out.captured_us = buffer_capture_wall_us(buf);
    out.pixels.resize(static_cast<std::size_t>(width_) * static_cast<std::size_t>(height_));
    yuyv_to_gray(data, out.pixels.data(), width_, height_);

    if (xioctl(VIDIOC_QBUF, &buf) < 0) {
        last_error_ = "VIDIOC_QBUF: " + std::string(std::strerror(errno));
        return false;
    }

    last_error_.clear();
    return true;
}

bool V4L2Camera::read_frame(GrayFrame& out) {
    if (network_mode_) {
        return read_network_frame(out);
    }
    if (fd_ < 0) {
        last_error_ = "camera not open";
        return false;
    }
    return dequeue_frame(out);
}

int V4L2Camera::width() const {
    return width_;
}

int V4L2Camera::height() const {
    return height_;
}

const std::string& V4L2Camera::last_error() const {
    return last_error_;
}

void V4L2Camera::yuyv_to_gray(const std::uint8_t* src, std::uint8_t* dst, int width, int height) {
    const std::size_t row_bytes = static_cast<std::size_t>(width) * 2;
    for (int y = 0; y < height; ++y) {
        const std::uint8_t* row = src + static_cast<std::size_t>(y) * row_bytes;
        for (int x = 0; x < width; x += 2) {
            const std::size_t src_i = static_cast<std::size_t>(x) * 2;
            const std::size_t dst_i = static_cast<std::size_t>(y) * static_cast<std::size_t>(width) +
                                      static_cast<std::size_t>(x);
            dst[dst_i] = row[src_i];
            if (x + 1 < width) {
                dst[dst_i + 1] = row[src_i + 2];
            }
        }
    }
}

}  // namespace pavois
