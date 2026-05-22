#pragma once

#include <sstream>
#include <string>

namespace rnlinux {

enum class LogLevel { Trace, Debug, Info, Warn, Error };

void log(LogLevel level, std::string_view tag, std::string_view message);

namespace detail {
class LogStream {
 public:
  LogStream(LogLevel level, std::string_view tag) : level_(level), tag_(tag) {}
  ~LogStream() { log(level_, tag_, buf_.str()); }
  template <typename T>
  LogStream& operator<<(const T& v) {
    buf_ << v;
    return *this;
  }
 private:
  LogLevel level_;
  std::string_view tag_;
  std::ostringstream buf_;
};
}  // namespace detail

}  // namespace rnlinux

#define RNL_LOGI(tag) ::rnlinux::detail::LogStream(::rnlinux::LogLevel::Info, tag)
#define RNL_LOGW(tag) ::rnlinux::detail::LogStream(::rnlinux::LogLevel::Warn, tag)
#define RNL_LOGE(tag) ::rnlinux::detail::LogStream(::rnlinux::LogLevel::Error, tag)
#define RNL_LOGD(tag) ::rnlinux::detail::LogStream(::rnlinux::LogLevel::Debug, tag)
