#include "pavois/detection/blob_detector.hpp"

#include <queue>
#include <string>

namespace pavois {

std::vector<Blob> detect_blobs(
    const std::vector<std::uint8_t>& mask,
    int width,
    int height,
    std::size_t min_area) {
    std::vector<Blob> blobs;
    if (width <= 0 || height <= 0 || mask.size() != static_cast<std::size_t>(width) * static_cast<std::size_t>(height)) {
        return blobs;
    }

    std::vector<std::uint8_t> visited(mask.size(), 0);
    const int dxs[8] = {-1, 0, 1, -1, 1, -1, 0, 1};
    const int dys[8] = {-1, -1, -1, 0, 0, 1, 1, 1};

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            const std::size_t start = static_cast<std::size_t>(y) * static_cast<std::size_t>(width) + static_cast<std::size_t>(x);
            if (!mask[start] || visited[start]) {
                continue;
            }

            std::queue<std::pair<int, int>> q;
            q.push({x, y});
            visited[start] = 1;

            int min_x = x;
            int max_x = x;
            int min_y = y;
            int max_y = y;
            std::size_t area = 0;
            long long sum_x = 0;
            long long sum_y = 0;

            while (!q.empty()) {
                const auto [cx, cy] = q.front();
                q.pop();

                ++area;
                sum_x += cx;
                sum_y += cy;
                min_x = std::min(min_x, cx);
                max_x = std::max(max_x, cx);
                min_y = std::min(min_y, cy);
                max_y = std::max(max_y, cy);

                for (int k = 0; k < 8; ++k) {
                    const int nx = cx + dxs[k];
                    const int ny = cy + dys[k];
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
                        continue;
                    }
                    const std::size_t nidx = static_cast<std::size_t>(ny) * static_cast<std::size_t>(width) + static_cast<std::size_t>(nx);
                    if (!mask[nidx] || visited[nidx]) {
                        continue;
                    }
                    visited[nidx] = 1;
                    q.push({nx, ny});
                }
            }

            if (area < min_area) {
                continue;
            }

            Blob blob;
            blob.x = min_x;
            blob.y = min_y;
            blob.w = max_x - min_x + 1;
            blob.h = max_y - min_y + 1;
            blob.area = area;
            blob.centroid_x = static_cast<double>(sum_x) / static_cast<double>(area);
            blob.centroid_y = static_cast<double>(sum_y) / static_cast<double>(area);
            blobs.push_back(blob);
        }
    }

    return blobs;
}

DetectionEvent make_detection_event(
    std::uint64_t frame_id,
    const Blob& blob,
    const std::vector<std::uint8_t>& diff_mask) {
    DetectionEvent event;
    event.frame_id = frame_id;
    event.blob_area = blob.area;
    event.centroid_x = blob.centroid_x;
    event.centroid_y = blob.centroid_y;
    event.confidence = 0.5 + std::min(0.45, static_cast<double>(blob.area) / 5000.0);
    event.diff_mask = diff_mask;
    return event;
}

}  // namespace pavois

