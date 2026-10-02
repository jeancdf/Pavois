cmake_minimum_required(VERSION 3.16)

project(pavois_pp VERSION 0.2.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if (NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# Core pipeline library (shared by the app and the self-tests).
add_library(pavois_core STATIC
    src/config/config_loader.cpp
    src/config/live_tuning.cpp
    src/capture/frame_source.cpp
    src/capture/csi_camera.cpp
    src/capture/replay_source.cpp
    src/detection/image_ops.cpp
    src/detection/blob_detector.cpp
    src/detection/motion_detector.cpp
    src/frame_diff.cpp
    src/fusion/triangulation.cpp
    src/fusion/tracker.cpp
    src/fusion/fusion_engine.cpp
    src/math/pose.cpp
    src/runtime/camera_worker.cpp
    src/sensors/imu.cpp
    src/transport/event_bus.cpp
    src/transport/http_poster.cpp
    src/transport/udp_sender.cpp
    src/util/debug_sink.cpp
    src/util/jpeg_gray.cpp
    src/util/parallel_executor.cpp
    src/v4l2_camera.cpp
)

target_include_directories(pavois_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)

find_package(Threads REQUIRED)
find_package(OpenSSL REQUIRED)
target_link_libraries(pavois_core PUBLIC Threads::Threads OpenSSL::Crypto)

if (MSVC)
    target_compile_options(pavois_core PRIVATE /W4)
else()
    target_compile_options(pavois_core PRIVATE -Wall -Wextra -Wpedantic)
    if (CMAKE_SYSTEM_PROCESSOR MATCHES "^(aarch64|arm64)$")
        # Deployments compile on their target Pi, so native selects Cortex-A72
        # on Pi 4 and Cortex-A76 on Pi 5 while CI remains architecture-neutral.
        target_compile_options(pavois_core PRIVATE -mcpu=native)
    endif()
endif()

add_executable(pavois_detect src/main.cpp)
target_link_libraries(pavois_detect PRIVATE pavois_core)

add_executable(pavois_gen_scene tools/gen_scene.cpp)
target_link_libraries(pavois_gen_scene PRIVATE pavois_core)

add_executable(pavois_detector_bench tools/benchmark_detector.cpp)
target_link_libraries(pavois_detector_bench PRIVATE pavois_core)

enable_testing()

add_executable(pavois_csi_test tests/csi_capture.cpp)
target_link_libraries(pavois_csi_test PRIVATE pavois_core)
add_test(NAME pavois_csi_test COMMAND pavois_csi_test)
set_tests_properties(pavois_csi_test PROPERTIES TIMEOUT 15)

add_executable(pavois_selftest tests/selftest.cpp)
target_link_libraries(pavois_selftest PRIVATE pavois_core)
target_include_directories(pavois_selftest PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
add_test(NAME pavois_selftest COMMAND pavois_selftest)

add_executable(pavois_accuracy tests/accuracy.cpp)
target_link_libraries(pavois_accuracy PRIVATE pavois_core)
target_include_directories(pavois_accuracy PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
add_test(NAME pavois_accuracy COMMAND pavois_accuracy)
set_tests_properties(pavois_selftest PROPERTIES TIMEOUT 120)
set_tests_properties(pavois_accuracy PROPERTIES TIMEOUT 400)
