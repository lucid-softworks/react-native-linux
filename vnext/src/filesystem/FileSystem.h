#pragma once

// POSIX-direct backend for `expo-file-system`. Almost everything is
// synchronous (file ops on local disk are fast and bounded — the
// per-call cost is dominated by JSI marshalling, not the syscalls),
// then wrapped in `Promise.resolve(...)` on the JS side to preserve
// the upstream async signature. The exception is `download`, which
// hits the network via libsoup and genuinely needs to be async.
//
// URI handling: callers pass plain filesystem paths OR `file://`
// URIs. The JS shim strips the scheme before calling into here, so
// the C++ side only ever sees absolute paths. `documentDirectory`
// and friends are returned WITH the `file://` prefix so callers can
// concatenate them as upstream does.

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace rnlinux::filesystem {

struct Constants {
  std::string documentDirectory; // $XDG_DATA_HOME/<app>/  (file:// URI)
  std::string cacheDirectory;    // $XDG_CACHE_HOME/<app>/ (file:// URI)
  std::string bundleDirectory;   // <exe dir>/assets/      (file:// URI)
};

struct FileInfo {
  bool exists = false;
  bool isDirectory = false;
  int64_t size = 0;             // bytes; 0 for dirs / missing
  int64_t modificationTime = 0; // ms-epoch; 0 if unknown / missing
  std::string md5;              // optional; empty unless requested
  std::string uri;              // canonical file:// URI of the path
};

enum class Encoding {
  UTF8,
  Base64,
};

// Populated once and cached. XDG paths come from environment with
// the standard fallbacks; bundleDirectory is derived from the
// running executable's location.
const Constants& constants(const std::string& appId);

// Synchronous file ops. Throws std::runtime_error on hard failures
// the JS shim should translate into a rejected Promise; soft
// "doesn't exist" results land in FileInfo.exists=false instead.
std::string readString(const std::string& path, Encoding encoding);
void writeString(const std::string& path, const std::string& contents, Encoding encoding);
FileInfo getInfo(const std::string& path, bool wantMd5);
bool deleteFile(const std::string& path, bool idempotent);
void makeDirectory(const std::string& path, bool intermediates);
std::vector<std::string> readDirectory(const std::string& path);
void copy(const std::string& from, const std::string& to);
void move(const std::string& from, const std::string& to);

// Async download via libsoup. Calls onSuccess(savedPath, status,
// contentLength) on completion; onError(message) on any failure.
// Both callbacks fire on the GMainContext (JS thread).
using DownloadSuccess = std::function<void(const std::string& path, int status, int64_t bytes)>;
using DownloadError = std::function<void(const std::string& message)>;
void download(const std::string& url,
              const std::string& destPath,
              DownloadSuccess onSuccess,
              DownloadError onError);

} // namespace rnlinux::filesystem
