#include "pavois/runtime/latest_frame_pump.hpp"

#include <chrono>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>

namespace {

class BurstSource final : public pavois::FrameSource {
public:
    bool open() override { return true; }

    bool read_frame(pavois::GrayFrame& frame) override {
        if (next_ >= 6) {
            error_ = "burst complete";
            return false;
        }
        frame.width = 2;
        frame.height = 2;
        frame.captured_us = 1'000'000 + next_ * 33'333;
        frame.pixels.assign(4, static_cast<std::uint8_t>(next_));
        ++next_;
        return true;
    }

    const std::string& last_error() const override { return error_; }

private:
    std::uint64_t next_ = 0;
    std::string error_;
};

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

}  // namespace

int main() {
    try {
        pavois::LatestFramePump pump(std::make_unique<BurstSource>());
        for (int retry = 0; retry < 100 && pump.captured_frames() < 6;
             ++retry) {
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        require(pump.captured_frames() == 6, "capture thread must drain source");
        const auto latest = pump.wait_next();
        require(latest != nullptr, "latest frame must remain available at EOF");
        require(latest->frame_id == 5 && latest->pixels.front() == 5,
                "consumer must receive the newest frame, not the oldest");
        require(pump.dropped_frames() == 5,
                "every replaced unconsumed frame must be counted");
        require(!pump.wait_next(), "EOF must wake a waiting consumer");
        require(pump.last_error() == "burst complete",
                "source failure must be observable");
        std::cout << "Latest-frame pump test passed\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
    return 0;
}
