#include "pavois/transport/http_poster.hpp"

#include <arpa/inet.h>
#include <netdb.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <map>
#include <sstream>

#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

namespace pavois {
namespace {

void close_fd(int fd) {
    if (fd >= 0) ::close(fd);
}

bool camera_id_ok(const std::string& id) {
    if (id.empty() || id.size() > 32) return false;
    for (unsigned char c : id) {
        const bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                         (c >= '0' && c <= '9') || c == '_' || c == '-';
        if (!ok) return false;
    }
    return true;
}

}  // namespace

HttpPoster::~HttpPoster() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stop_ = true;
    }
    cv_.notify_all();
    if (worker_.joinable()) worker_.join();
}

bool HttpPoster::open(std::string host, int port, std::string path) {
    std::lock_guard<std::mutex> lock(mutex_);
    host_ = std::move(host);
    port_ = port;
    path_ = path.empty() ? "/preview" : std::move(path);
    if (host_.empty() || port_ <= 0) {
        last_error_ = "invalid preview host or port";
        valid_ = false;
        return false;
    }
    last_error_.clear();
    valid_ = true;
    if (!worker_.joinable()) {
        stop_ = false;
        worker_ = std::thread([this] { worker_loop(); });
    }
    return true;
}

bool HttpPoster::valid() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return valid_;
}

void HttpPoster::post_jpeg(const std::string& camera_id,
                            std::vector<std::uint8_t> jpeg) {
    if (!camera_id_ok(camera_id) || jpeg.empty()) return;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!valid_) return;
        jobs_[camera_id] = std::move(jpeg);
    }
    cv_.notify_one();
}

void HttpPoster::worker_loop() {
    while (true) {
        std::map<std::string, std::vector<std::uint8_t>> batch;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            cv_.wait(lock, [&] { return stop_ || !jobs_.empty(); });
            if (stop_ && jobs_.empty()) return;
            batch.swap(jobs_);
        }
        for (auto& item : batch) send_once(item.first, item.second);
    }
}

bool HttpPoster::send_once(const std::string& camera_id,
                            const std::vector<std::uint8_t>& jpeg) {
    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* result = nullptr;
    const std::string port_text = std::to_string(port_);
    if (::getaddrinfo(host_.c_str(), port_text.c_str(), &hints, &result) != 0) {
        std::lock_guard<std::mutex> lock(mutex_);
        last_error_ = "preview DNS failed";
        return false;
    }

    int fd = -1;
    for (addrinfo* ai = result; ai != nullptr; ai = ai->ai_next) {
        fd = ::socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd < 0) continue;
        timeval tv{};
        tv.tv_sec = 2;
        tv.tv_usec = 0;
        ::setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
        ::setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
        if (::connect(fd, ai->ai_addr, ai->ai_addrlen) == 0) break;
        close_fd(fd);
        fd = -1;
    }
    ::freeaddrinfo(result);
    if (fd < 0) {
        std::lock_guard<std::mutex> lock(mutex_);
        last_error_ = std::strerror(errno);
        return false;
    }

    std::ostringstream req;
    req << "POST " << path_ << "?cameraId=" << camera_id << " HTTP/1.1\r\n"
        << "Host: " << host_ << ':' << port_ << "\r\n"
        << "Content-Type: image/jpeg\r\n"
        << "Content-Length: " << jpeg.size() << "\r\n"
        << "Connection: close\r\n\r\n";
    const std::string head = req.str();
    bool ok = ::send(fd, head.data(), head.size(), MSG_NOSIGNAL) ==
              static_cast<ssize_t>(head.size());
    if (ok) {
        ok = ::send(fd, jpeg.data(), jpeg.size(), MSG_NOSIGNAL) ==
             static_cast<ssize_t>(jpeg.size());
    }
    char buf[96];
    ::recv(fd, buf, sizeof(buf), 0);
    close_fd(fd);
    if (!ok) {
        std::lock_guard<std::mutex> lock(mutex_);
        last_error_ = "preview send failed";
        return false;
    }
    std::lock_guard<std::mutex> lock(mutex_);
    last_error_.clear();
    return true;
}

std::string HttpPoster::last_error() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return last_error_;
}

}  // namespace pavois
