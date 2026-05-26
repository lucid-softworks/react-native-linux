#include "FileSystem.h"

#include "react-native-linux/Logging.h"

#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <fstream>
#include <glib.h>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/types.h>
#include <unistd.h>
#include <unordered_map>

#ifdef RNL_FS_HAVE_SOUP
#include <libsoup/soup.h>
#endif

namespace rnlinux::filesystem {

namespace {

// ─── Path helpers ─────────────────────────────────────────────────

std::string joinPath(const std::string& a, const std::string& b) {
  if (a.empty())
    return b;
  if (a.back() == '/')
    return a + b;
  return a + "/" + b;
}

// "file:///foo/bar" — we hand these to JS as constants. The JS shim
// is responsible for stripping back to plain paths before calling
// into our other methods.
std::string toFileUri(const std::string& path) {
  return std::string("file://") + path;
}

std::string xdgDataHome() {
  if (const char* d = std::getenv("XDG_DATA_HOME"); d && *d)
    return d;
  if (const char* h = std::getenv("HOME"); h && *h)
    return std::string(h) + "/.local/share";
  return "/tmp";
}

std::string xdgCacheHome() {
  if (const char* d = std::getenv("XDG_CACHE_HOME"); d && *d)
    return d;
  if (const char* h = std::getenv("HOME"); h && *h)
    return std::string(h) + "/.cache";
  return "/tmp";
}

std::string exeDirectory() {
  char buf[PATH_MAX]{};
  const ssize_t n = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
  if (n <= 0)
    return {};
  std::string p(buf, static_cast<size_t>(n));
  const auto slash = p.find_last_of('/');
  return slash == std::string::npos ? "." : p.substr(0, slash);
}

// Walk up from <path> and mkdir each missing component. POSIX mkdir
// would only create the leaf; expo's `intermediates: true` matches
// `mkdir -p`. Returns true if the directory exists at the end (we
// created it or it was already there).
bool mkdirP(const std::string& path) {
  if (path.empty() || path == "/")
    return true;
  struct stat st {};
  if (stat(path.c_str(), &st) == 0)
    return S_ISDIR(st.st_mode);
  const auto slash = path.find_last_of('/');
  if (slash != std::string::npos && slash > 0) {
    if (!mkdirP(path.substr(0, slash)))
      return false;
  }
  return mkdir(path.c_str(), 0700) == 0 || errno == EEXIST;
}

// Recursive directory delete. POSIX has no helper; we walk + unlink
// + rmdir. Symlinks are unlinked (never followed) to match the
// `recursive: true` semantics of the upstream API.
bool rmrf(const std::string& path) {
  struct stat st {};
  if (lstat(path.c_str(), &st) != 0)
    return errno == ENOENT;
  if (!S_ISDIR(st.st_mode))
    return unlink(path.c_str()) == 0;
  DIR* d = opendir(path.c_str());
  if (!d)
    return false;
  struct dirent* ent;
  bool ok = true;
  while ((ent = readdir(d))) {
    const std::string name = ent->d_name;
    if (name == "." || name == "..")
      continue;
    if (!rmrf(joinPath(path, name))) {
      ok = false;
      break;
    }
  }
  closedir(d);
  if (!ok)
    return false;
  return rmdir(path.c_str()) == 0;
}

} // namespace

const Constants& constants(const std::string& appId) {
  static std::once_flag once;
  static Constants c;
  std::call_once(once, [&]() {
    const std::string app = appId.empty() ? "react-native-linux" : appId;
    const std::string docDir = xdgDataHome() + "/" + app + "/";
    const std::string cacheDir = xdgCacheHome() + "/" + app + "/";
    const std::string bundleDir = exeDirectory() + "/assets/";
    // Best-effort create both writable dirs so the first
    // writeString call doesn't need to bounce through mkdir.
    mkdirP(docDir.substr(0, docDir.size() - 1));
    mkdirP(cacheDir.substr(0, cacheDir.size() - 1));
    c.documentDirectory = toFileUri(docDir);
    c.cacheDirectory = toFileUri(cacheDir);
    c.bundleDirectory = toFileUri(bundleDir);
  });
  return c;
}

std::string readString(const std::string& path, Encoding encoding) {
  std::ifstream f(path, std::ios::binary);
  if (!f.is_open()) {
    throw std::runtime_error(std::string("readString: cannot open ") + path);
  }
  std::ostringstream ss;
  ss << f.rdbuf();
  std::string raw = ss.str();
  if (encoding == Encoding::Base64) {
    char* enc = g_base64_encode(reinterpret_cast<const guchar*>(raw.data()), raw.size());
    std::string out = enc ? std::string(enc) : std::string{};
    g_free(enc);
    return out;
  }
  return raw;
}

void writeString(const std::string& path, const std::string& contents, Encoding encoding) {
  std::string toWrite;
  const std::string* payload = &contents;
  if (encoding == Encoding::Base64) {
    gsize outLen = 0;
    guchar* decoded = g_base64_decode(contents.c_str(), &outLen);
    if (!decoded) {
      throw std::runtime_error("writeString: invalid base64 input");
    }
    toWrite.assign(reinterpret_cast<const char*>(decoded), outLen);
    g_free(decoded);
    payload = &toWrite;
  }
  // Atomic-ish write: temp + rename so a crash mid-write doesn't
  // leave a half-truncated file at the consumer's expected path.
  // RN apps lean on writeAsStringAsync for things like cache JSON
  // and zero-length truncation in those is a silent data-loss bug.
  const std::string tmp = path + ".tmp-rnl";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out.is_open()) {
      throw std::runtime_error(std::string("writeString: cannot open ") + tmp);
    }
    out.write(payload->data(), static_cast<std::streamsize>(payload->size()));
    if (!out) {
      throw std::runtime_error(std::string("writeString: write failed for ") + tmp);
    }
  }
  if (rename(tmp.c_str(), path.c_str()) != 0) {
    unlink(tmp.c_str());
    throw std::runtime_error(std::string("writeString: rename failed: ") + std::strerror(errno));
  }
}

