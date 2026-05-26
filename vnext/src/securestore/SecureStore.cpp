#include "SecureStore.h"

#include "react-native-linux/Logging.h"

#include <gio/gio.h>
#include <libsecret/secret.h>
#include <stdexcept>

namespace rnlinux::securestore {

namespace {

// Stable schema id — libsecret uses this string to match entries
// across runs of the app. Keep it permanent: changing it orphans
// every previously-stored value (they still live in the keyring
// but our lookup won't find them).
const SecretSchema* getSchema() {
  static SecretSchema schema{
      "works.lucidsoft.RNLinuxPlayground.SecureStore",
      SECRET_SCHEMA_NONE,
      {
          {"name", SECRET_SCHEMA_ATTRIBUTE_STRING},
          {nullptr, static_cast<SecretSchemaAttributeType>(0)},
      },
      // Reserved padding fields — zero them so future libsecret
      // versions that look at these don't trip over uninitialized
      // memory.
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
  };
  return &schema;
}

// The default ("login") collection often doesn't exist on headless
// or fresh sessions. We let libsecret pick it first (real
// persistent storage on a typical desktop) and fall back to the
// always-present in-memory SESSION collection so the round-trip
// still works on Lima dev VMs / CI.
const char* primaryCollection() {
  return SECRET_COLLECTION_DEFAULT;
}
const char* fallbackCollection() {
  return SECRET_COLLECTION_SESSION;
}

} // namespace

bool isAvailable() {
  GError* err = nullptr;
  GDBusConnection* bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &err);
  if (!bus) {
    if (err)
      g_error_free(err);
    return false;
  }
  GVariant* reply = g_dbus_connection_call_sync(bus,
                                                "org.freedesktop.DBus",
                                                "/org/freedesktop/DBus",
                                                "org.freedesktop.DBus",
                                                "NameHasOwner",
                                                g_variant_new("(s)", "org.freedesktop.secrets"),
                                                G_VARIANT_TYPE("(b)"),
                                                G_DBUS_CALL_FLAGS_NONE,
                                                500,
                                                nullptr,
                                                &err);
  bool owned = false;
  if (reply) {
    gboolean v = FALSE;
    g_variant_get(reply, "(b)", &v);
    owned = v;
    g_variant_unref(reply);
  }
  if (err)
    g_error_free(err);
  g_object_unref(bus);
  return owned;
}

void setItem(const std::string& key, const std::string& value) {
  // Try the default collection first, then session. The DEFAULT
  // alias resolves at the daemon side, so we can't always know up
  // front whether it'll work — running it and observing the error
  // is cheaper than introspecting collections first.
  GError* err = nullptr;
  gboolean ok = secret_password_store_sync(getSchema(),
                                           primaryCollection(),
                                           /*label=*/("rn-linux-secure-store: " + key).c_str(),
                                           value.c_str(),
                                           /*cancellable=*/nullptr,
                                           &err,
                                           "name",
                                           key.c_str(),
                                           nullptr);
  if (!ok) {
    if (err)
      g_error_free(err);
    err = nullptr;
    ok = secret_password_store_sync(getSchema(),
                                    fallbackCollection(),
                                    ("rn-linux-secure-store: " + key).c_str(),
                                    value.c_str(),
                                    nullptr,
                                    &err,
                                    "name",
                                    key.c_str(),
                                    nullptr);
  }
  if (!ok) {
    std::string msg = err && err->message ? err->message : "secret_password_store_sync failed";
    if (err)
      g_error_free(err);
    throw std::runtime_error(msg);
  }
}

std::optional<std::string> getItem(const std::string& key) {
  GError* err = nullptr;
  gchar* raw = secret_password_lookup_sync(getSchema(),
                                           /*cancellable=*/nullptr,
                                           &err,
                                           "name",
                                           key.c_str(),
                                           nullptr);
  if (err) {
    std::string msg = err->message ? err->message : "secret_password_lookup_sync failed";
    g_error_free(err);
    throw std::runtime_error(msg);
  }
  if (!raw)
    return std::nullopt;
  std::string out(raw);
  secret_password_free(raw);
  return out;
}

void deleteItem(const std::string& key) {
  GError* err = nullptr;
  // Returns FALSE both when nothing matches AND when something
  // matches and was removed — the distinguishing test is `err`.
  // Treat both "removed" and "didn't exist" as success since
  // deleteItemAsync is idempotent in the upstream contract.
  secret_password_clear_sync(getSchema(),
                             /*cancellable=*/nullptr,
                             &err,
                             "name",
                             key.c_str(),
                             nullptr);
  if (err) {
    std::string msg = err->message ? err->message : "secret_password_clear_sync failed";
    g_error_free(err);
    throw std::runtime_error(msg);
  }
}

} // namespace rnlinux::securestore
