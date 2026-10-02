#pragma once

#include <cstdint>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace pavois {

class UdpSender {
public:
    struct CaptureRequest {
        std::string request_id;
        std::uint64_t expires_ms = 0;
    };

    // Live detection settings pushed by the VPS. Version 0 hands control back
    // to the config file; any other version carries the full set of fields.
    struct ConfigUpdate {
        std::uint64_t version = 0;
        std::vector<std::pair<std::string, std::string>> fields;
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
    // Latest pending settings for this camera, if any. Only ever filled from a
    // signed command: with no UDP_HMAC_SECRET a "set" is refused outright.
    std::optional<ConfigUpdate> take_config_update(const std::string& camera_id);
    std::string last_error() const;

private:
    // Reads every queued datagram into the pending maps. Caller holds mutex_.
    void drain_commands();

    int fd_ = -1;
    int port_ = 0;
    std::string host_;
    std::string last_error_;
    mutable std::mutex mutex_;
    std::map<std::string, CaptureRequest> capture_requests_;
    std::map<std::string, ConfigUpdate> config_updates_;
};

}  // namespace pavois
