#pragma once

// libsecret-backed `expo-secure-store` storage. Talks to whichever
// secret service is providing org.freedesktop.secrets on the
// session bus — gnome-keyring-daemon, kwallet, KeePassXC, or any
// SecretService spec implementation. The user's keyring handles
// encryption, locking, and on-disk persistence; we just key into
// the "default" collection (login keyring) with a stable schema +
// one attribute called "name" carrying the JS-supplied key.
//
// If the default collection doesn't exist (headless sessions
// without a desktop wizard, fresh Lima VMs, CI runners) we fall
// back to the always-present in-memory "session" collection. That
// gives the same API contract within an app's lifetime; persistence
// across restarts then becomes the user's setup problem, not ours.

#include <optional>
#include <string>

namespace rnlinux::securestore {

// True if the secret service well-known name is currently owned on
// the session bus. Same semantics as expo's isAvailableAsync.
bool isAvailable();

// Store / read / delete a string value keyed by `key`. All three
// are synchronous wrappers over libsecret's *_sync variants; the
// JS shim wraps them in Promise.resolve to preserve the upstream
// async signature. Throws std::runtime_error on hard failures so
// the JSI binding can translate into a rejected Promise.
void setItem(const std::string& key, const std::string& value);
std::optional<std::string> getItem(const std::string& key);
void deleteItem(const std::string& key);

} // namespace rnlinux::securestore
