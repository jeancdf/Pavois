#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace pavois {

// Pinhole intrinsics plus a 2-coefficient radial distortion model.
// If fx <= 0 the consumer falls back to deriving fx/fy from fov_deg.
struct CameraIntrinsics {
    double fx = 0.0;
    double fy = 0.0;
    double cx = 0.0;
    double cy = 0.0;
    double k1 = 0.0;
    double k2 = 0.0;
    double fov_deg = 65.0;
    int image_width = 0;
    int image_height = 0;
};

// Rigid pose of the camera in the local ENU frame (metres, degrees).
// heading_deg is a compass bearing (0 = North, 90 = East, clockwise).
// elevation_deg is the optical-axis tilt above the horizon (+ up).
struct CameraPose {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;
    double heading_deg = 0.0;
    double elevation_deg = 0.0;
    double roll_deg = 0.0;
};

struct Observation {
    std::string camera_id;
    std::uint64_t frame_id = 0;
    std::uint64_t timestamp_us = 0;   // wall clock at capture
    std::uint64_t captured_us = 0;    // alias kept explicit for fusion time-align

    int image_width = 0;
    int image_height = 0;

    // Detected target centre in pixels (sub-pixel, distorted image coordinates).
    double centroid_x = 0.0;
    double centroid_y = 0.0;
    std::size_t blob_area = 0;

    // [0,1] measurement quality: sharpness / stability / continuity.
    double quality = 0.0;
    double confidence = 0.0;  // legacy field, kept in sync with quality

    CameraIntrinsics intrinsics;
    CameraPose pose;

    // Legacy flat accessors (still read by some older code paths / tests).
    double cam_x = 0.0;
    double cam_y = 0.0;
    double cam_z = 0.0;
    double yaw_deg = 0.0;
    double pitch_deg = 90.0;
    double roll_deg = 0.0;
    double fov_deg = 65.0;
};

}  // namespace pavois