FileInfo getInfo(const std::string& path, bool wantMd5) {
  FileInfo info;
  info.uri = toFileUri(path);
  struct stat st {};
  if (stat(path.c_str(), &st) != 0) {
    return info; // exists=false
  }
  info.exists = true;
  info.isDirectory = S_ISDIR(st.st_mode);
  info.size = static_cast<int64_t>(st.st_size);
  info.modificationTime =
      static_cast<int64_t>(st.st_mtim.tv_sec) * 1000 + st.st_mtim.tv_nsec / 1000000;
  if (wantMd5 && !info.isDirectory) {
    GChecksum* ck = g_checksum_new(G_CHECKSUM_MD5);
    if (ck) {
      std::ifstream f(path, std::ios::binary);
      char buf[8192];
      while (f.good()) {
        f.read(buf, sizeof(buf));
        const auto got = f.gcount();
        if (got > 0)
          g_checksum_update(ck, reinterpret_cast<const guchar*>(buf), got);
      }
      info.md5 = g_checksum_get_string(ck);
      g_checksum_free(ck);
    }
  }
  return info;
}

bool deleteFile(const std::string& path, bool idempotent) {
  struct stat st {};
  if (lstat(path.c_str(), &st) != 0) {
    if (errno == ENOENT)
      return idempotent;
    throw std::runtime_error(std::string("delete: stat failed: ") + std::strerror(errno));
  }
  if (S_ISDIR(st.st_mode)) {
    return rmrf(path);
  }
  return unlink(path.c_str()) == 0;
}

void makeDirectory(const std::string& path, bool intermediates) {
  if (intermediates) {
    if (!mkdirP(path)) {
      throw std::runtime_error(std::string("mkdir -p failed: ") + std::strerror(errno));
    }
    return;
  }
  if (mkdir(path.c_str(), 0700) != 0 && errno != EEXIST) {
    throw std::runtime_error(std::string("mkdir failed: ") + std::strerror(errno));
  }
}

std::vector<std::string> readDirectory(const std::string& path) {
  std::vector<std::string> out;
  DIR* d = opendir(path.c_str());
  if (!d) {
    throw std::runtime_error(std::string("readDir: cannot open ") + path);
  }
  struct dirent* ent;
  while ((ent = readdir(d))) {
    const std::string name = ent->d_name;
    if (name == "." || name == "..")
      continue;
    out.push_back(name);
  }
  closedir(d);
  return out;
}

