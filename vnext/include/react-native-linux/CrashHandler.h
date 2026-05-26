#pragma once

namespace rnlinux {

// Install handlers for fatal signals (SIGSEGV/SIGABRT/SIGFPE/SIGILL/SIGBUS)
// and uncaught exceptions. On a crash:
//
//   1. A backtrace is captured via <execinfo.h> and written to stderr
//      through the existing logging path (RNL_LOGE).
//   2. The signal is re-raised against the default disposition so the
//      OS still produces a core dump for post-mortem inspection.
//
// Safe to call once; subsequent calls are no-ops. Typically invoked very
// early in main(), before any other rn-linux runtime work.
void installCrashHandler();

} // namespace rnlinux
