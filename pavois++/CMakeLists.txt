cmake_minimum_required(VERSION 3.16)

project(pavois_pp VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(pavois_detect
    src/main.cpp
    src/config/config_loader.cpp
    src/detection/blob_detector.cpp
    src/frame_diff.cpp
    src/fusion/fusion_engine.cpp
    src/math/pose.cpp
    src/runtime/camera_worker.cpp
    src/transport/event_bus.cpp
    src/v4l2_camera.cpp
)

target_include_directories(pavois_detect PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

if (MSVC)
    target_compile_options(pavois_detect PRIVATE /W4)
else()
    target_compile_options(pavois_detect PRIVATE -Wall -Wextra -Wpedantic)
endif()
