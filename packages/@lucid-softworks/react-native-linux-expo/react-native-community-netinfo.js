'use strict';

// Shim for `@react-native-community/netinfo`. Wraps the same
// GNetworkMonitor-backed plumbing our expo-network shim uses; just
// reshapes the snapshot into netinfo's `NetInfoState` and reuses
// the listener fan-out so a single GNetworkMonitor subscription
// serves both shims.

const expoNetwork = require('./expo-network');

const NetInfoStateType = {
  unknown: 'unknown',
  none: 'none',
  cellular: 'cellular',
  wifi: 'wifi',
  bluetooth: 'bluetooth',
  ethernet: 'ethernet',
  wimax: 'wimax',
  vpn: 'vpn',
  other: 'other',
};

const NetInfoCellularGeneration = {
  '2g': '2g',
  '3g': '3g',
  '4g': '4g',
  '5g': '5g',
};

// expo-network types are uppercase ('ETHERNET'); netinfo uses
// lowercase. Translate at the boundary.
function _typeToNetInfo(t) {
  if (!t) return NetInfoStateType.unknown;
  const low = String(t).toLowerCase();
  return NetInfoStateType[low] || NetInfoStateType.unknown;
}

function _toNetInfoState(snap) {
  const type = _typeToNetInfo(snap.type);
  const isConnected = Boolean(snap.isConnected);
  const isInternetReachable =
    snap.isInternetReachable == null ? null : Boolean(snap.isInternetReachable);
  // netinfo nests connection details inside `details` only when
  // connected; unknown/none states get `details: null`. Wifi has
  // ssid/strength fields we can't surface on Linux (no portable
  // way to read SSID without NetworkManager DBus), so we leave
  // them undefined.
  let details = null;
  if (isConnected) {
    details = {
      isConnectionExpensive: false,
      ipAddress: snap.ipAddress || null,
      // netinfo wifi state shape includes `frequency`, `linkSpeed`,
      // `rxLinkSpeed`, `txLinkSpeed`, `bssid`, `ssid`, `strength` —
      // all undefined here.
    };
  }
  return {
    type,
    isConnected,
    isInternetReachable,
    isWifiEnabled: type === NetInfoStateType.wifi,
    details,
  };
}

// netinfo's API is module-level, not class-based. Maintain one
// in-process configuration + one subscription chain to the
// underlying expo-network listener so we don't double-register
// against the native GNetworkMonitor.
let _config = {
  reachabilityUrl: 'https://clients3.google.com/generate_204',
  reachabilityTest: () => Promise.resolve(true),
  reachabilityRequestTimeout: 15 * 1000,
  reachabilityShortTimeout: 5 * 1000,
  reachabilityLongTimeout: 60 * 1000,
  useNativeReachability: true,
};

function configure(configuration) {
  _config = {..._config, ...(configuration || {})};
}

async function fetch(_requestedInterface) {
  const snap = await expoNetwork.getNetworkStateAsync();
  return _toNetInfoState(snap);
}

async function refresh() {
  return fetch();
}

function addEventListener(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('addEventListener: listener must be a function');
  }
  // Mirror netinfo's contract: fire once immediately with the
  // current state, then on every change.
  fetch().then(state => {
    try {
      listener(state);
    } catch (_) {}
  });
  const sub = expoNetwork.addNetworkStateListener(snap => {
    try {
      listener(_toNetInfoState(snap));
    } catch (_) {}
  });
  return () => sub.remove();
}

// Shared cached state — getSnapshot returns the same reference
// between changes so React's bail-out fires correctly. The
// `addEventListener` machinery fires once on subscribe (initial
// reading) and then on each network change.
const _defaultNetInfoState = {
  type: NetInfoStateType.unknown,
  isConnected: null,
  isInternetReachable: null,
  details: null,
};
let _cachedNetInfoState = _defaultNetInfoState;

function _niSubscribe(cb) {
  const unsubscribe = addEventListener(state => {
    _cachedNetInfoState = state;
    cb();
  });
  return unsubscribe;
}
function _niGetSnapshot() {
  return _cachedNetInfoState;
}
function useNetInfo(_configuration) {
  const React = require('react');
  return React.useSyncExternalStore(_niSubscribe, _niGetSnapshot, _niGetSnapshot);
}

function useNetInfoInstance(isPaused, _configuration) {
  const React = require('react');
  // Pause control means subscription comes and goes — drop the cb
  // when paused so the snapshot freezes on the last known value.
  const subscribe = React.useCallback(
    cb => {
      if (isPaused) return () => {};
      return _niSubscribe(cb);
    },
    [isPaused],
  );
  const state = React.useSyncExternalStore(subscribe, _niGetSnapshot, _niGetSnapshot);
  const refreshFn = React.useCallback(
    () =>
      fetch().then(s => {
        _cachedNetInfoState = s;
        return s;
      }),
    [],
  );
  return {netInfo: state, refresh: refreshFn};
}

const api = {
  NetInfoStateType,
  NetInfoCellularGeneration,
  configure,
  fetch,
  refresh,
  addEventListener,
  useNetInfo,
  useNetInfoInstance,
};

module.exports = api;
module.exports.default = api;
