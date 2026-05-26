'use strict';

// Shim for `expo-battery`. Reuses the existing battery snapshot
// that `react-native-device-info`'s shim already pulls from the
// C++ DeviceInfo gather() — which reads /sys/class/power_supply/*
// for level + state. No new native code needed; we just rename
// fields into the upstream expo-battery shape.

const React = require('react');

function _snapshot() {
  if (typeof rnLinux === 'undefined' || typeof rnLinux.deviceInfoSync !== 'function') {
    return null;
  }
  return rnLinux.deviceInfoSync();
}

function _power() {
  const snap = _snapshot();
  return snap ? snap.powerState || {} : {};
}

const BatteryState = {
  UNKNOWN: 0,
  UNPLUGGED: 1,
  CHARGING: 2,
  FULL: 3,
};

function _stateEnum(s) {
  switch (s) {
    case 'charging':
      return BatteryState.CHARGING;
    case 'discharging':
      return BatteryState.UNPLUGGED;
    case 'full':
      return BatteryState.FULL;
    default:
      return BatteryState.UNKNOWN;
  }
}

async function isAvailableAsync() {
  return typeof rnLinux !== 'undefined' && typeof rnLinux.deviceInfoSync === 'function';
}

async function getBatteryLevelAsync() {
  const ps = _power();
  return typeof ps.batteryLevel === 'number' ? ps.batteryLevel : -1;
}

async function getBatteryStateAsync() {
  return _stateEnum(_power().batteryState);
}

async function getPowerStateAsync() {
  const ps = _power();
  return {
    batteryLevel: typeof ps.batteryLevel === 'number' ? ps.batteryLevel : -1,
    batteryState: _stateEnum(ps.batteryState),
    lowPowerMode: !!ps.lowPowerMode,
  };
}

async function isLowPowerModeEnabledAsync() {
  return !!_power().lowPowerMode;
}

// Listeners would tail a sysfs uevent loop or a UPower DBus signal.
// Both are doable but neither's wired yet — return no-op
// subscriptions so apps that register on mount don't crash.
function addBatteryLevelListener(_listener) {
  return {remove() {}};
}
function addBatteryStateListener(_listener) {
  return {remove() {}};
}
function addLowPowerModeListener(_listener) {
  return {remove() {}};
}

// React hooks — re-read on render. Without a live UPower
// subscription these don't refresh between renders, but the
// snapshot is cheap enough to call from a useEffect interval if
// real apps need polling behavior.
function useBatteryLevel() {
  const [v, setV] = React.useState(-1);
  React.useEffect(() => {
    getBatteryLevelAsync().then(setV);
  }, []);
  return v;
}

function useBatteryState() {
  const [v, setV] = React.useState(BatteryState.UNKNOWN);
  React.useEffect(() => {
    getBatteryStateAsync().then(setV);
  }, []);
  return v;
}

function usePowerState() {
  const [v, setV] = React.useState({
    batteryLevel: -1,
    batteryState: BatteryState.UNKNOWN,
    lowPowerMode: false,
  });
  React.useEffect(() => {
    getPowerStateAsync().then(setV);
  }, []);
  return v;
}

function useLowPowerMode() {
  const [v, setV] = React.useState(false);
  React.useEffect(() => {
    isLowPowerModeEnabledAsync().then(setV);
  }, []);
  return v;
}

const api = {
  BatteryState,
  isAvailableAsync,
  getBatteryLevelAsync,
  getBatteryStateAsync,
  getPowerStateAsync,
  isLowPowerModeEnabledAsync,
  addBatteryLevelListener,
  addBatteryStateListener,
  addLowPowerModeListener,
  useBatteryLevel,
  useBatteryState,
  usePowerState,
  useLowPowerMode,
};

module.exports = api;
module.exports.default = api;
