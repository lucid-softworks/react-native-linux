# Real-app harness: expo-secure-store via libsecret

`expo-secure-store` writes encrypted credentials to the user's
keyring through libsecret. libsecret talks to whichever daemon
implements the freedesktop `org.freedesktop.secrets` spec —
gnome-keyring-daemon, kwallet, KeePassXC, etc. The daemon owns
encryption, locking, and on-disk persistence; we just key into the
default ("login") collection with a stable schema.

## Architecture

```
JS app
  ↓ require('expo-secure-store')   ← metro/esbuild rewrite, linux only
@lucid-softworks/react-native-linux-expo/expo-secure-store.js
  ├─ setItemAsync(key, value)      →  rnLinux.secureStoreSetItem
  ├─ getItemAsync(key)             →  rnLinux.secureStoreGetItem
  ├─ deleteItemAsync(key)          →  rnLinux.secureStoreDeleteItem
  └─ isAvailableAsync()            →  rnLinux.secureStoreIsAvailable
  ↓
vnext/src/jsi/RnLinuxBindings.cpp                ← JSI bindings
  ↓
vnext/src/securestore/SecureStore.cpp            ← libsecret wrapper
  ↓
libsecret  →  org.freedesktop.secrets (session bus)
           →  gnome-keyring-daemon / kwallet / KeePassXC / …
                                                ↓
                                          encrypted ~/.local/share/keyrings/
                                          (or wallet equivalent)
```

The schema id is fixed at `works.lucidsoft.RNLinuxPlayground.SecureStore`
with one string attribute (`name`) carrying the JS-supplied key.
Don't change it — every previously-stored value still lives in the
keyring but our lookup would stop finding it.

## VM / host setup

```sh
sudo apt install -y libsecret-1-dev libsecret-tools gnome-keyring
```

Then ensure a secret service is owning `org.freedesktop.secrets` on
the session bus. Desktop sessions usually start gnome-keyring-daemon
through `pam_gnome_keyring.so` on login. Bare sessions need it
spawned manually:

```sh
eval "$(gnome-keyring-daemon --start --components=secrets,pkcs11 < /dev/null)"
export GNOME_KEYRING_CONTROL SSH_AUTH_SOCK
```

(or `dbus-update-activation-environment --systemd GNOME_KEYRING_CONTROL SSH_AUTH_SOCK`
to make sure session-bus-activated children inherit it.)

In a fresh session with no "login" collection set up, libsecret
errors when storing to the default alias. Our C++ side falls back
transparently to the always-present in-memory **session** collection
— the round-trip works, but values are lost when the daemon
restarts. Real desktops with a proper login keyring get full
on-disk persistence with the daemon's encryption.

## Running the smoke demo

```sh
cd apps/playground
RN_ENTRY=smoke-demo.tsx node bundle.mjs
scripts/vm/sh.sh 'scripts/vm/run-playground.sh'
```

The expo-secure-store section auto-runs on mount: writes a random
token, reads it back, deletes it, reads again, reports
`set+get matched (yes), after-delete=null` on success.

## API surface

| API                               | Behavior on Linux                                                      |
| --------------------------------- | ---------------------------------------------------------------------- |
| `isAvailableAsync()`              | Real — checks if `org.freedesktop.secrets` is owned on the session bus |
| `setItemAsync(key, value)` / sync | Real — `secret_password_store_sync`; falls back to session collection  |
| `getItemAsync(key)` / sync        | Real — `secret_password_lookup_sync`; returns `null` for missing       |
| `deleteItemAsync(key)` / sync     | Real — `secret_password_clear_sync`; idempotent                        |
| `options.keychainService`         | Accepted, discarded — iOS-only entry grouping                          |
| `options.keychainAccessible`      | Accepted, discarded — locking is daemon-controlled, not per-call       |
| `options.requireAuthentication`   | Accepted, discarded — daemon decides whether to prompt                 |
| `canUseBiometricAuthentication()` | Returns `false` — no portable biometric API across keyring daemons     |
| `WHEN_UNLOCKED` etc. constants    | Exported as strings; cross-platform code branching on them still works |

## Known gaps

- **Login collection auto-creation.** When no default collection
  exists we silently fall back to the session collection (lost on
  daemon restart). Production apps want persistent storage; the
  proper fix is to create a default collection ourselves on first
  call via `secret_collection_create_sync`. Skipped for the smoke
  demo because the UX for unlocking a freshly-created collection
  prompts the user, which doesn't make sense for an app's local
  storage.
- **Biometric / passcode prompts.** Some daemons (KWallet) can ask
  via PAM, but no portable API exists across daemons.
  `canUseBiometricAuthentication` returns `false` so cross-platform
  code that gates on it skips the biometric path.
- **Multiple keychain services.** iOS's `keychainService` option
  groups entries under a Keychain Sharing identifier; on Linux,
  entries are global to the keyring per-schema. If two app builds
  need isolated storage, they'd need to use different schema ids
  (compile-time constant in our code, not yet runtime-configurable).
- **Sync variant signatures.** Some SDK versions of
  expo-secure-store have `setItem`/`getItem` returning `void`,
  others return `Promise<void>`. We follow the older `void` shape
  since the native side is already sync.