void copy(const std::string& from, const std::string& to) {
  // Stream copy in 64KB chunks — large enough that the per-call
  // syscall overhead is amortized, small enough not to blow stack
  // on embedded targets.
  std::ifstream in(from, std::ios::binary);
  if (!in.is_open()) {
    throw std::runtime_error(std::string("copy: cannot open source ") + from);
  }
  std::ofstream out(to, std::ios::binary | std::ios::trunc);
  if (!out.is_open()) {
    throw std::runtime_error(std::string("copy: cannot open dest ") + to);
  }
  char buf[65536];
  while (in.good()) {
    in.read(buf, sizeof(buf));
    const auto n = in.gcount();
    if (n > 0)
      out.write(buf, n);
    if (!out) {
      throw std::runtime_error("copy: write failed");
    }
  }
}

void move(const std::string& from, const std::string& to) {
  if (rename(from.c_str(), to.c_str()) == 0)
    return;
  // EXDEV — across mount points; fall back to copy + delete.
  if (errno == EXDEV) {
    copy(from, to);
    if (unlink(from.c_str()) != 0) {
      throw std::runtime_error(std::string("move: post-copy unlink failed: ") +
                               std::strerror(errno));
    }
    return;
  }
  throw std::runtime_error(std::string("move: ") + std::strerror(errno));
}

// ─── statvfs (disk space) ─────────────────────────────────────────

namespace {

// Wrap statvfs once; both helpers want the same syscall. Returns
// false on any error (caller substitutes -1). f_frsize is the
// preferred multiplier per POSIX — f_bsize is the IO hint and is
// not always equal to the block size used in f_blocks counts.
bool statvfsFor(const std::string& path, struct statvfs& out) {
  return statvfs(path.c_str(), &out) == 0;
}

} // namespace

int64_t freeDiskBytes(const std::string& path) {
  struct statvfs s {};
  if (!statvfsFor(path, s))
    return -1;
  // f_bavail is "blocks free to unprivileged users" — the right
  // number for "how much can I write", as opposed to f_bfree which
  // includes root-reserved blocks an app process can't actually use.
  return static_cast<int64_t>(s.f_bavail) * static_cast<int64_t>(s.f_frsize);
}

int64_t totalDiskBytes(const std::string& path) {
  struct statvfs s {};
  if (!statvfsFor(path, s))
    return -1;
  return static_cast<int64_t>(s.f_blocks) * static_cast<int64_t>(s.f_frsize);
}

// ─── download (libsoup async) ─────────────────────────────────────

#ifdef RNL_FS_HAVE_SOUP

