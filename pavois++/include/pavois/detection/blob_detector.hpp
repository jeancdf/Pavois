#pragma once

#include "pavois/domain/detection_event.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

namespace pavois {

struct Blob {
    int x = 0;
    int y = 0;
    int w = 0;
    int h = 0;
    std::size_t area = 0;
    double centroid_x = 0.0;
    double centroid_y = 0.0;
};

std::vector<Blob> detect_blobs(
    const std::vector<std::uint8_t>& mask,
    int width,
    int height,
    std::size_t min_area);

DetectionEvent make_detection_event(
    std::uint64_t frame_id,
    const Blob& blob,
    const std::vector<std::uint8_t>& diff_mask);

}  // namespace pavois
