// Minimal stub for the `performanceNow()` symbol jsireact references —
// in RN 0.81 it's a free function in `facebook::react`, no longer a
// JSExecutor static. We supply the trivial implementation upstream
// uses (`chronoToDOMHighResTimeStamp(steady_clock::now())`).
//
// When TurboModules + real JSI/bridge plumbing arrive, this file gets
// replaced by linking the real jsireact .cpps.

#include <chrono>
#include <react/timing/primitives.h>

namespace facebook::react {

// RN 0.81 retired the free `chronoToDOMHighResTimeStamp` helper. The
// HighResTimeStamp / HighResDuration primitives now expose the same
// conversion via `(now - epoch).toDOMHighResTimeStamp()`.
double performanceNow() {
  return (HighResTimeStamp::now() - HighResTimeStamp{}).toDOMHighResTimeStamp();
}

} // namespace facebook::react