namespace {

SoupSession* sharedSession() {
  static SoupSession* s = nullptr;
  if (!s)
    s = soup_session_new();
  return s;
}

struct DownloadCtx {
  std::string url;
  std::string destPath;
  std::string handle;
  int64_t resumeFromBytes = 0;
  DownloadProgress onProgress;
  DownloadSuccess onSuccess;
  DownloadError onError;
  GCancellable* cancellable = nullptr;
};

// Active downloads keyed by handle so cancel can reach them. Lives
// for the duration of the libsoup hop; entries are erased in the
// success / error / cancel paths.
std::unordered_map<std::string, DownloadCtx*>& activeDownloads() {
  static std::unordered_map<std::string, DownloadCtx*> m;
  return m;
}

void finishCtx(DownloadCtx* ctx) {
  activeDownloads().erase(ctx->handle);
  if (ctx->cancellable)
    g_object_unref(ctx->cancellable);
  delete ctx;
}

void onSoupSendFinish(GObject* source, GAsyncResult* result, gpointer userData) {
  auto* ctx = static_cast<DownloadCtx*>(userData);
  GError* err = nullptr;
  GInputStream* body = soup_session_send_finish(SOUP_SESSION(source), result, &err);
  if (!body) {
    const bool cancelled = err && err->domain == G_IO_ERROR && err->code == G_IO_ERROR_CANCELLED;
    if (ctx->onError)
      ctx->onError(cancelled ? std::string{"cancelled"}
                             : std::string{err && err->message ? err->message : "download failed"});
    if (err)
      g_error_free(err);
    finishCtx(ctx);
    return;
  }
  // Pull Content-Length off the response so progress can report a
  // ratio. Servers may omit it on chunked transfer encodings, in
  // which case totalBytes stays -1 and consumers fall back to the
  // raw byte count.
  int64_t totalBytes = -1;
  if (SoupMessage* msg = soup_session_get_async_result_message(SOUP_SESSION(source), result)) {
    SoupMessageHeaders* respHeaders = soup_message_get_response_headers(msg);
    if (respHeaders) {
      const char* lenStr = soup_message_headers_get_one(respHeaders, "Content-Length");
      if (lenStr && *lenStr) {
        try {
          totalBytes = std::stoll(lenStr) + ctx->resumeFromBytes;
        } catch (...) {
        }
      }
    }
  }
  // Append on resume, truncate on fresh. Atomicity isn't possible
  // for partial downloads — that's why the caller passes resumeFrom.
  std::ios_base::openmode mode =
      std::ios::binary | (ctx->resumeFromBytes > 0 ? std::ios_base::openmode{std::ios::app}
                                                   : std::ios_base::openmode{std::ios::trunc});
  std::ofstream out(ctx->destPath, mode);
  if (!out.is_open()) {
    if (ctx->onError)
      ctx->onError(std::string("download: cannot open ") + ctx->destPath);
    g_object_unref(body);
    finishCtx(ctx);
    return;
  }
  // 256 KiB chunks — large enough that syscall overhead amortizes,
  // small enough to keep the JS thread responsive for multi-MB
  // downloads. Progress fires every ~200ms; tighter than that
  // floods JS for very fast transfers.
  int64_t bytesThisCall = 0;
  int64_t lastProgressBytes = 0;
  gint64 lastProgressUs = g_get_monotonic_time();
  char buf[256 * 1024];
  for (;;) {
    GError* readErr = nullptr;
    gssize n = g_input_stream_read(body, buf, sizeof(buf), ctx->cancellable, &readErr);
    if (n < 0) {
      const bool cancelled =
          readErr && readErr->domain == G_IO_ERROR && readErr->code == G_IO_ERROR_CANCELLED;
      if (ctx->onError)
        ctx->onError(cancelled ? std::string{"cancelled"}
                               : std::string{readErr && readErr->message ? readErr->message
                                                                         : "stream read error"});
      if (readErr)
        g_error_free(readErr);
      g_object_unref(body);
      finishCtx(ctx);
      return;
    }
    if (n == 0)
      break;
    out.write(buf, n);
    bytesThisCall += n;
    gint64 nowUs = g_get_monotonic_time();
    if (ctx->onProgress && (nowUs - lastProgressUs > 200000 || bytesThisCall == n)) {
      lastProgressUs = nowUs;
      lastProgressBytes = bytesThisCall;
      ctx->onProgress(ctx->resumeFromBytes + bytesThisCall, totalBytes);
    }
  }
  g_object_unref(body);
  // Final progress tick so consumers see the bytesWritten == total
  // edge even when the last chunk landed inside the throttle window.
  if (ctx->onProgress && bytesThisCall != lastProgressBytes) {
    ctx->onProgress(ctx->resumeFromBytes + bytesThisCall, totalBytes);
  }
  if (ctx->onSuccess)
    ctx->onSuccess(ctx->destPath, 200, bytesThisCall);
  finishCtx(ctx);
}

} // namespace

