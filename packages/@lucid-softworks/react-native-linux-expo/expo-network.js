'use strict';

// Shim for `expo-network`. Backed by GIO's GNetworkMonitor +
// /sys/class/net inspection (vnext/src/network/Network.cpp).
// GNetworkMonitor's default implementation auto-selects
// NetworkManager when present and falls back to a pure netlink
// monitor when not, so this works on Lima dev VMs, headless
// servers, and consumer desktops without taking an explicit
// dependency on NM.

const React = require('react');

const _hasNative = typeof rnLinux !== 'undefined' && typeof rnLinux.networkState === 'function';

// expo-network's NetworkStateType enum. String values match
// upstream so cross-platform switch-on-type stays portable.
const NetworkStateType = {
  NONE: 'NONE',
  UNKNOWN: 'UNKNOWN',
  CELLULAR: 'CELLULAR',
  WIFI: 'WIFI',
  BLUETOOTH: 'BLUETOOTH',
  ETHERNET: 'ETHERNET',
  WIMAX: 'WIMAX',
  VPN: 'VPN',
  OTHER: 'OTHER',
};

function _fresh() {
  if (!_hasNative) {
    return {
      type: NetworkStateType.UNKNOWN,
      isConnected: false,
      isInternetReachable: false,
      ipAddress: '',
      macAddress: '',
      interfaceName: '',
    };
  }
  return rnLinux.networkState();
}

async function getNetworkStateAsync() {
  const s = _fresh();
  return {
    type: s.type,
    isConnected: !!s.isConnected,
    isInternetReachable: !!s.isInternetReachable,
  };
}

async function getIpAddressAsync() {
  return _fresh().ipAddress || '';
}

async function getMacAddressAsync(_interfaceName) {
  // Upstream's signature lets you pass an interface name; our
  // native side picks the active one. If a caller specifies one,
  // it'd take an extra binding to honor — return what we have.
  return _fresh().macAddress || '';
}

// Airplane mode is an Android-only signal. Linux doesn't have a
// universal "rfkill all" toggle that's visible at the JS layer;
// return false rather than fake-positive so cross-platform code
// that gates on it skips the airplane-mode path.
async function isAirplaneModeEnabledAsync() {
  return false;
}

// CellularGeneration is Android-only; no equivalent on desktop.
const CellularGeneration = {
  UNKNOWN: 0,
  CELLULAR_2G: 1,
  CELLULAR_3G: 2,
  CELLULAR_4G: 3,
  CELLULAR_5G: 4,
};

async function getCellularGenerationAsync() {
  return CellularGeneration.UNKNOWN;
}

// React hook — re-reads the snapshot each render. Live
// subscription to GNetworkMonitor's `network-changed` would land
// it as a useEffect + listener pair; today the snapshot is fresh
// enough for normal UI updates triggered by user actions.
function useNetworkState() {
  const [state, setState] = React.useState(_fresh);
  React.useEffect(() => {
    setState(_fresh());
  }, []);
  return state;
}

// Listener API — accepts subscribers, returns a no-op
// subscription. A future binding can wire GNetworkMonitor's
// network-changed signal through to fire these.
function addNetworkStateListener(_listener) {
  return {remove() {}};
}

const api = {
  NetworkStateType,
  CellularGeneration,
  getNetworkStateAsync,
  getIpAddressAsync,
  getMacAddressAsync,
  isAirplaneModeEnabledAsync,
  getCellularGenerationAsync,
  useNetworkState,
  addNetworkStateListener,
};

module.exports = api;
module.exports.default = api;
