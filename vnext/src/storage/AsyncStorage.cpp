// Simple persistent key/value store for AsyncStorage. Keeps an
// in-memory unordered_map + writes the whole map back to a JSON
// file on every mutation. Fine at AsyncStorage scale (dozens of
// keys, kilobyte values); if an app stashes megabytes here we'd
// switch to a real sqlite or LMDB backend.
//
// File location: $XDG_CONFIG_HOME/<applicationId>/async-storage.json
// (defaults to ~/.config/<applicationId>/). `applicationId` is set
// at startup by RNLinuxApplication from the build-time RNL_APP_ID
// the CLI bakes in (docs/design-multi-instance.md Phase 2) — two
// installed apps get disjoint storage that way.
//
// The four entry points (declared as extern in RnLinuxBindings.cpp)
// are called from the rnLinux.storage* JSI bindings.
//
// Threading: the in-memory map is guarded by `storageMutex`. Reads
// hit the map directly from the calling thread (Hermes worker).
// Writes mark a dirty flag + notify the background save thread which
// snapshots the map + writes the JSON; multiple back-to-back writes
// within one save's duration coalesce into a single disk hit. That
// keeps the JS thread off `ofstream::write` (which can stall on
// fsync / journal flush under load) while preserving "writes survive
// process restarts" — pending saves drain on `flushAsyncStorage()`
// at host shutdown.

#include "react-native-linux/AppContext.h"
#include "react-native-linux/Logging.h"

#include <atomic>
#include <condition_variable>
#include <cstdlib>
#include <fstream>
#include <glib.h>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

namespace rnlinux {

namespace {

std::mutex& storageMutex() {
  static std::mutex m;
  return m;
}

std::unordered_map<std::string, std::string>& storageMap() {
  static std::unordered_map<std::string, std::string> m;
  return m;
}

std::string storagePath() {
  const std::string& appId = rnlinux::applicationId();
  const char* xdg = std::getenv("XDG_CONFIG_HOME");
  std::string dir;
  if (xdg && *xdg) {
    dir = std::string{xdg} + "/" + appId;
  } else if (const char* home = std::getenv("HOME"); home && *home) {
    dir = std::string{home} + "/.config/" + appId;
  } else {
    dir = "/tmp/" + appId;
  }
  g_mkdir_with_parents(dir.c_str(), 0700);
  return dir + "/async-storage.json";
}

// Minimal JSON encoder — escapes the six characters that matter for
// safety inside a string literal. We don't pretty-print; the file is
// always machine-written/read.
std::string escape(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 8);
  for (char c : s) {
    switch (c) {
    case '"':
      out += "\\\"";
      break;
    case '\\':
      out += "\\\\";
      break;
    case '\b':
      out += "\\b";
      break;
    case '\f':
      out += "\\f";
      break;
    case '\n':
      out += "\\n";
      break;
    case '\r':
      out += "\\r";
      break;
    case '\t':
      out += "\\t";
      break;
    default:
      if (static_cast<unsigned char>(c) < 0x20) {
        char buf[8];
        std::snprintf(buf, sizeof(buf), "\\u%04x", c);
        out += buf;
      } else {
        out += c;
      }
      break;
    }
  }
  return out;
}

// Pulls one string from a JSON stream starting at i. After the
// closing quote, i points at the character after. Returns the
// decoded contents.
std::string parseString(const std::string& src, size_t& i) {
  std::string out;
  ++i; // skip opening "
  while (i < src.size()) {
    char c = src[i++];
    if (c == '"')
      return out;
    if (c == '\\' && i < src.size()) {
      char e = src[i++];
      switch (e) {
      case '"':
        out += '"';
        break;
      case '\\':
        out += '\\';
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case 'u':
        // 4 hex digits → take as-is; we don't decode to UTF-8.
        i += 4;
        break;
      default:
        out += e;
        break;
      }
    } else {
      out += c;
    }
  }
  return out;
}

void load() {
  storageMap().clear();
  std::ifstream f{storagePath()};
  if (!f.good())
    return;
  std::stringstream ss;
  ss << f.rdbuf();
  const std::string src = ss.str();
  size_t i = 0;
  // Skip whitespace + leading '{'
  while (i < src.size() && std::isspace(static_cast<unsigned char>(src[i])))
    ++i;
  if (i >= src.size() || src[i] != '{')
    return;
  ++i;
  while (i < src.size()) {
    while (i < src.size() && std::isspace(static_cast<unsigned char>(src[i])))
      ++i;
    if (i >= src.size() || src[i] == '}')
      return;
    if (src[i] != '"')
      break;
    auto key = parseString(src, i);
    while (i < src.size() && (src[i] == ':' || std::isspace(static_cast<unsigned char>(src[i]))))
      ++i;
    if (i >= src.size() || src[i] != '"')
      break;
    auto value = parseString(src, i);
    storageMap()[key] = std::move(value);
    while (i < src.size() && (src[i] == ',' || std::isspace(static_cast<unsigned char>(src[i]))))
      ++i;
  }
}

// Serialize a snapshot of the map into a JSON string. Caller must
// hold storageMutex while building the snapshot; we release before
// the disk write so other writers don't pile up on the I/O.
std::string serializeLocked(const std::unordered_map<std::string, std::string>& map) {
  std::string out;
  out.reserve(map.size() * 64);
  out += "{";
  bool first = true;
  for (const auto& [k, v] : map) {
    if (!first)
      out += ",";
    first = false;
    out += "\"";
    out += escape(k);
    out += "\":\"";
    out += escape(v);
    out += "\"";
  }
  out += "}";
  return out;
}

void writeJson(const std::string& json) {
  const auto path = storagePath();
  const auto tmp = path + ".tmp";
  std::ofstream f{tmp, std::ios::trunc};
  if (!f.good()) {
    RNL_LOGW("AsyncStorage") << "failed to open " << tmp;
    return;
  }
  f.write(json.data(), json.size());
  f.close();
  // Atomic rename so a crash mid-write doesn't corrupt the file.
  std::rename(tmp.c_str(), path.c_str());
}

// Background save worker. Wakes on `saveCv_` when a write marks
// `saveDirty_`, snapshots the map under the mutex, writes the JSON
// to disk without the mutex held, and loops until `shutdown_`.
// Multiple writes during one save's disk I/O collapse into a single
// follow-up save (the dirty flag is set once and cleared once per
// cycle).
std::mutex saveMutex_;
std::condition_variable saveCv_;
std::atomic<bool> saveDirty_{false};
std::atomic<bool> saveShutdown_{false};
std::unique_ptr<std::thread> saveWorker_;

void saveLoop() {
  for (;;) {
    {
      std::unique_lock<std::mutex> g{saveMutex_};
      saveCv_.wait(g, [] { return saveDirty_.load() || saveShutdown_.load(); });
    }
    if (saveShutdown_.load() && !saveDirty_.exchange(false)) {
      return;
    }
    // Snapshot under the storage mutex; serialize without holding it
    // so concurrent reads don't pause for the encode pass.
    std::string json;
    {
      std::lock_guard<std::mutex> g{storageMutex()};
      saveDirty_.store(false);
      json = serializeLocked(storageMap());
    }
    writeJson(json);
    if (saveShutdown_.load() && !saveDirty_.load()) {
      return;
    }
  }
}

void ensureWorker() {
  static std::once_flag once;
  std::call_once(once, [] { saveWorker_ = std::make_unique<std::thread>(saveLoop); });
}

// Schedule a save — sets the dirty flag and wakes the worker.
// Idempotent within one save cycle (the worker clears the flag once
// it snapshots, so back-to-back writes coalesce).
void scheduleSave() {
  ensureWorker();
  saveDirty_.store(true);
  saveCv_.notify_one();
}

bool loaded = false;
void ensureLoaded() {
  if (!loaded) {
    load();
    loaded = true;
  }
}

} // namespace

