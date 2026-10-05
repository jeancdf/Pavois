#include "pavois/transport/message_auth.hpp"

#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>

#include <chrono>
#include <cstdlib>

namespace pavois {

std::uint64_t unix_time_ms() {
    using namespace std::chrono;
    return static_cast<std::uint64_t>(
        duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count());
}

std::string signing_secret() {
    const char* value = std::getenv("UDP_HMAC_SECRET");
    if (!value) return {};
    std::string secret(value);
    return secret.size() >= kMinSecretLength ? secret : std::string();
}

std::string hmac_sha256(const std::string& key, const std::string& data) {
    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int size = 0;
    const bool ok = HMAC(EVP_sha256(), key.data(), static_cast<int>(key.size()),
                         reinterpret_cast<const unsigned char*>(data.data()),
                         data.size(), digest, &size) != nullptr;
    if (!ok || size != kSignatureBytes) return {};
    return std::string(reinterpret_cast<const char*>(digest), size);
}

std::string to_hex(const std::string& bytes) {
    static constexpr char digits[] = "0123456789abcdef";
    std::string out;
    out.reserve(bytes.size() * 2);
    for (unsigned char byte : bytes) {
        out.push_back(digits[byte >> 4]);
        out.push_back(digits[byte & 0x0f]);
    }
    return out;
}

bool constant_time_equal(const std::string& expected, const char* received) {
    return !expected.empty() &&
           CRYPTO_memcmp(expected.data(), received, expected.size()) == 0;
}

std::string encode_timestamp(std::uint64_t ms) {
    std::string out(kTimestampBytes, '\0');
    for (std::size_t i = 0; i < kTimestampBytes; ++i) {
        out[i] = static_cast<char>((ms >> (56 - 8 * i)) & 0xff);
    }
    return out;
}

std::uint64_t decode_timestamp(const char* bytes) {
    std::uint64_t ms = 0;
    for (std::size_t i = 0; i < kTimestampBytes; ++i) {
        ms = (ms << 8) | static_cast<unsigned char>(bytes[i]);
    }
    return ms;
}

bool is_fresh(std::uint64_t timestamp_ms, std::uint64_t now_ms) {
    return timestamp_ms + kMaxAgeMs >= now_ms && timestamp_ms <= now_ms + kMaxFutureMs;
}

}  // namespace pavois
