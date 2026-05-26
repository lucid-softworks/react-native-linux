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

// Async download via libsoup. Progress fires every ~200ms during
// the body drain with (bytesWritten, totalBytes); pass nullptr to
// opt out. Success fires with (savedPath, status, totalBytes
// written on this call — for resumed downloads this is the
// delta, not the cumulative file size). Both fire on the
// GMainContext (JS thread).
using DownloadProgress = std::function<void(int64_t bytesWritten, int64_t totalBytes)>;
using DownloadSuccess = std::function<void(const std::string& path, int status, int64_t bytes)>;
using DownloadError = std::function<void(const std::string& message)>;

struct DownloadOptions {
  // Resumes a prior download by sending HTTP `Range: bytes=N-`. The
  // body is appended to destPath rather than truncating it.
  int64_t resumeFromBytes = 0;
};

// Opaque token returned to JS; pass back into downloadCancel() to
// abort an in-flight download.
using DownloadHandle = std::string;

DownloadHandle download(const std::string& url,
                        const std::string& destPath,
                        const DownloadOptions& opts,
                        DownloadProgress onProgress,
                        DownloadSuccess onSuccess,
                        DownloadError onError);

// Abort an in-flight download by handle. Idempotent — a stale id
// or one that already completed is a no-op. The onError callback
// fires with "cancelled" so the JS Promise rejects deterministically.
void downloadCancel(const DownloadHandle& handle);

// ─── Uploads ──────────────────────────────────────────────────────

struct UploadField {
  std::string name;
  bool isFile = false;
  std::string textValue; // when !isFile
  std::string filePath;  // when isFile
  std::string filename;  // when isFile
  std::string mimeType;  // when isFile (defaults to application/octet-stream)
};

using UploadSuccess = std::function<void(int status, const std::string& responseBody)>;
using UploadError = std::function<void(const std::string& message)>;

// Multipart/form-data upload. `headers` are added on top of the
// content-type SoupMultipart sets. Method defaults to POST when
// empty.
void uploadMultipart(const std::string& url,
                     const std::string& method,
                     const std::vector<UploadField>& fields,
                     const std::vector<std::pair<std::string, std::string>>& headers,
                     UploadSuccess onSuccess,
                     UploadError onError);

// Single-file binary body upload. The file's bytes become the
// request body verbatim.
void uploadBinary(const std::string& url,
                  const std::string& method,
                  const std::string& filePath,
                  const std::string& mimeType,
                  const std::vector<std::pair<std::string, std::string>>& headers,
                  UploadSuccess onSuccess,
                  UploadError onError);

// statvfs-backed disk-space helpers. `path` should be any path on
// the target filesystem (we use documentDirectory's parent on the
// JS side). Returns -1 on failure rather than throwing — expo apps
// usually treat unknown-disk as a soft signal, not a hard error.
int64_t freeDiskBytes(const std::string& path);
int64_t totalDiskBytes(const std::string& path);

} // namespace rnlinux::filesystem
