#include "pavois/capture/csi_camera.hpp"
#include "pavois/capture/frame_source.hpp"

#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <sys/stat.h>
#include <vector>

namespace fs = std::filesystem;

namespace {

void require(bool ok, const std::string& message) {
    if (!ok) throw std::runtime_error(message);
}

using Bytes = std::vector<std::uint8_t>;

void write_bytes(const fs::path& path, const Bytes& bytes) {
    std::ofstream out(path, std::ios::binary);
    out.write(reinterpret_cast<const char*>(bytes.data()),
              static_cast<std::streamsize>(bytes.size()));
}

std::string read_text(const fs::path& path) {
    std::ifstream in(path);
    std::stringstream text;
    text << in.rdbuf();
    return text.str();
}

bool contains(const std::string& text, const std::string& part) {
    return text.find(part) != std::string::npos;
}

// What the fake producers were asked to do since the last reset().
std::string calls(const fs::path& root) {
    return read_text(root / "calls");
}

void reset(const fs::path& root) {
    for (const char* name :
         {"calls", "mjpeg.bin", "yuv420.bin", "yuv420.fail", "ffmpeg.noprobe",
          "metadata"}) {
        fs::remove(root / name);
    }
}

pavois::CameraConfig camera(int width, int height) {
    pavois::CameraConfig cfg;
    cfg.id = "test";
    cfg.device = "csi:0";
    cfg.width = width;
    cfg.height = height;
    return cfg;
}

// One sensor timestamp per frame, 33.333 ms apart, as rpicam-vid writes them.
void write_metadata(const fs::path& root, int frames) {
    std::ofstream out(root / "metadata");
    for (int n = 0; n < frames; ++n) {
        out << "ExposureTime=750\nFrameWallClock="
            << 1700000000000000000ULL + static_cast<std::uint64_t>(n) * 33333000ULL
            << "\n\n";
    }
}

// A frame whose every pixel depends on its position and on the frame number,
// so a shifted row or a frame read across a boundary cannot go unnoticed.
pavois::GrayFrame pattern(int width, int height, int frame) {
    pavois::GrayFrame out;
    out.width = width;
    out.height = height;
    out.pixels.resize(static_cast<std::size_t>(width) * height);
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            out.pixels[static_cast<std::size_t>(y) * width + x] =
                static_cast<std::uint8_t>(frame * 31 + y * 7 + x * 3);
        }
    }
    return out;
}

// Full-size frames through the real pipe: `frames` frames of width x height
// whose rows are `stride` bytes long, as an ISP with padding writes them.
void full_size_run(const fs::path& root, int width, int height, int stride, int frames) {
    reset(root);
    write_metadata(root, frames);
    {
        std::ofstream out(root / "yuv420.bin", std::ios::binary);
        const std::string padding(static_cast<std::size_t>(stride - width), '\xEE');
        const std::string chroma(static_cast<std::size_t>(stride) * height / 2, '\x80');
        for (int n = 0; n < frames; ++n) {
            const pavois::GrayFrame frame = pattern(width, height, n);
            for (int y = 0; y < height; ++y) {
                out.write(reinterpret_cast<const char*>(frame.pixels.data()) +
                              static_cast<std::size_t>(y) * width,
                          width);
                out.write(padding.data(), static_cast<std::streamsize>(padding.size()));
            }
            out.write(chroma.data(), static_cast<std::streamsize>(chroma.size()));
        }
    }
    auto cfg = camera(width, height);
    cfg.capture_format = "yuv420";
    if (stride != width) cfg.capture_stride = stride;
    const std::string what =
        "yuv420 " + std::to_string(width) + "x" + std::to_string(height);
    auto source = pavois::make_frame_source(cfg);
    require(source->open(), what + " must open");
    pavois::GrayFrame frame;
    for (int n = 0; n < frames; ++n) {
        const bool read = source->read_frame(frame);
        require(read, what + ": frame " + std::to_string(n) + " must be readable (" +
                          source->last_error() + ")");
        require(frame.pixels == pattern(width, height, n).pixels,
                what + ": frame " + std::to_string(n) + " must come out pixel for pixel");
        require(frame.captured_us ==
                    1700000000000000ULL + static_cast<std::uint64_t>(n) * 33333ULL,
                what + ": frame " + std::to_string(n) + " must keep its own timestamp");
    }
    require(!source->read_frame(frame), what + ": the stream must end after its last frame");
    fs::remove(root / "yuv420.bin");
}

