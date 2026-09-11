#include "pavois/transport/udp_sender.hpp"

#include <arpa/inet.h>
#include <netdb.h>
#include <sys/socket.h>
#include <unistd.h>

#include <openssl/hmac.h>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <cerrno>
#include <cstring>

namespace pavois {
namespace {

void close_fd(int& fd) {
    if (fd >= 0) {
        ::close(fd);
        fd = -1;
    }
}

}  // namespace

UdpSender::UdpSender() = default;

UdpSender::UdpSender(std::string host, int port) {
    open(std::move(host), port);
}

UdpSender::~UdpSender() {
    close_fd(fd_);
}

bool UdpSender::open(std::string host, int port) {
    std::lock_guard<std::mutex> lock(mutex_);
    close_fd(fd_);
    host_ = std::move(host);
    port_ = port;

    if (host_.empty() || port_ <= 0) {
        last_error_ = "invalid host or port";
        return false;
    }

    addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_DGRAM;

    addrinfo* result = nullptr;
    const std::string port_text = std::to_string(port_);
    const int rc = ::getaddrinfo(host_.c_str(), port_text.c_str(), &hints, &result);
    if (rc != 0) {
        last_error_ = gai_strerror(rc);
        return false;
    }

    for (addrinfo* ai = result; ai != nullptr; ai = ai->ai_next) {
        fd_ = ::socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd_ < 0) {
            continue;
        }
        if (::connect(fd_, ai->ai_addr, ai->ai_addrlen) == 0) {
            ::freeaddrinfo(result);
            last_error_.clear();
            return true;
        }
        close_fd(fd_);
    }

    ::freeaddrinfo(result);
    last_error_ = std::strerror(errno);
    return false;
}

bool UdpSender::valid() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return fd_ >= 0;
}

void UdpSender::send_line(const std::string& line) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (fd_ < 0) {
        return;
    }
    std::string payload = line;
    payload.push_back('\n');
    const char* secret = std::getenv("UDP_HMAC_SECRET");
    if (secret && *secret) {
        const auto ms = static_cast<std::uint64_t>(
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count());
        std::string timestamp(8, '\0');
        for (int i = 0; i < 8; ++i)
            timestamp[i] = static_cast<char>((ms >> (56 - 8 * i)) & 0xff);
        const std::string signed_data = timestamp + payload;
        unsigned char digest[EVP_MAX_MD_SIZE];
        unsigned int size = 0;
        if (!HMAC(EVP_sha256(), secret, static_cast<int>(std::strlen(secret)),
                  reinterpret_cast<const unsigned char*>(signed_data.data()),
                  signed_data.size(), digest, &size) || size != 32) {
            last_error_ = "UDP HMAC signing failed";
            return;
        }
        payload = timestamp + std::string(reinterpret_cast<char*>(digest), size) + payload;
    }
    const ssize_t rc = ::send(fd_, payload.data(), payload.size(), 0);
    if (rc < 0) {
        last_error_ = std::strerror(errno);
    }
}

std::string UdpSender::last_error() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return last_error_;
}

}  // namespace pavois
