'use strict';

// Shim for `expo-keep-awake`. Backed by systemd-logind's
// Manager.Inhibit on the system bus (vnext/src/keepawake/*). Per-
// tag map so multiple overlapping inhibitors release
// independently. logind is available on basically every systemd
// install — Ubuntu/Debian/Fedora/Arch all ship it — and it
// outranks the session-bus screen-saver services that only run
// inside a desktop session.

const React = require('react');

const _hasNative =
  typeof rnLinux !== 'undefined' && typeof rnLinux.keepAwakeActivate === 'function';

const ExpoKeepAwakeTag = 'ExpoKeepAwakeDefaultTag';

async function isAvailableAsync() {
  return _hasNative && Boolean(rnLinux.keepAwakeIsAvailable());
}

async function activateKeepAwakeAsync(tag = ExpoKeepAwakeTag, options) {
  if (!_hasNative) return;
  const reason = (options && options.reason) || 'expo-keep-awake';
  rnLinux.keepAwakeActivate(String(tag), reason);
}

function deactivateKeepAwake(tag = ExpoKeepAwakeTag) {
  if (!_hasNative) return;
  rnLinux.keepAwakeDeactivate(String(tag));
}

// Sync variant — older SDK versions. The native side is sync
// anyway.
function activateKeepAwake(tag = ExpoKeepAwakeTag) {
  if (!_hasNative) return;
  rnLinux.keepAwakeActivate(String(tag), 'expo-keep-awake');
}

// React hook — activate on mount, release on unmount. Matches
// upstream's signature; the tag falls through to the C++ side so
// concurrent `useKeepAwake('foo')` and `useKeepAwake('bar')`
// register independently.
function useKeepAwake(tag = ExpoKeepAwakeTag, options) {
  React.useEffect(() => {
    if (!_hasNative) return undefined;
    const reason = (options && options.reason) || 'expo-keep-awake hook';
    rnLinux.keepAwakeActivate(String(tag), reason);
    return () => rnLinux.keepAwakeDeactivate(String(tag));
  }, [tag, options && options.reason]);
}

const api = {
  ExpoKeepAwakeTag,
  isAvailableAsync,
  activateKeepAwakeAsync,
  activateKeepAwake,
  deactivateKeepAwake,
  useKeepAwake,
};

module.exports = api;
module.exports.default = api;