// Reads `expected.size()` frames and checks pixels and sensor timestamps.
void expect_frames(pavois::FrameSource& source, int width, int height,
                   const std::vector<Bytes>& expected, const std::string& what) {
    pavois::GrayFrame frame;
    for (std::size_t n = 0; n < expected.size(); ++n) {
        // Read first: the error text is only meaningful afterwards.
        const bool read = source.read_frame(frame);
        require(read, what + ": frame must be readable (" + source.last_error() + ")");
        require(frame.width == width && frame.height == height &&
                    frame.size() == expected[n].size(),
                what + ": frame dimensions must match the capture configuration");
        require(frame.captured_us ==
                    1700000000000000ULL + static_cast<std::uint64_t>(n) * 33333ULL,
                what + ": sensor timestamp must stay aligned with its frame");
        require(frame.pixels == expected[n],
                what + ": frame boundaries and pixels must be preserved");
    }
}

Bytes ramp(std::size_t count, int first) {
    Bytes bytes(count);
    for (std::size_t i = 0; i < count; ++i) {
        bytes[i] = static_cast<std::uint8_t>((first + static_cast<int>(i)) % 250 + 1);
    }
    return bytes;
}

void append(Bytes& to, const Bytes& from) {
    to.insert(to.end(), from.begin(), from.end());
}

void test_stride_rule() {
    std::string reason;
    auto cfg = camera(1280, 720);
    require(pavois::yuv420_stride(cfg, reason) == 1280 && reason.empty(),
            "a width that is a multiple of 128 is read unpadded");
    cfg = camera(640, 480);
    require(pavois::yuv420_stride(cfg, reason) == 640, "640 is unpadded");
    cfg = camera(1920, 1080);
    require(pavois::yuv420_stride(cfg, reason) == 1920, "1920 is unpadded");

    // 960 is unpadded on a Pi 4 (multiple of 64) but padded to 1024 on a Pi 5.
    cfg = camera(960, 540);
    require(pavois::yuv420_stride(cfg, reason) == 0 && contains(reason, "128"),
            "a width padded on one of the two boards must not be guessed");

    cfg = camera(1296, 972);
    require(pavois::yuv420_stride(cfg, reason) == 0 && contains(reason, "capture_stride"),
            "a padded width must not be guessed");
    cfg.capture_stride = 1344;
    require(pavois::yuv420_stride(cfg, reason) == 1344, "the operator's stride is used");
    cfg.capture_stride = 1200;
    require(pavois::yuv420_stride(cfg, reason) == 0, "a stride below the width is refused");
    cfg.capture_stride = 1297;
    require(pavois::yuv420_stride(cfg, reason) == 0, "an odd stride is refused");

    cfg = camera(1280, 721);
    require(pavois::yuv420_stride(cfg, reason) == 0 && contains(reason, "even"),
            "yuv420 needs even dimensions");
}

void test_exposure_args() {
    using Args = std::vector<std::string>;
    const Args manual = {"--exposure", "sport", "--shutter", "2000", "--gain", "8"};
    pavois::CameraConfig cfg;
    cfg.shutter_us = 2000;
    cfg.analogue_gain = 8.0;
    require(pavois::rpicam_exposure_args(cfg) == manual,
            "manual exposure fixes the shutter and the gain");
    cfg.auto_exposure = true;
    require(pavois::rpicam_exposure_args(cfg) == Args({"--exposure", "sport"}),
            "automatic exposure leaves the shutter and the gain to the camera");
    cfg.ev = 1.5;
    require(pavois::rpicam_exposure_args(cfg) == Args({"--exposure", "sport", "--ev", "1.5"}),
            "automatic exposure passes the compensation");
    cfg.auto_exposure = false;
    require(pavois::rpicam_exposure_args(cfg) == manual,
            "the compensation only applies to automatic exposure");
}

