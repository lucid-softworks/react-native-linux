#include "FileSystem.h"

#include "react-native-linux/Logging.h"

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
#include <sys/types.h>
#include <unistd.h>

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
  struct stat st{};
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
  struct stat st{};
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
  struct stat st{};
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
  struct stat st{};
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

// ─── download (libsoup async) ─────────────────────────────────────

#ifdef RNL_FS_HAVE_SOUP

namespace {

struct DownloadCtx {
  std::string url;
  std::string destPath;
  DownloadSuccess onSuccess;
  DownloadError onError;
};

void onSoupSendFinish(GObject* source, GAsyncResult* result, gpointer userData) {
  auto* ctx = static_cast<DownloadCtx*>(userData);
  GError* err = nullptr;
  GInputStream* body = soup_session_send_finish(SOUP_SESSION(source), result, &err);
  if (!body) {
    if (ctx->onError)
      ctx->onError(err && err->message ? err->message : "download failed");
    if (err)
      g_error_free(err);
    delete ctx;
    return;
  }
  // Drain the body to disk synchronously here — we're already on
  // the GMainContext, libsoup hands us the open InputStream. For
  // large downloads we could do this in a worker thread; cap is
  // 256 KB chunks which keeps the JS thread responsive for typical
  // app downloads (a few MB).
  std::ofstream out(ctx->destPath, std::ios::binary | std::ios::trunc);
  if (!out.is_open()) {
    if (ctx->onError)
      ctx->onError(std::string("download: cannot open ") + ctx->destPath);
    g_object_unref(body);
    delete ctx;
    return;
  }
  int64_t total = 0;
  char buf[256 * 1024];
  for (;;) {
    GError* readErr = nullptr;
    gssize n = g_input_stream_read(body, buf, sizeof(buf), nullptr, &readErr);
    if (n < 0) {
      if (ctx->onError)
        ctx->onError(readErr && readErr->message ? readErr->message : "stream read error");
      if (readErr)
        g_error_free(readErr);
      g_object_unref(body);
      delete ctx;
      return;
    }
    if (n == 0)
      break;
    out.write(buf, n);
    total += n;
  }
  g_object_unref(body);
  if (ctx->onSuccess)
    ctx->onSuccess(ctx->destPath, 200, total);
  delete ctx;
}

} // namespace

void download(const std::string& url,
              const std::string& destPath,
              DownloadSuccess onSuccess,
              DownloadError onError) {
  static SoupSession* session = nullptr;
  if (!session) {
    session = soup_session_new();
  }
  SoupMessage* msg = soup_message_new("GET", url.c_str());
  if (!msg) {
    if (onError)
      onError("download: bad URL");
    return;
  }
  auto* ctx = new DownloadCtx{url, destPath, std::move(onSuccess), std::move(onError)};
  soup_session_send_async(session, msg, G_PRIORITY_DEFAULT, nullptr, onSoupSendFinish, ctx);
  g_object_unref(msg);
}

#else // !RNL_FS_HAVE_SOUP

void download(const std::string& /*url*/,
              const std::string& /*destPath*/,
              DownloadSuccess /*onSuccess*/,
              DownloadError onError) {
  if (onError)
    onError("download: libsoup was not enabled at build time");
}

#endif

} // namespace rnlinux::filesystem
