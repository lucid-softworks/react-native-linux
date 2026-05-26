#include "react-native-linux/Logging.h"

#include <chrono>
#include <iomanip>
#include <iostream>
#include <mutex>

namespace rnlinux {

namespace {

const char* levelName(LogLevel l) {
  switch (l) {
  case LogLevel::Trace:
    return "TRACE";
  case LogLevel::Debug:
    return "DEBUG";
  case LogLevel::Info:
    return "INFO ";
  case LogLevel::Warn:
    return "WARN ";
  case LogLevel::Error:
    return "ERROR";
  }
  return "?????";
}

std::mutex& mu() {
  static std::mutex m;
  return m;
}

} // namespace

void log(LogLevel level, std::string_view tag, std::string_view message) {
  using namespace std::chrono;
  const auto now = system_clock::now();
  const auto t = system_clock::to_time_t(now);
  const auto ms = duration_cast<milliseconds>(now.time_since_epoch()).count() % 1000;

  // Always write to stderr: when the executable is launched from
  // `nohup ... >file 2>&1` the stdout side is block-buffered, swallowing
  // INFO/DEBUG lines until 4 KiB accumulate. stderr is unbuffered, so
  // every log line surfaces immediately — essential for debugging the
  // bundle-eval path.
  std::lock_guard<std::mutex> _(mu());
  std::cerr << '[' << std::put_time(std::localtime(&t), "%H:%M:%S") << '.' << std::setw(3)
            << std::setfill('0') << ms << "] " << levelName(level) << " [" << tag << "] " << message
            << '\n'
            << std::flush;
}

} // namespace rnlinux
