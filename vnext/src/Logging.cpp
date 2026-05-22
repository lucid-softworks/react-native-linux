#include "react-native-linux/Logging.h"

#include <chrono>
#include <iomanip>
#include <iostream>
#include <mutex>

namespace rnlinux {

namespace {

const char* levelName(LogLevel l) {
  switch (l) {
    case LogLevel::Trace: return "TRACE";
    case LogLevel::Debug: return "DEBUG";
    case LogLevel::Info:  return "INFO ";
    case LogLevel::Warn:  return "WARN ";
    case LogLevel::Error: return "ERROR";
  }
  return "?????";
}

std::mutex& mu() {
  static std::mutex m;
  return m;
}

}  // namespace

void log(LogLevel level, std::string_view tag, std::string_view message) {
  using namespace std::chrono;
  const auto now = system_clock::now();
  const auto t = system_clock::to_time_t(now);
  const auto ms =
      duration_cast<milliseconds>(now.time_since_epoch()).count() % 1000;

  std::ostream& out = level >= LogLevel::Warn ? std::cerr : std::cout;
  std::lock_guard<std::mutex> _(mu());
  out << '[' << std::put_time(std::localtime(&t), "%H:%M:%S")
      << '.' << std::setw(3) << std::setfill('0') << ms << "] "
      << levelName(level) << " [" << tag << "] " << message << '\n';
}

}  // namespace rnlinux
