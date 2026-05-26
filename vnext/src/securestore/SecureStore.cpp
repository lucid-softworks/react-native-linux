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
  // Two attributes: "name" (the JS key) and "service" (the
  // keychainService scope; empty string for the unscoped default).
  // libsecret with SECRET_SCHEMA_NONE matches on every attribute we
  // pass at lookup time.
  static SecretSchema schema{
      "works.lucidsoft.RNLinuxPlayground.SecureStore",
      SECRET_SCHEMA_NONE,
      {
          {"name", SECRET_SCHEMA_ATTRIBUTE_STRING},
          {"service", SECRET_SCHEMA_ATTRIBUTE_STRING},
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
// or fresh sessions. We try it first (real persistent storage on a
// typical desktop) and, if missing, attempt to create one so the
// app gets durable storage instead of silently falling back to the
// always-present in-memory SESSION collection.
const char* primaryCollection() {
  return SECRET_COLLECTION_DEFAULT;
}
const char* fallbackCollection() {
  return SECRET_COLLECTION_SESSION;
}

// Lazily create the default collection on first failed store. The
// keyring daemon prompts the user for a master password when the
// collection is born — that's fine for production apps (one
// prompt the first time) but the fallback to SESSION means CI /
// headless VMs aren't blocked when the prompt can't be answered.
// Returns true if the collection now exists (newly created or
// already there); false on hard failures the caller should
// surface.
bool ensureDefaultCollection() {
  static bool tried = false;
  if (tried)
    return false; // don't re-prompt on every store
  tried = true;
  GError* err = nullptr;
  SecretService* service = secret_service_get_sync(SECRET_SERVICE_NONE, nullptr, &err);
  if (!service) {
    if (err)
      g_error_free(err);
    return false;
  }
  // `default` is the well-known alias the freedesktop spec
  // reserves for the user's primary keyring. Most desktops also
  // alias `login` to the same collection (so gnome-keyring auto-
  // unlocks at login); we don't need to bother with that here.
  SecretCollection* col = secret_collection_create_sync(
      service, "Login", "default", SECRET_COLLECTION_CREATE_NONE, nullptr, &err);
  g_object_unref(service);
  if (err) {
    RNL_LOGW("rnLinux.securestore") << "default collection create failed: " << err->message;
    g_error_free(err);
    return false;
  }
  if (col) {
    g_object_unref(col);
    return true;
  }
  return false;
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

namespace {

// Compose the entry label shown in keyring browsers (seahorse,
// kwalletmanager). The scope makes it obvious which app+service
// owns an entry without having to inspect attributes.
std::string makeLabel(const std::string& key, const std::string& service) {
  if (service.empty())
    return "rn-linux-secure-store: " + key;
  return "rn-linux-secure-store [" + service + "]: " + key;
}

gboolean storeIn(const char* collection,
                 const std::string& key,
                 const std::string& value,
                 const std::string& service,
                 const std::string& label,
                 GError** err) {
  return secret_password_store_sync(getSchema(),
                                    collection,
                                    label.c_str(),
                                    value.c_str(),
                                    /*cancellable=*/nullptr,
                                    err,
                                    "name",
                                    key.c_str(),
                                    "service",
                                    service.c_str(),
                                    nullptr);
}

} // namespace

void setItem(const std::string& key, const std::string& value, const std::string& service) {
  // Try the default collection first. If the daemon reports it
  // doesn't exist (fresh user account, no auto-created keyring),
  // attempt to create one and retry — that lands the entry in
  // durable storage instead of the in-memory session collection
  // that we'd otherwise fall back to. On CI/headless boxes where
  // the create prompt can't be answered, the create fails and we
  // hit the session fallback below.
  GError* err = nullptr;
  const std::string label = makeLabel(key, service);
  gboolean ok = storeIn(primaryCollection(), key, value, service, label, &err);
  if (!ok) {
    if (err)
      g_error_free(err);
    err = nullptr;
    if (ensureDefaultCollection()) {
      ok = storeIn(primaryCollection(), key, value, service, label, &err);
    }
  }
  if (!ok) {
    if (err)
      g_error_free(err);
    err = nullptr;
    ok = storeIn(fallbackCollection(), key, value, service, label, &err);
  }
  if (!ok) {
    std::string msg = err && err->message ? err->message : "secret_password_store_sync failed";
    if (err)
      g_error_free(err);
    throw std::runtime_error(msg);
  }
}

std::optional<std::string> getItem(const std::string& key, const std::string& service) {
  GError* err = nullptr;
  gchar* raw = secret_password_lookup_sync(getSchema(),
                                           /*cancellable=*/nullptr,
                                           &err,
                                           "name",
                                           key.c_str(),
                                           "service",
                                           service.c_str(),
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

void deleteItem(const std::string& key, const std::string& service) {
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
                             "service",
                             service.c_str(),
                             nullptr);
  if (err) {
    std::string msg = err->message ? err->message : "secret_password_clear_sync failed";
    g_error_free(err);
    throw std::runtime_error(msg);
  }
}

} // namespace rnlinux::securestore
