#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace pavois {

inline constexpr std::size_t kTimestampBytes = 8;
inline constexpr std::size_t kSignatureBytes = 32;
inline constexpr std::size_t kSignedHeaderBytes = kTimestampBytes + kSignatureBytes;
inline constexpr std::size_t kMinSecretLength = 32;
inline constexpr std::uint64_t kMaxAgeMs = 2000;
inline constexpr std::uint64_t kMaxFutureMs = 1000;

std::uint64_t unix_time_ms();
std::string signing_secret();
std::string hmac_sha256(const std::string& key, const std::string& data);
std::string to_hex(const std::string& bytes);
bool constant_time_equal(const std::string& expected, const char* received);
std::string encode_timestamp(std::uint64_t ms);
std::uint64_t decode_timestamp(const char* bytes);
bool is_fresh(std::uint64_t timestamp_ms, std::uint64_t now_ms);

}  // namespace pavois
