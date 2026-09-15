#pragma once

#include <cstdint>
#include <map>
#include <mutex>
#include <optional>
#include <string>

namespace pavois {

class UdpSender {
public:
    struct CaptureRequest {
        std::string request_id;
        std::uint64_t expires_ms = 0;
    };

    UdpSender();
    UdpSender(std::string host, int port);
    ~UdpSender();

    UdpSender(const UdpSender&) = delete;
    UdpSender& operator=(const UdpSender&) = delete;

    bool open(std::string host, int port);
    bool valid() const;
    void send_line(const std::string& line);
    std::optional<CaptureRequest> take_capture_request(
        const std::string& camera_id);
    std::string last_error() const;

private:
    int fd_ = -1;
    int port_ = 0;
    std::string host_;
    std::string last_error_;
    mutable std::mutex mutex_;
    std::map<std::string, CaptureRequest> capture_requests_;
};

}  // namespace pavois
