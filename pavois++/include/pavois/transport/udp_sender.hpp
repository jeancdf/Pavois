#pragma once

#include <mutex>
#include <string>

namespace pavois {

class UdpSender {
public:
    UdpSender();
    UdpSender(std::string host, int port);
    ~UdpSender();

    UdpSender(const UdpSender&) = delete;
    UdpSender& operator=(const UdpSender&) = delete;

    bool open(std::string host, int port);
    bool valid() const;
    void send_line(const std::string& line);
    std::string last_error() const;

private:
    int fd_ = -1;
    int port_ = 0;
    std::string host_;
    std::string last_error_;
    mutable std::mutex mutex_;
};

}  // namespace pavois
