#include "pavois/transport/udp_sender.hpp"

#include <arpa/inet.h>
#include <netdb.h>
#include <sys/socket.h>
#include <unistd.h>

#include <openssl/hmac.h>
#include <openssl/crypto.h>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <cerrno>
#include <cstring>
#include <sstream>
#include <vector>

namespace pavois {
namespace {

void close_fd(int& fd) {
    if (fd >= 0) {
        ::close(fd);
        fd = -1;
    }
}

std::uint64_t now_ms() {
    return static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count());
}

bool verify_packet(const std::string& packet, const char* secret,
                   std::string& payload) {
    if (!secret || !*secret) {
        payload = packet;
        return true;
    }
    if (packet.size() < 40) return false;
    std::uint64_t timestamp = 0;
    for (int i = 0; i < 8; ++i) {
        timestamp =
            (timestamp << 8) |
            static_cast<unsigned char>(packet[static_cast<std::size_t>(i)]);
    }
    const std::uint64_t now = now_ms();
    if (timestamp + 2000ULL < now || timestamp > now + 1000ULL) return false;
    payload.assign(packet.begin() + 40, packet.end());
    const std::string signed_data = packet.substr(0, 8) + payload;
    unsigned char expected[EVP_MAX_MD_SIZE];
    unsigned int size = 0;
    if (!HMAC(EVP_sha256(), secret, static_cast<int>(std::strlen(secret)),
              reinterpret_cast<const unsigned char*>(signed_data.data()),
              signed_data.size(), expected, &size) ||
        size != 32) {
        return false;
    }
    return CRYPTO_memcmp(expected, packet.data() + 8, 32) == 0;
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
        const auto ms = now_ms();
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

void UdpSender::drain_commands() {
    if (fd_ < 0) return;

    const char* secret = std::getenv("UDP_HMAC_SECRET");
    const bool signed_link = secret && *secret;
    char buffer[2048];
    while (true) {
        const ssize_t size = ::recv(fd_, buffer, sizeof(buffer), MSG_DONTWAIT);
        if (size < 0) {
            if (errno != EAGAIN && errno != EWOULDBLOCK) {
                last_error_ = std::strerror(errno);
            }
            break;
        }
        std::string payload;
        const std::string packet(buffer, buffer + size);
        if (!verify_packet(packet, secret, payload)) {
            last_error_ = "invalid UDP command signature";
            continue;
        }
        while (!payload.empty() &&
               (payload.back() == '\n' || payload.back() == '\r')) {
            payload.pop_back();
        }
        std::vector<std::string> parts;
        std::stringstream stream(payload);
        std::string part;
        while (std::getline(stream, part, ',')) parts.push_back(part);
        if (parts.empty()) continue;

        if (parts[0] == "capture") {
            if (parts.size() != 4) continue;
            try {
                CaptureRequest request{parts[2], std::stoull(parts[3])};
                if (!parts[1].empty() && !request.request_id.empty() &&
                    request.expires_ms >= now_ms()) {
                    capture_requests_[parts[1]] = std::move(request);
                }
            } catch (...) {
            }
            continue;
        }

        if (parts[0] == "set") {
            // A setting changes what the detector reports. Unlike a photo
            // request it is never taken from an unauthenticated sender.
            if (!signed_link) {
                last_error_ = "set command refused: UDP_HMAC_SECRET is not set";
                continue;
            }
            if (parts.size() < 3 || parts[1].empty()) continue;
            ConfigUpdate update;
            try {
                update.version = std::stoull(parts[2]);
            } catch (...) {
                continue;
            }
            for (std::size_t i = 3; i < parts.size(); ++i) {
                const auto eq = parts[i].find('=');
                if (eq == std::string::npos || eq == 0) continue;
                update.fields.emplace_back(parts[i].substr(0, eq),
                                           parts[i].substr(eq + 1));
            }
            config_updates_[parts[1]] = std::move(update);
        }
    }
}

std::optional<UdpSender::ConfigUpdate> UdpSender::take_config_update(
    const std::string& camera_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    drain_commands();
    const auto found = config_updates_.find(camera_id);
    if (found == config_updates_.end()) return std::nullopt;
    ConfigUpdate update = std::move(found->second);
    config_updates_.erase(found);
    return update;
}

std::optional<UdpSender::CaptureRequest> UdpSender::take_capture_request(
    const std::string& camera_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (fd_ < 0) return std::nullopt;
    drain_commands();

    const auto found = capture_requests_.find(camera_id);
    if (found == capture_requests_.end()) return std::nullopt;
    CaptureRequest request = std::move(found->second);
    capture_requests_.erase(found);
    if (request.expires_ms < now_ms()) return std::nullopt;
    return request;
}

std::string UdpSender::last_error() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return last_error_;
}

}  // namespace pavois