void test_capture(const fs::path& root) {
    const Bytes gray_1 = {1, 2, 3, 4, 5, 6, 7, 8};
    const Bytes gray_2 = {9, 10, 11, 12, 13, 14, 15, 16};

    // MJPEG, the default: rpicam-vid piped into the decoder.
    {
        reset(root);
        Bytes stream = gray_1;
        append(stream, gray_2);
        write_bytes(root / "mjpeg.bin", stream);
        auto source = pavois::make_frame_source(camera(4, 2));
        require(source->open(), "CSI source must open");
        expect_frames(*source, 4, 2, {gray_1, gray_2}, "mjpeg");
        pavois::GrayFrame frame;
        require(!source->read_frame(frame), "EOF must not become a stale frame");
        const std::string asked = calls(root);
        require(contains(asked, "--codec mjpeg --quality 80") && contains(asked, "ffmpeg"),
                "the default capture stays MJPEG through FFmpeg");
        require(!contains(asked, "yuv420"), "yuv420 is never used unless asked for");
        require(!contains(asked, "--mode"), "rpicam-vid picks the sensor mode unless one is pinned");
    }

    // A pinned sensor mode reaches rpicam-vid.
    {
        reset(root);
        Bytes stream = gray_1;
        append(stream, gray_2);
        write_bytes(root / "mjpeg.bin", stream);
        auto cfg = camera(4, 2);
        cfg.sensor_mode = "1920:1080:10:P";
        auto source = pavois::make_frame_source(cfg);
        require(source->open(), "a capture with a pinned mode must open");
        expect_frames(*source, 4, 2, {gray_1, gray_2}, "pinned mode");
        require(contains(calls(root), "--mode 1920:1080:10:P"),
                "the pinned sensor mode is passed to rpicam-vid");
    }

    // yuv420, unpadded: luminance read directly, chroma skipped, no decoder.
    {
        reset(root);
        Bytes stream = gray_1;
        append(stream, {101, 102, 103, 104});
        append(stream, gray_2);
        append(stream, {105, 106, 107, 108});
        write_bytes(root / "yuv420.bin", stream);
        auto cfg = camera(4, 2);
        cfg.capture_format = "yuv420";
        cfg.capture_stride = 4;
        auto source = pavois::make_frame_source(cfg);
        require(source->open(), "yuv420 source must open");
        expect_frames(*source, 4, 2, {gray_1, gray_2}, "yuv420");
        pavois::GrayFrame frame;
        require(!source->read_frame(frame), "yuv420 EOF must not become a stale frame");
        const std::string asked = calls(root);
        require(contains(asked, "--codec yuv420 --flush"),
                "yuv420 must ask rpicam-vid to flush every frame");
        require(!contains(asked, "ffmpeg") && !contains(asked, "mjpeg"),
                "yuv420 must not start a decoder");
    }

    // yuv420 with padded rows: only the pixels of each row are kept.
    {
        reset(root);
        Bytes stream;
        for (const Bytes* gray : {&gray_1, &gray_2}) {
            for (int row = 0; row < 2; ++row) {
                stream.insert(stream.end(), gray->begin() + row * 4,
                              gray->begin() + row * 4 + 4);
                append(stream, {200, 201, 202, 203});
            }
            append(stream, Bytes(8, 150));
        }
        write_bytes(root / "yuv420.bin", stream);
        auto cfg = camera(4, 2);
        cfg.capture_format = "yuv420";
        cfg.capture_stride = 8;
        auto source = pavois::make_frame_source(cfg);
        require(source->open(), "padded yuv420 source must open");
        expect_frames(*source, 4, 2, {gray_1, gray_2}, "padded yuv420");
    }

    // yuv420 at a width the ISP does not pad: the stride is the width.
    {
        reset(root);
        const Bytes wide_1 = ramp(256, 0);
        const Bytes wide_2 = ramp(256, 77);
        Bytes stream = wide_1;
        append(stream, Bytes(128, 128));
        append(stream, wide_2);
        append(stream, Bytes(128, 128));
        write_bytes(root / "yuv420.bin", stream);
        auto cfg = camera(128, 2);
        cfg.capture_format = "yuv420";
        auto source = pavois::make_frame_source(cfg);
        require(source->open(), "128-wide yuv420 source must open");
        expect_frames(*source, 128, 2, {wide_1, wide_2}, "unpadded yuv420");
    }

    // A truncated frame after a good one is an error, not a silent restart.
    {
        reset(root);
        Bytes stream = gray_1;
        append(stream, {101, 102, 103, 104});
        append(stream, {9, 10, 11});
        write_bytes(root / "yuv420.bin", stream);
        auto cfg = camera(4, 2);
        cfg.capture_format = "yuv420";
        cfg.capture_stride = 4;
        auto source = pavois::make_frame_source(cfg);
        require(source->open(), "yuv420 source must open");
        expect_frames(*source, 4, 2, {gray_1}, "yuv420 before truncation");
        pavois::GrayFrame frame;
        require(!source->read_frame(frame), "a truncated yuv420 frame must fail");
        require(contains(source->last_error(), "yuv420"), "the error must name the yuv420 stream");
        require(!source->read_frame(frame), "the failure must persist");
        require(!contains(calls(root), "mjpeg"),
                "a stream that worked must not be swapped for MJPEG behind the operator");
    }

    // A width the ISP pads, with no stride given: stay on MJPEG.
    {
        reset(root);
        Bytes stream = gray_1;
        append(stream, gray_2);
        write_bytes(root / "mjpeg.bin", stream);
        auto cfg = camera(4, 2);
        cfg.capture_format = "yuv420";
        auto source = pavois::make_frame_source(cfg);
        require(source->open(), "the MJPEG fallback must open");
        expect_frames(*source, 4, 2, {gray_1, gray_2}, "guarded yuv420");
        const std::string asked = calls(root);
        require(contains(asked, "--codec mjpeg") && !contains(asked, "yuv420"),
                "an unknown row padding must never be guessed");
    }

    // yuv420 that delivers nothing (rpicam-vid refuses it): MJPEG takes over.
    {
        reset(root);
        std::ofstream(root / "yuv420.fail") << "unsupported\n";
        const Bytes wide_1 = ramp(256, 3);
        const Bytes wide_2 = ramp(256, 91);
        Bytes stream = wide_1;
        append(stream, wide_2);
        write_bytes(root / "mjpeg.bin", stream);
        auto cfg = camera(128, 2);
        cfg.capture_format = "yuv420";
        auto source = pavois::make_frame_source(cfg);
        require(source->open(), "yuv420 source must open");
        expect_frames(*source, 128, 2, {wide_1, wide_2}, "yuv420 start-up fallback");
        const std::string asked = calls(root);
        const auto raw = asked.find("--codec yuv420");
        const auto jpeg = asked.find("--codec mjpeg");
        require(raw != std::string::npos && jpeg != std::string::npos && raw < jpeg,
                "yuv420 must be tried first, then MJPEG");
    }

    // FFmpeg starts on a short probe, so it does not hold back the first
    // second and a half of video.
    {
        reset(root);
        Bytes stream = gray_1;
        append(stream, gray_2);
        write_bytes(root / "mjpeg.bin", stream);
        auto source = pavois::make_frame_source(camera(4, 2));
        require(source->open(), "CSI source must open");
        expect_frames(*source, 4, 2, {gray_1, gray_2}, "short probe");
        require(contains(calls(root), "-probesize 32768 -analyzeduration 0 -f mjpeg -i pipe:0"),
                "FFmpeg must start on a short probe of its input");
    }

    // An FFmpeg that delivers nothing on a short probe gets its default one.
    {
        reset(root);
        std::ofstream(root / "ffmpeg.noprobe") << "refuses\n";
        Bytes stream = gray_1;
        append(stream, gray_2);
        write_bytes(root / "mjpeg.bin", stream);
        auto source = pavois::make_frame_source(camera(4, 2));
        require(source->open(), "CSI source must open");
        expect_frames(*source, 4, 2, {gray_1, gray_2}, "default probe fallback");
        const std::string asked = calls(root);
        const auto last = asked.rfind("ffmpeg ");
        require(asked.find("-probesize") < last, "the short probe must be tried first");
        require(!contains(asked.substr(last), "-probesize"),
                "the retry must leave FFmpeg its default probe");
    }

    // The deployed size: a frame is larger than the pipe, so it crosses it in
    // several pieces while the reader is at work.
    full_size_run(root, 1280, 720, 1280, 12);
    // A padded size: every row carries 48 bytes that are not pixels.
    full_size_run(root, 1296, 972, 1344, 5);

    auto cfg = camera(4, 2);
    cfg.device = "csi:0;false";
    require(!pavois::make_frame_source(cfg)->open(), "camera index must not accept shell syntax");
    cfg.device = "csi:0";
    cfg.fps = 0;
    require(!pavois::make_frame_source(cfg)->open(), "zero capture rate must be rejected");
}

}  // namespace

