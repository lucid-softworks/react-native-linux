// Minimal stub implementations of cxxreact symbols the RN renderer
// references but which would otherwise require pulling the entire
// (legacy bridge) cxxreact source tree into the build.
//
// Right now there's only one consumer: PerformanceEntryReporter (via
// Scheduler / RuntimeScheduler_Legacy) calls JSExecutor::performanceNow()
// to attach high-res timestamps to LongTask entries. We supply the
// trivial chronoToDOMHighResTimeStamp(now()) version upstream uses.
//
// When TurboModules + real JSI/bridge plumbing arrive (Phase 5.6), this
// file gets replaced by linking the real cxxreact .cpps.

#include <chrono>
#include <cxxreact/JSExecutor.h>
#include <react/timing/primitives.h>

namespace facebook::react {

double JSExecutor::performanceNow() {
  return chronoToDOMHighResTimeStamp(std::chrono::steady_clock::now());
}

} // namespace facebook::react
