// Simple persistent key/value store for AsyncStorage. Keeps an
// in-memory unordered_map + writes the whole map back to a JSON
// file on every mutation. Fine at AsyncStorage scale (dozens of
// keys, kilobyte values); if an app stashes megabytes here we'd
// switch to a real sqlite or LMDB backend.
//
// File location: $XDG_CONFIG_HOME/react-native-linux/async-storage.json
// (defaults to ~/.config/react-native-linux/).
//
// The four entry points (declared as extern in RnLinuxBindings.cpp)
// are called from the rnLinux.storage* JSI bindings.

#include "react-native-linux/Logging.h"

#include <glib.h>

#include <cstdlib>
#include <fstream>
#include <mutex>
#include <sstream>
#include <string>
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
  const char* xdg = std::getenv("XDG_CONFIG_HOME");
  std::string dir;
  if (xdg && *xdg) {
    dir = std::string{xdg} + "/react-native-linux";
  } else if (const char* home = std::getenv("HOME"); home && *home) {
    dir = std::string{home} + "/.config/react-native-linux";
  } else {
    dir = "/tmp/react-native-linux";
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
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b";  break;
      case '\f': out += "\\f";  break;
      case '\n': out += "\\n";  break;
      case '\r': out += "\\r";  break;
      case '\t': out += "\\t";  break;
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
  ++i;  // skip opening "
  while (i < src.size()) {
    char c = src[i++];
    if (c == '"') return out;
    if (c == '\\' && i < src.size()) {
      char e = src[i++];
      switch (e) {
        case '"':  out += '"';  break;
        case '\\': out += '\\'; break;
        case 'n':  out += '\n'; break;
        case 'r':  out += '\r'; break;
        case 't':  out += '\t'; break;
        case 'b':  out += '\b'; break;
        case 'f':  out += '\f'; break;
        case 'u':
          // 4 hex digits → take as-is; we don't decode to UTF-8.
          i += 4;
          break;
        default:   out += e; break;
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
  if (!f.good()) return;
  std::stringstream ss;
  ss << f.rdbuf();
  const std::string src = ss.str();
  size_t i = 0;
  // Skip whitespace + leading '{'
  while (i < src.size() && std::isspace(static_cast<unsigned char>(src[i]))) ++i;
  if (i >= src.size() || src[i] != '{') return;
  ++i;
  while (i < src.size()) {
    while (i < src.size() && std::isspace(static_cast<unsigned char>(src[i]))) ++i;
    if (i >= src.size() || src[i] == '}') return;
    if (src[i] != '"') break;
    auto key = parseString(src, i);
    while (i < src.size() && (src[i] == ':' || std::isspace(static_cast<unsigned char>(src[i])))) ++i;
    if (i >= src.size() || src[i] != '"') break;
    auto value = parseString(src, i);
    storageMap()[key] = std::move(value);
    while (i < src.size() && (src[i] == ',' || std::isspace(static_cast<unsigned char>(src[i])))) ++i;
  }
}

void save() {
  const auto path = storagePath();
  const auto tmp = path + ".tmp";
  std::ofstream f{tmp, std::ios::trunc};
  if (!f.good()) {
    RNL_LOGW("AsyncStorage") << "failed to open " << tmp;
    return;
  }
  f << "{";
  bool first = true;
  for (const auto& [k, v] : storageMap()) {
    if (!first) f << ",";
    first = false;
    f << "\"" << escape(k) << "\":\"" << escape(v) << "\"";
  }
  f << "}";
  f.close();
  // Atomic rename so a crash mid-write doesn't corrupt the file.
  std::rename(tmp.c_str(), path.c_str());
}

bool loaded = false;
void ensureLoaded() {
  if (!loaded) {
    load();
    loaded = true;
  }
}

}  // namespace

// External entry points used by RnLinuxBindings.cpp's
// `extern std::string asyncStorageRead(...)` declarations. They're
// in the rnlinux:: namespace because the bindings call them with
// the fully-qualified name; the file as a whole lives inside the
// rnlinux namespace (see the matching close-brace below).

std::string asyncStorageRead(const std::string& key) {
  std::lock_guard<std::mutex> g{storageMutex()};
  ensureLoaded();
  auto it = storageMap().find(key);
  return it == storageMap().end() ? std::string{} : it->second;
}

void asyncStorageWrite(const std::string& key, const std::string& value) {
  std::lock_guard<std::mutex> g{storageMutex()};
  ensureLoaded();
  storageMap()[key] = value;
  save();
}

void asyncStorageRemove(const std::string& key) {
  std::lock_guard<std::mutex> g{storageMutex()};
  ensureLoaded();
  storageMap().erase(key);
  save();
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

}  // namespace rnlinux
