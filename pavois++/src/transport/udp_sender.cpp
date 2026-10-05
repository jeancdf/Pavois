#include "pavois/transport/udp_sender.hpp"

#include "pavois/transport/message_auth.hpp"

#include <arpa/inet.h>
#include <netdb.h>
#include <sys/socket.h>
#include <unistd.h>

#include <cerrno>
#include <cstdint>
#include <cstring>
#include <iterator>
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

constexpr std::uint64_t kCommandMemoryMs = kMaxAgeMs + 500;

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
    const std::string secret = signing_secret();
    if (secret.empty()) {
        last_error_ = "UDP_HMAC_SECRET missing or shorter than 32 characters";
        return;
    }
    const std::string payload = line + '\n';
    const std::string timestamp = encode_timestamp(unix_time_ms());
    const std::string signature = hmac_sha256(secret, timestamp + payload);
    if (signature.empty()) {
        last_error_ = "UDP HMAC signing failed";
        return;
    }
    const std::string packet = timestamp + signature + payload;
    if (::send(fd_, packet.data(), packet.size(), 0) < 0) {
        last_error_ = std::strerror(errno);
    }
}

bool UdpSender::accept_command(const std::string& packet, std::string& payload) {
    const std::string secret = signing_secret();
    if (secret.empty() || packet.size() < kSignedHeaderBytes) return false;

    const std::uint64_t now = unix_time_ms();
    if (!is_fresh(decode_timestamp(packet.data()), now)) return false;

    payload.assign(packet, kSignedHeaderBytes, std::string::npos);
    const std::string expected =
        hmac_sha256(secret, packet.substr(0, kTimestampBytes) + payload);
    if (!constant_time_equal(expected, packet.data() + kTimestampBytes)) return false;

    for (auto it = seen_commands_.begin(); it != seen_commands_.end();) {
        it = now - it->second > kCommandMemoryMs ? seen_commands_.erase(it) : std::next(it);
    }
    return seen_commands_.emplace(expected, now).second;
}

void UdpSender::drain_commands() {
    if (fd_ < 0) return;

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
        if (!accept_command(std::string(buffer, buffer + size), payload)) {
            last_error_ = "UDP command rejected";
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
                    request.expires_ms >= unix_time_ms()) {
                    capture_requests_[parts[1]] = std::move(request);
                }
            } catch (...) {
            }
            continue;
        }

        if (parts[0] == "set") {
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
    if (request.expires_ms < unix_time_ms()) return std::nullopt;
    return request;
}

std::string UdpSender::last_error() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return last_error_;
}

}  // namespace pavois
