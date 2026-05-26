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
// Backed by /sys/class/rfkill — true iff every wireless radio
// (wlan/bluetooth/wwan/gps/wimax/uwb) is soft-blocked AND at
// least one such device exists. Returns false on systems
// without rfkill (some servers, VMs without virtual radios).
async function isAirplaneModeEnabledAsync() {
  if (typeof rnLinux === 'undefined' || typeof rnLinux.networkAirplaneMode !== 'function') {
    return false;
  }
  return Boolean(rnLinux.networkAirplaneMode());
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

// Multiplex JS subscribers behind the single native trampoline.
// The C++ side only holds one StateListener slot; we fan out to
// the Set here so multiple useNetworkState hooks / consumers
// share one GNetworkMonitor subscription.
const _stateSubs = new Set();
let _nativeWired = false;

function _ensureNativeWired() {
  if (_nativeWired) return;
  if (typeof rnLinux === 'undefined' || typeof rnLinux.networkSetStateListener !== 'function') {
    return;
  }
  rnLinux.networkSetStateListener(state => {
    for (const fn of _stateSubs) {
      try {
        fn(state);
      } catch (_) {}
    }
  });
  _nativeWired = true;
}

function _teardownNativeIfIdle() {
  if (!_nativeWired || _stateSubs.size > 0) return;
  if (typeof rnLinux === 'undefined' || typeof rnLinux.networkSetStateListener !== 'function') {
    return;
  }
  rnLinux.networkSetStateListener(null);
  _nativeWired = false;
}

// React hook — subscribes to the live network-changed signal so
// the consumer re-renders when the system gains/loses
// connectivity (wifi associate, ethernet cable plug, NM toggle).
function useNetworkState() {
  const [state, setState] = React.useState(_fresh);
  React.useEffect(() => {
    const sub = addNetworkStateListener(setState);
    setState(_fresh());
    return () => sub.remove();
  }, []);
  return state;
}

// Listener API — real. Subscribes to GNetworkMonitor's
// network-changed via the native binding; multiplexed across all
// JS subscribers and torn down when the last one unsubscribes.
function addNetworkStateListener(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('expo-network: listener must be a function');
  }
  _stateSubs.add(listener);
  _ensureNativeWired();
  return {
    remove() {
      _stateSubs.delete(listener);
      _teardownNativeIfIdle();
    },
  };
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
  // Linux-only extension — returns every iface the kernel exposes
  // (loopback, VPN tap devices, bridges, etc.) with type, up-state,
  // ipv4, ipv6, and mac. Useful for multi-NIC / VPN-aware apps;
  // cross-platform code should branch on platform before calling.
  getInterfacesAsync,
};

async function getInterfacesAsync() {
  if (typeof rnLinux === 'undefined' || typeof rnLinux.networkInterfaces !== 'function') {
    return [];
  }
  return rnLinux.networkInterfaces().map(i => ({
    name: i.name,
    type: i.type,
    isUp: i.isUp,
    ipv4: i.ipv4 || null,
    ipv6: i.ipv6 || null,
    macAddress: i.macAddress || null,
  }));
}

module.exports = api;
module.exports.default = api;
