#include "pavois/transport/http_poster.hpp"

#include "pavois/transport/message_auth.hpp"
#include "pavois/util/jpeg_gray.hpp"

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
                            std::vector<std::uint8_t> jpeg,
                            std::string query) {
    if (!camera_id_ok(camera_id) || jpeg.empty()) return;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!valid_) return;
        Job job;
        job.camera_id = camera_id;
        job.query = std::move(query);
        job.jpeg = std::move(jpeg);
        jobs_[camera_id] = std::move(job);
    }
    cv_.notify_one();
}

bool send_all(int fd, const void* data, std::size_t size) {
    const auto* bytes = static_cast<const std::uint8_t*>(data);
    std::size_t sent = 0;
    while (sent < size) {
        const ssize_t count =
            ::send(fd, bytes + sent, size - sent, MSG_NOSIGNAL);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) return false;
        sent += static_cast<std::size_t>(count);
    }
    return true;
}

void HttpPoster::post_gray(const std::string& camera_id, GrayFrame frame,
                           int jpeg_quality, std::string query) {
    if (!camera_id_ok(camera_id) || frame.empty()) return;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!valid_) return;
        Job job;
        job.camera_id = camera_id;
        job.query = std::move(query);
        job.frame = std::move(frame);
        job.jpeg_quality = jpeg_quality;
        jobs_[camera_id] = std::move(job);
    }
    cv_.notify_one();
}

void HttpPoster::worker_loop() {
    while (true) {
        std::map<std::string, Job> batch;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            cv_.wait(lock, [&] { return stop_ || !jobs_.empty(); });
            if (stop_ && jobs_.empty()) return;
            batch.swap(jobs_);
        }
        for (auto& item : batch) send_once(item.second);
    }
}

bool HttpPoster::send_once(const Job& job) {
    std::vector<std::uint8_t> encoded;
    const std::vector<std::uint8_t>* jpeg = &job.jpeg;
    if (jpeg->empty()) {
        if (!encode_gray_jpeg(job.frame, job.jpeg_quality, encoded)) {
            std::lock_guard<std::mutex> lock(mutex_);
            last_error_ = "JPEG encoding failed";
            return false;
        }
        jpeg = &encoded;
    }
    if (jpeg->size() > 1024 * 1024) {
        std::lock_guard<std::mutex> lock(mutex_);
        last_error_ = "JPEG exceeds 1 MiB";
        return false;
    }
    const std::string secret = signing_secret();
    if (secret.empty()) {
        std::lock_guard<std::mutex> lock(mutex_);
        last_error_ = "UDP_HMAC_SECRET missing or shorter than 32 characters";
        return false;
    }
    std::string query = "cameraId=" + job.camera_id;
    if (!job.query.empty()) query += '&' + job.query;
    const std::string timestamp = std::to_string(unix_time_ms());
    const std::string body(reinterpret_cast<const char*>(jpeg->data()), jpeg->size());
    const std::string signature =
        to_hex(hmac_sha256(secret, timestamp + '\n' + query + '\n' + body));

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
    req << "POST " << path_ << '?' << query << " HTTP/1.1\r\n"
        << "Host: " << host_ << ':' << port_ << "\r\n"
        << "Content-Type: image/jpeg\r\n"
        << "X-Pavois-Timestamp: " << timestamp << "\r\n"
        << "X-Pavois-Signature: " << signature << "\r\n"
        << "Content-Length: " << jpeg->size() << "\r\n"
        << "Connection: close\r\n\r\n";
    const std::string head = req.str();
    bool ok = send_all(fd, head.data(), head.size());
    if (ok) {
        ok = send_all(fd, jpeg->data(), jpeg->size());
    }
    char buf[96];
    const ssize_t received = ok ? ::recv(fd, buf, sizeof(buf), 0) : -1;
    close_fd(fd);
    if (!ok) {
        std::lock_guard<std::mutex> lock(mutex_);
        last_error_ = "preview send failed";
        return false;
    }
    const std::string status = received >= 12 ? std::string(buf + 9, 3) : std::string();
    std::lock_guard<std::mutex> lock(mutex_);
    if (status.empty() || status[0] != '2') {
        last_error_ = "preview rejected by the VPS: HTTP " + (status.empty() ? "?" : status);
        return false;
    }
    last_error_.clear();
    return true;
}

std::string HttpPoster::last_error() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return last_error_;
}

}  // namespace pavois
