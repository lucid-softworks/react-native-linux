#pragma once

#include <string>

namespace rnlinux {

// Per-app identity, set once at process startup by
// `RNLinuxApplication`'s constructor (from `RNLinuxHost::Config::applicationId`,
// which `init-linux` derives from the consumer's package.json — see
// docs/design-multi-instance.md). Modules that need per-app sandboxing
// (AsyncStorage's XDG dir, SecureStore's service ID, KeepAwake's
// logind inhibit `who=…`, FileSystem's `documentDirectory`,
// DeviceInfo's bundle ID, …) read it from here instead of hard-coding
// a "react-native-linux" string.
//
// Thread-safety: the id is set once at startup before any worker
// thread or GTK callback runs; reads after that are unsynchronized
// and the returned reference is stable for the lifetime of the
// process.

void setApplicationId(std::string id);

// Returns the configured id, or "react-native-linux" as the fallback
// when no app has registered yet (in-tree tests, units that touch
// storage before RNLinuxApplication runs). Never throws and always
// returns a non-empty string.
const std::string& applicationId();

} // namespace rnlinux