// External entry points used by RnLinuxBindings.cpp's
// `extern std::string asyncStorageRead(...)` declarations. They live
// in the rnlinux:: namespace because the bindings call them with the
// fully-qualified name; the file as a whole lives inside the
// rnlinux namespace (see the matching close-brace below).

// Off-thread cold-start hydration. Called by RNLinuxApplication
// right after `setApplicationId` (i.e. as early as we have a stable
// storage path) so the JSON file is parsed before JS asks for its
// first key. JS reads still serialise through `storageMutex()` via
// `ensureLoaded()` — if a read races this thread mid-parse, it
// waits on the mutex and then sees `loaded == true`, so the load
// itself only runs once.
//
// Detached: the worker dies on its own as soon as it releases the
// mutex. There's no shutdown path to drain — the load is a one-shot
// that completes long before any process-exit hook needs to act on
// it.
void prewarmAsyncStorage() {
  std::thread([] {
    std::lock_guard<std::mutex> g{storageMutex()};
    if (!loaded) {
      load();
      loaded = true;
    }
  }).detach();
}

// Drain any pending save and stop the background thread. Called by
// the host on shutdown so an `exit()` right after a write doesn't
// lose the still-in-flight save.
void flushAsyncStorage() {
  if (!saveWorker_) {
    return;
  }
  saveShutdown_.store(true);
  saveCv_.notify_one();
  if (saveWorker_->joinable()) {
    saveWorker_->join();
  }
  saveWorker_.reset();
}

std::string asyncStorageRead(const std::string& key) {
  std::lock_guard<std::mutex> g{storageMutex()};
  ensureLoaded();
  auto it = storageMap().find(key);
  return it == storageMap().end() ? std::string{} : it->second;
}

void asyncStorageWrite(const std::string& key, const std::string& value) {
  {
    std::lock_guard<std::mutex> g{storageMutex()};
    ensureLoaded();
    storageMap()[key] = value;
  }
  scheduleSave();
}

void asyncStorageRemove(const std::string& key) {
  {
    std::lock_guard<std::mutex> g{storageMutex()};
    ensureLoaded();
    storageMap().erase(key);
  }
  scheduleSave();
}

std::vector<std::string> asyncStorageKeys() {
  std::lock_guard<std::mutex> g{storageMutex()};
  ensureLoaded();
  std::vector<std::string> out;
  out.reserve(storageMap().size());
  for (const auto& [k, _] : storageMap()) {
    out.push_back(k);
  }
  return out;
}

} // namespace rnlinux