int main() {
    char pattern[] = "/tmp/pavois-csi-test.XXXXXX";
    const char* dir = ::mkdtemp(pattern);
    if (!dir) return 1;
    const std::string old_path = std::getenv("PATH") ? std::getenv("PATH") : "/usr/bin:/bin";
    int status = 0;
    try {
        // Deterministic producer and passthrough decoder. No hardware is
        // required to check frame boundaries, pixels and subprocess handling.
        // The producer replays <codec>.bin from its own directory, writes two
        // sensor timestamps, and logs how it was called.
        const fs::path root(dir);
        std::ofstream(root / "rpicam-vid")
            << "#!/bin/sh\n"
               "dir=$(dirname \"$0\")\n"
               "echo \"rpicam-vid $*\" >>\"$dir/calls\"\n"
               "codec= metadata=\n"
               "exposure= shutter= gain= awb= awbgains=\n"
               "while [ $# -gt 0 ]; do\n"
               "  case \"$1\" in\n"
               "    --codec) codec=$2; shift 2;;\n"
               "    --metadata) metadata=$2; shift 2;;\n"
               "    --exposure) exposure=$2; shift 2;;\n"
               "    --shutter) shutter=$2; shift 2;;\n"
               "    --gain) gain=$2; shift 2;;\n"
               "    --awb) awb=$2; shift 2;;\n"
               "    --awbgains) awbgains=$2; shift 2;;\n"
               "    *) shift;;\n"
               "  esac\n"
               "done\n"
               "[ \"$exposure\" = sport ] && [ \"$shutter\" = 750 ] &&\n"
               "[ \"$gain\" = 4 ] && [ \"$awb\" = custom ] &&\n"
               "[ \"$awbgains\" = 1,1 ] || exit 64\n"
               "[ -f \"$dir/$codec.fail\" ] && exit 65\n"
               "if [ -f \"$dir/metadata\" ]; then cat \"$dir/metadata\" >\"$metadata\" &\n"
               "else { printf 'FrameWallClock=1700000000000000000\\n\\n'; "
               "printf 'FrameWallClock=1700000000033333000\\n\\n'; } >\"$metadata\" &\n"
               "fi\n"
               "cat \"$dir/$codec.bin\"\n";
        // The decoder passes bytes through and logs its options. With
        // ffmpeg.noprobe present it refuses a short probe, as an FFmpeg that
        // cannot start on one would.
        std::ofstream(root / "ffmpeg")
            << "#!/bin/sh\n"
               "dir=$(dirname \"$0\")\n"
               "echo \"ffmpeg $*\" >>\"$dir/calls\"\n"
               "if [ -f \"$dir/ffmpeg.noprobe\" ]; then\n"
               "  case \"$*\" in *-probesize*) exit 66;; esac\n"
               "fi\n"
               "exec /bin/cat\n";
        ::chmod((root / "rpicam-vid").c_str(), 0700);
        ::chmod((root / "ffmpeg").c_str(), 0700);
        ::setenv("PATH", (root.string() + ':' + old_path).c_str(), 1);

        test_stride_rule();
        test_exposure_args();
        test_capture(root);
        std::cout << "CSI capture test passed\n";
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        status = 1;
    }
    ::setenv("PATH", old_path.c_str(), 1);
    fs::remove_all(dir);
    return status;
}
