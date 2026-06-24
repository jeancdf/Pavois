#include "v4l2_camera.hpp"

#include <fcntl.h>
#include <linux/videodev2.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/select.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <sstream>
#include <utility>

namespace pavois {

V4L2Camera::V4L2Camera(std::string device, int requested_width, int requested_height)
    : device_(std::move(device)),
      requested_width_(requested_width),
      requested_height_(requested_height) {}

V4L2Camera::~V4L2Camera() {
    stop_streaming();
    close_device();
}

bool V4L2Camera::open() {
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
    if (fd_ < 0 || !streaming_) {
        return;
    }
    v4l2_buf_type type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    xioctl(VIDIOC_STREAMOFF, &type);
    streaming_ = false;
}

void V4L2Camera::close_device() {
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