DownloadHandle download(const std::string& url,
                        const std::string& destPath,
                        const DownloadOptions& opts,
                        DownloadProgress onProgress,
                        DownloadSuccess onSuccess,
                        DownloadError onError) {
  SoupMessage* msg = soup_message_new("GET", url.c_str());
  if (!msg) {
    if (onError)
      onError("download: bad URL");
    return {};
  }
  // Resume via HTTP Range — `bytes=N-` asks for everything from N
  // through end. Servers that don't support ranges respond 200 with
  // the full body; we accept that since the file rewrite path
  // truncates anyway. Servers that do support it respond 206 with
  // just the remainder.
  if (opts.resumeFromBytes > 0) {
    SoupMessageHeaders* reqHeaders = soup_message_get_request_headers(msg);
    if (reqHeaders) {
      char rangeBuf[64];
      std::snprintf(rangeBuf, sizeof(rangeBuf), "bytes=%lld-", (long long)opts.resumeFromBytes);
      soup_message_headers_replace(reqHeaders, "Range", rangeBuf);
    }
  }
  // Build the handle off the SoupMessage pointer + a monotonic time
  // tick — unique enough that even rapid-fire concurrent downloads
  // get distinct ids without needing a global counter.
  static std::atomic<int64_t> nextSeq{1};
  char handleBuf[48];
  std::snprintf(handleBuf, sizeof(handleBuf), "dl-%lld", (long long)nextSeq.fetch_add(1));
  auto* ctx = new DownloadCtx{url,
                              destPath,
                              handleBuf,
                              opts.resumeFromBytes,
                              std::move(onProgress),
                              std::move(onSuccess),
                              std::move(onError),
                              g_cancellable_new()};
  activeDownloads()[ctx->handle] = ctx;
  soup_session_send_async(
      sharedSession(), msg, G_PRIORITY_DEFAULT, ctx->cancellable, onSoupSendFinish, ctx);
  g_object_unref(msg);
  return ctx->handle;
}

void downloadCancel(const DownloadHandle& handle) {
  auto it = activeDownloads().find(handle);
  if (it == activeDownloads().end())
    return;
  // g_cancellable_cancel is signal-safe and idempotent. The
  // onSoupSendFinish callback handles cleanup when the cancellation
  // propagates through the read loop.
  g_cancellable_cancel(it->second->cancellable);
}

// ─── uploads ──────────────────────────────────────────────────────

namespace {

struct UploadCtx {
  UploadSuccess onSuccess;
  UploadError onError;
};

void onUploadFinish(GObject* source, GAsyncResult* result, gpointer userData) {
  auto* ctx = static_cast<UploadCtx*>(userData);
  GError* err = nullptr;
  GBytes* body = soup_session_send_and_read_finish(SOUP_SESSION(source), result, &err);
  if (!body) {
    if (ctx->onError)
      ctx->onError(err && err->message ? err->message : "upload failed");
    if (err)
      g_error_free(err);
    delete ctx;
    return;
  }
  int status = 0;
  if (SoupMessage* msg = soup_session_get_async_result_message(SOUP_SESSION(source), result)) {
    status = soup_message_get_status(msg);
  }
  gsize len = 0;
  const void* data = g_bytes_get_data(body, &len);
  std::string respBody(static_cast<const char*>(data), len);
  g_bytes_unref(body);
  if (ctx->onSuccess)
    ctx->onSuccess(status, respBody);
  delete ctx;
}

void applyHeaders(SoupMessage* msg,
                  const std::vector<std::pair<std::string, std::string>>& headers) {
  if (!msg)
    return;
  SoupMessageHeaders* h = soup_message_get_request_headers(msg);
  if (!h)
    return;
  for (const auto& [name, value] : headers) {
    soup_message_headers_replace(h, name.c_str(), value.c_str());
  }
}

GBytes* readFileBytes(const std::string& path) {
  std::ifstream f(path, std::ios::binary | std::ios::ate);
  if (!f.is_open())
    return nullptr;
  const auto size = f.tellg();
  if (size < 0)
    return nullptr;
  std::string buf(static_cast<size_t>(size), '\0');
  f.seekg(0);
  f.read(buf.data(), size);
  // GBytes takes a copy; the std::string can drop after this returns.
  return g_bytes_new(buf.data(), buf.size());
}

} // namespace

