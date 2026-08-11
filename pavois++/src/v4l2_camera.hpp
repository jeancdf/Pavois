#pragma once

#include "frame.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace pavois {

class V4L2Camera {
public:
    V4L2Camera(std::string device, int requested_width, int requested_height);
    ~V4L2Camera();

    V4L2Camera(const V4L2Camera&) = delete;
    V4L2Camera& operator=(const V4L2Camera&) = delete;

    bool open();
    bool read_frame(GrayFrame& out);

    int width() const;
    int height() const;
    const std::string& last_error() const;

private:
    struct Buffer {
        void* start = nullptr;
        std::size_t length = 0;
    };

    std::string device_;
    int requested_width_ = 0;
    int requested_height_ = 0;
    int width_ = 0;
    int height_ = 0;
    int fd_ = -1;
    std::string last_error_;
    std::vector<Buffer> buffers_;
    bool streaming_ = false;

    int xioctl(unsigned long request, void* arg);
    bool configure_device();
    bool init_mmap();
    bool start_streaming();
    void stop_streaming();
    void close_device();
    bool dequeue_frame(GrayFrame& out);
    static void yuyv_to_gray(const std::uint8_t* src, std::uint8_t* dst, int width, int height);
};

}  // namespace pavois

