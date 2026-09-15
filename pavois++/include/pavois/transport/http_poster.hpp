#pragma once

#include "pavois/domain/frame.hpp"

#include <condition_variable>
#include <cstdint>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace pavois {

// Posts the latest JPEG without blocking the camera thread.
class HttpPoster {
public:
    HttpPoster() = default;
    ~HttpPoster();

    HttpPoster(const HttpPoster&) = delete;
    HttpPoster& operator=(const HttpPoster&) = delete;

    bool open(std::string host, int port, std::string path);
    bool valid() const;
    void post_jpeg(const std::string& camera_id,
                   std::vector<std::uint8_t> jpeg,
                   std::string query = {});
    void post_gray(const std::string& camera_id,
                   GrayFrame frame,
                   int jpeg_quality,
                   std::string query = {});
    std::string last_error() const;

private:
    struct Job {
        std::string camera_id;
        std::string query;
        std::vector<std::uint8_t> jpeg;
        GrayFrame frame;
        int jpeg_quality = 90;
    };

    void worker_loop();
    bool send_once(const Job& job);

    int port_ = 0;
    bool stop_ = false;
    bool valid_ = false;
    std::string host_;
    std::string path_;
    std::string last_error_;
    std::map<std::string, Job> jobs_;
    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::thread worker_;
};

}  // namespace pavois
