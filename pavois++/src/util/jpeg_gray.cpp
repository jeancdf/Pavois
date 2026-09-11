#include "pavois/util/jpeg_gray.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace pavois {
namespace {

constexpr int kZigzag[64] = {
    0,  1,  8,  16, 9,  2,  3,  10, 17, 24, 32, 25, 18, 11, 4,  5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6,  7,  14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63};

constexpr std::uint8_t kLumQT[64] = {
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99};

constexpr std::uint8_t kBitsDc[16] = {
    0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0};
constexpr std::uint8_t kValDc[12] = {
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11};

constexpr std::uint8_t kBitsAc[16] = {
    0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d};
constexpr std::uint8_t kValAc[162] = {
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
    0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3,
    0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9,
    0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4,
    0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa};

struct Huff {
    std::uint16_t code[256]{};
    std::uint8_t len[256]{};
};

void build_huff(const std::uint8_t* bits, const std::uint8_t* vals,
                int nvals, Huff& out) {
    int code = 0;
    int k = 0;
    for (int len = 1; len <= 16; ++len) {
        code <<= 1;
        for (int i = 0; i < bits[len - 1]; ++i) {
            if (k >= nvals) return;
            const int v = vals[k++];
            out.code[v] = static_cast<std::uint16_t>(code);
            out.len[v] = static_cast<std::uint8_t>(len);
            ++code;
        }
    }
}

struct BitBuf {
    std::vector<std::uint8_t> bytes;
    std::uint32_t acc = 0;
    int nbits = 0;

    void put(std::uint32_t code, int len) {
        if (len <= 0) return;
        acc = (acc << len) | (code & ((1u << len) - 1u));
        nbits += len;
        while (nbits >= 8) {
            nbits -= 8;
            const auto b = static_cast<std::uint8_t>(acc >> nbits);
            bytes.push_back(b);
            if (b == 0xff) bytes.push_back(0);
        }
    }

    void flush() {
        if (nbits > 0) put(0x7fu, 8 - nbits);
        nbits = 0;
    }
};

int category(int v) {
    if (v == 0) return 0;
    if (v < 0) v = -v;
    int n = 0;
    while (v) {
        v >>= 1;
        ++n;
    }
    return n;
}

void put_number(BitBuf& bits, int value, int n) {
    if (n <= 0) return;
    int extra = value;
    if (value < 0) extra = extra - 1 + (1 << n);
    bits.put(static_cast<std::uint32_t>(extra), n);
}

void fdct8(const float in[64], float out[64]) {
    constexpr float kPi = 3.14159265358979323846f;
    for (int v = 0; v < 8; ++v) {
        for (int u = 0; u < 8; ++u) {
            float sum = 0.0f;
            for (int y = 0; y < 8; ++y) {
                for (int x = 0; x < 8; ++x) {
                    sum += in[y * 8 + x] *
                           std::cos((2.0f * x + 1.0f) * u * kPi / 16.0f) *
                           std::cos((2.0f * y + 1.0f) * v * kPi / 16.0f);
                }
            }
            const float cu = u == 0 ? 1.0f / std::sqrt(2.0f) : 1.0f;
            const float cv = v == 0 ? 1.0f / std::sqrt(2.0f) : 1.0f;
            out[v * 8 + u] = 0.25f * cu * cv * sum;
        }
    }
}

std::uint8_t sample_px(const GrayFrame& src, int x, int y) {
    x = std::clamp(x, 0, src.width - 1);
    y = std::clamp(y, 0, src.height - 1);
    return src.at(x, y);
}

void scale_qt(int quality, std::uint8_t qt[64]) {
    int q = std::clamp(quality, 1, 100);
    const int s = q < 50 ? 5000 / q : 200 - q * 2;
    for (int i = 0; i < 64; ++i) {
        const int v = (kLumQT[i] * s + 50) / 100;
        qt[i] = static_cast<std::uint8_t>(std::clamp(v, 1, 255));
    }
}

void write_marker(std::vector<std::uint8_t>& o, std::uint8_t m) {
    o.push_back(0xff);
    o.push_back(m);
}

void write_u16(std::vector<std::uint8_t>& o, int v) {
    o.push_back(static_cast<std::uint8_t>((v >> 8) & 0xff));
    o.push_back(static_cast<std::uint8_t>(v & 0xff));
}

}  // namespace

