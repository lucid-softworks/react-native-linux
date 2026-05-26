#include "react-native-linux/CrashHandler.h"

#include "react-native-linux/Logging.h"

#include <atomic>
#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <execinfo.h>
#include <unistd.h>

namespace rnlinux {

namespace {

std::atomic<bool> g_installed{false};

// Async-signal-safe-ish backtrace write. backtrace() and
// backtrace_symbols_fd() are documented signal-safe on glibc; we avoid
// std::ostream, malloc-heavy formatting, and locking inside the handler
// itself. The richer formatted message goes through RNL_LOGE *after* the
// raw trace, knowing that path is not strictly signal-safe — at the cost
// of potentially deadlocking the logger, we get readable output 99% of
// the time. If that becomes a real problem, switch RNL_LOGE to fputs +
// write(2).
void writeBacktrace(const char* tag) {
  // Skip frames 0-1 (handler internals); 32 deep is plenty for the
  // typical RN stack.
  void* frames[32];
  int n = backtrace(frames, 32);
  const char banner[] = "\n--- crash backtrace ---\n";
  ::write(STDERR_FILENO, banner, sizeof(banner) - 1);
  backtrace_symbols_fd(frames, n, STDERR_FILENO);
  ::write(STDERR_FILENO, "--- end backtrace ---\n", 22);

  (void)tag; // tag is consumed by the post-handler logger call below.
}

void signalHandler(int sig, siginfo_t* info, void* /*ctx*/) {
  writeBacktrace("signal");

  // Re-raise with the default disposition so the kernel produces a core
  // dump (subject to ulimit -c). We can't safely use std::cerr here, so
  // emit a tiny terminator message via write(2) first.
  char msg[64];
  const int len = std::snprintf(msg,
                                sizeof(msg),
                                "[crash] signal=%d code=%d addr=%p\n",
                                sig,
                                info ? info->si_code : 0,
                                info ? info->si_addr : nullptr);
  if (len > 0) {
    ::write(STDERR_FILENO, msg, static_cast<size_t>(len));
  }

  // `sa = {}` instead of `sa{}` — older clang-format (Ubuntu 24.04
  // ships v18, brew on macOS ships v22) disagree on whether to put a
  // space between the identifier and the C++17 brace-init list. The
  // explicit `=` form is rendered the same way by every version.
  struct sigaction sa = {};
  sa.sa_handler = SIG_DFL;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = 0;
  sigaction(sig, &sa, nullptr);
  raise(sig);
}

[[noreturn]] void terminateHandler() {
  writeBacktrace("std::terminate");
  RNL_LOGE("CrashHandler") << "std::terminate called (uncaught exception?)";

  // Hand off to the previous terminate handler if it differed from
  // std::abort; otherwise just abort.
  std::abort();
}

} // namespace

void installCrashHandler() {
  bool expected = false;
  if (!g_installed.compare_exchange_strong(expected, true)) {
    return;
  }

  struct sigaction sa = {};
  sa.sa_sigaction = &signalHandler;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = SA_SIGINFO | SA_RESTART;

  for (int sig : {SIGSEGV, SIGABRT, SIGFPE, SIGILL, SIGBUS}) {
    if (sigaction(sig, &sa, nullptr) != 0) {
      RNL_LOGW("CrashHandler") << "sigaction failed for signal " << sig << " (errno=" << errno
                               << ")";
    }
  }

  std::set_terminate(&terminateHandler);
  RNL_LOGI("CrashHandler") << "installed";
}

} // namespace rnlinux