void uploadMultipart(const std::string& url,
                     const std::string& method,
                     const std::vector<UploadField>& fields,
                     const std::vector<std::pair<std::string, std::string>>& headers,
                     UploadSuccess onSuccess,
                     UploadError onError) {
  const std::string m = method.empty() ? std::string{"POST"} : method;
  // SoupMultipart owns the boundary string and serializes the
  // body. `to_message` writes the parts into the message body and
  // sets the multipart/form-data; boundary= content-type header.
  SoupMultipart* mp = soup_multipart_new("multipart/form-data");
  if (!mp) {
    if (onError)
      onError("upload: soup_multipart_new failed");
    return;
  }
  for (const auto& field : fields) {
    if (!field.isFile) {
      // text/plain part with the field's bytes.
      GBytes* b = g_bytes_new(field.textValue.data(), field.textValue.size());
      soup_multipart_append_form_string(mp, field.name.c_str(), field.textValue.c_str());
      g_bytes_unref(b);
      continue;
    }
    GBytes* fileBytes = readFileBytes(field.filePath);
    if (!fileBytes) {
      soup_multipart_free(mp);
      if (onError)
        onError(std::string("upload: cannot read ") + field.filePath);
      return;
    }
    const std::string mime =
        field.mimeType.empty() ? std::string{"application/octet-stream"} : field.mimeType;
    soup_multipart_append_form_file(
        mp, field.name.c_str(), field.filename.c_str(), mime.c_str(), fileBytes);
    g_bytes_unref(fileBytes);
  }
  SoupMessage* msg = soup_message_new(m.c_str(), url.c_str());
  if (!msg) {
    soup_multipart_free(mp);
    if (onError)
      onError("upload: bad URL");
    return;
  }
  soup_multipart_to_message(mp, soup_message_get_request_headers(msg), nullptr);
  // Drop the multipart now that its bytes are in the message.
  // soup_multipart_to_message hands the body bytes over; freeing
  // here is correct.
  soup_multipart_free(mp);
  applyHeaders(msg, headers);
  auto* ctx = new UploadCtx{std::move(onSuccess), std::move(onError)};
  soup_session_send_and_read_async(
      sharedSession(), msg, G_PRIORITY_DEFAULT, nullptr, onUploadFinish, ctx);
  g_object_unref(msg);
}

void uploadBinary(const std::string& url,
                  const std::string& method,
                  const std::string& filePath,
                  const std::string& mimeType,
                  const std::vector<std::pair<std::string, std::string>>& headers,
                  UploadSuccess onSuccess,
                  UploadError onError) {
  const std::string m = method.empty() ? std::string{"POST"} : method;
  SoupMessage* msg = soup_message_new(m.c_str(), url.c_str());
  if (!msg) {
    if (onError)
      onError("upload: bad URL");
    return;
  }
  GBytes* fileBytes = readFileBytes(filePath);
  if (!fileBytes) {
    g_object_unref(msg);
    if (onError)
      onError(std::string("upload: cannot read ") + filePath);
    return;
  }
  const std::string ct = mimeType.empty() ? std::string{"application/octet-stream"} : mimeType;
  soup_message_set_request_body_from_bytes(msg, ct.c_str(), fileBytes);
  g_bytes_unref(fileBytes);
  applyHeaders(msg, headers);
  auto* ctx = new UploadCtx{std::move(onSuccess), std::move(onError)};
  soup_session_send_and_read_async(
      sharedSession(), msg, G_PRIORITY_DEFAULT, nullptr, onUploadFinish, ctx);
  g_object_unref(msg);
}

#else // !RNL_FS_HAVE_SOUP

DownloadHandle download(const std::string& /*url*/,
                        const std::string& /*destPath*/,
                        const DownloadOptions& /*opts*/,
                        DownloadProgress /*onProgress*/,
                        DownloadSuccess /*onSuccess*/,
                        DownloadError onError) {
  if (onError)
    onError("download: libsoup was not enabled at build time");
  return {};
}

void downloadCancel(const DownloadHandle& /*handle*/) {}

void uploadMultipart(const std::string&,
                     const std::string&,
                     const std::vector<UploadField>&,
                     const std::vector<std::pair<std::string, std::string>>&,
                     UploadSuccess,
                     UploadError onError) {
  if (onError)
    onError("upload: libsoup was not enabled at build time");
}

void uploadBinary(const std::string&,
                  const std::string&,
                  const std::string&,
                  const std::string&,
                  const std::vector<std::pair<std::string, std::string>>&,
                  UploadSuccess,
                  UploadError onError) {
  if (onError)
    onError("upload: libsoup was not enabled at build time");
}

#endif

} // namespace rnlinux::filesystem