GrayFrame downscale_gray(const GrayFrame& src, int max_width) {
    GrayFrame out;
    if (src.width <= 0 || src.height <= 0 || src.pixels.empty()) return out;
    const int dw = std::max(8, std::min(src.width, std::max(8, max_width)));
    const int dh = std::max(8, src.height * dw / src.width);
    out.width = dw;
    out.height = dh;
    out.captured_us = src.captured_us;
    out.frame_id = src.frame_id;
    out.pixels.resize(static_cast<std::size_t>(dw) * dh);
    for (int y = 0; y < dh; ++y) {
        const int sy = y * src.height / dh;
        for (int x = 0; x < dw; ++x) {
            const int sx = x * src.width / dw;
            out.pixels[static_cast<std::size_t>(y) * dw + x] =
                sample_px(src, sx, sy);
        }
    }
    return out;
}

bool encode_gray_jpeg(const GrayFrame& src, int quality,
                      std::vector<std::uint8_t>& out) {
    out.clear();
    if (src.width <= 0 || src.height <= 0 || src.pixels.empty()) return false;

    std::uint8_t qt[64];
    scale_qt(quality, qt);
    Huff dc;
    Huff ac;
    build_huff(kBitsDc, kValDc, 12, dc);
    build_huff(kBitsAc, kValAc, 162, ac);

    write_marker(out, 0xd8);
    write_marker(out, 0xe0);
    write_u16(out, 16);
    const char jfif[] = "JFIF";
    out.insert(out.end(), jfif, jfif + 5);
    out.push_back(1);
    out.push_back(1);
    out.push_back(0);
    write_u16(out, 1);
    write_u16(out, 1);
    out.push_back(0);
    out.push_back(0);

    write_marker(out, 0xdb);
    write_u16(out, 67);
    out.push_back(0);
    for (int i = 0; i < 64; ++i) out.push_back(qt[kZigzag[i]]);

    write_marker(out, 0xc0);
    write_u16(out, 11);
    out.push_back(8);
    write_u16(out, src.height);
    write_u16(out, src.width);
    out.push_back(1);
    out.push_back(1);
    out.push_back(0x11);
    out.push_back(0);

    write_marker(out, 0xc4);
    write_u16(out, 31);
    out.push_back(0x00);
    out.insert(out.end(), kBitsDc, kBitsDc + 16);
    out.insert(out.end(), kValDc, kValDc + 12);

    write_marker(out, 0xc4);
    write_u16(out, 181);
    out.push_back(0x10);
    out.insert(out.end(), kBitsAc, kBitsAc + 16);
    out.insert(out.end(), kValAc, kValAc + 162);

    write_marker(out, 0xda);
    write_u16(out, 8);
    out.push_back(1);
    out.push_back(1);
    out.push_back(0);
    out.push_back(0);
    out.push_back(0x3f);
    out.push_back(0);

    BitBuf bits;
    int prev_dc = 0;
    const int bw = (src.width + 7) & ~7;
    const int bh = (src.height + 7) & ~7;
    float block[64];
    float freq[64];
    int zz[64];

    for (int by = 0; by < bh; by += 8) {
        for (int bx = 0; bx < bw; bx += 8) {
            for (int y = 0; y < 8; ++y) {
                for (int x = 0; x < 8; ++x) {
                    block[y * 8 + x] =
                        static_cast<float>(sample_px(src, bx + x, by + y)) -
                        128.0f;
                }
            }
            fdct8(block, freq);
            int natural_q[64];
            for (int i = 0; i < 64; ++i) {
                const int q = std::max(1, static_cast<int>(qt[i]));
                natural_q[i] = static_cast<int>(std::lround(freq[i] / q));
            }
            for (int i = 0; i < 64; ++i) zz[i] = natural_q[kZigzag[i]];

            const int dc_v = zz[0] - prev_dc;
            prev_dc = zz[0];
            const int dc_n = category(dc_v);
            bits.put(dc.code[dc_n], dc.len[dc_n]);
            put_number(bits, dc_v, dc_n);

            int run = 0;
            for (int i = 1; i < 64; ++i) {
                const int v = zz[i];
                if (v == 0) {
                    ++run;
                    continue;
                }
                while (run > 15) {
                    bits.put(ac.code[0xf0], ac.len[0xf0]);
                    run -= 16;
                }
                const int n = category(v);
                const int sym = (run << 4) | n;
                bits.put(ac.code[sym], ac.len[sym]);
                put_number(bits, v, n);
                run = 0;
            }
            if (run > 0) bits.put(ac.code[0x00], ac.len[0x00]);
        }
    }
    bits.flush();
    out.insert(out.end(), bits.bytes.begin(), bits.bytes.end());
    write_marker(out, 0xd9);
    return out.size() > 24;
}

}  // namespace pavois
