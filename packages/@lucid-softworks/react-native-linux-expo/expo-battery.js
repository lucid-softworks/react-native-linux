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

// Live subscriptions are driven by a JS-side poll. Battery state
// on a laptop changes slowly (level ~1%/minute, plug/unplug a few
// times a day), so a 5-second poll is essentially free and works
// without a UPower DBus dependency. Listeners are fanned out to
// the three expo APIs separately so consumers that only care
// about plug/unplug don't get woken up by a percentage tick.
//
// The poll is shared across all three listener types; we start it
// when the first subscriber arrives and stop it when the last
// unsubscribes.
const _levelSubs = new Set();
const _stateSubs = new Set();
const _lowPowerSubs = new Set();
const POLL_MS = 5000;
let _pollHandle = null;
let _lastLevel = -1;
let _lastState = BatteryState.UNKNOWN;
let _lastLowPower = false;

function _totalSubs() {
  return _levelSubs.size + _stateSubs.size + _lowPowerSubs.size;
}

function _snapshotPower() {
  const ps = _power();
  return {
    batteryLevel: typeof ps.batteryLevel === 'number' ? ps.batteryLevel : -1,
    batteryState: _stateEnum(ps.batteryState),
    lowPowerMode: !!ps.lowPowerMode,
  };
}

function _pollTick() {
  const snap = _snapshotPower();
  // Round to 1% so a smooth 0.500001 → 0.499998 jitter doesn't
  // spam consumers. expo reports level as a fraction; consumers
  // multiply by 100 to display.
  const lvl = Math.round(snap.batteryLevel * 100) / 100;
  if (lvl !== _lastLevel) {
    _lastLevel = lvl;
    for (const fn of _levelSubs) {
      try {
        fn({batteryLevel: lvl});
      } catch (_) {}
    }
  }
  if (snap.batteryState !== _lastState) {
    _lastState = snap.batteryState;
    for (const fn of _stateSubs) {
      try {
        fn({batteryState: snap.batteryState});
      } catch (_) {}
    }
  }
  if (snap.lowPowerMode !== _lastLowPower) {
    _lastLowPower = snap.lowPowerMode;
    for (const fn of _lowPowerSubs) {
      try {
        fn({lowPowerMode: snap.lowPowerMode});
      } catch (_) {}
    }
  }
}

function _startPollIfIdle() {
  if (_pollHandle !== null) return;
  // Prime "last" so the first tick only fires deltas, not the
  // initial snapshot — consumers got the initial state from
  // getPowerStateAsync at subscribe time if they wanted it.
  const snap = _snapshotPower();
  _lastLevel = Math.round(snap.batteryLevel * 100) / 100;
  _lastState = snap.batteryState;
  _lastLowPower = snap.lowPowerMode;
  _pollHandle = setInterval(_pollTick, POLL_MS);
}

function _stopPollIfIdle() {
  if (_pollHandle === null || _totalSubs() > 0) return;
  clearInterval(_pollHandle);
  _pollHandle = null;
}

function addBatteryLevelListener(listener) {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function');
  _levelSubs.add(listener);
  _startPollIfIdle();
  return {
    remove() {
      _levelSubs.delete(listener);
      _stopPollIfIdle();
    },
  };
}
function addBatteryStateListener(listener) {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function');
  _stateSubs.add(listener);
  _startPollIfIdle();
  return {
    remove() {
      _stateSubs.delete(listener);
      _stopPollIfIdle();
    },
  };
}
function addLowPowerModeListener(listener) {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function');
  _lowPowerSubs.add(listener);
  _startPollIfIdle();
  return {
    remove() {
      _lowPowerSubs.delete(listener);
      _stopPollIfIdle();
    },
  };
}

// React hooks — subscribe to the listener bus so the component
// re-renders when battery state actually changes.
//
// `useSyncExternalStore` is the right shape: the snapshot getters
// read the already-cached `_lastLevel` / `_lastState` /
// `_lastLowPower` (kept fresh by the polling trampoline above).
// Avoids the `useState + useEffect(subscribe)` race where the
// initial render captures whatever the value was BEFORE the effect
// subscribed; the previous version papered over that with a
// redundant `getBatteryLevelAsync().then(setV)` inside the effect.
function _levelSubscribe(cb) {
  const sub = addBatteryLevelListener(() => cb());
  return () => sub.remove();
}
function _levelGetSnapshot() {
  return _lastLevel;
}
function useBatteryLevel() {
  return React.useSyncExternalStore(_levelSubscribe, _levelGetSnapshot, _levelGetSnapshot);
}

function _stateSubscribe(cb) {
  const sub = addBatteryStateListener(() => cb());
  return () => sub.remove();
}
function _stateGetSnapshot() {
  return _lastState;
}
function useBatteryState() {
  return React.useSyncExternalStore(_stateSubscribe, _stateGetSnapshot, _stateGetSnapshot);
}

function _lowPowerSubscribe(cb) {
  const sub = addLowPowerModeListener(() => cb());
  return () => sub.remove();
}
function _lowPowerGetSnapshot() {
  return _lastLowPower;
}
function useLowPowerMode() {
  return React.useSyncExternalStore(_lowPowerSubscribe, _lowPowerGetSnapshot, _lowPowerGetSnapshot);
}

// usePowerState — composite of all three. Cache the composite
// object so getSnapshot returns the same reference between
// updates; rotate it when any of the three underlying values
// actually changes. Without this getSnapshot returns a fresh
// object every call and useSyncExternalStore's Object.is bail-out
// loops infinitely.
let _cachedPowerState = {
  batteryLevel: _lastLevel,
  batteryState: _lastState,
  lowPowerMode: _lastLowPower,
};
function _powerRotateIfDirty() {
  if (
    _cachedPowerState.batteryLevel !== _lastLevel ||
    _cachedPowerState.batteryState !== _lastState ||
    _cachedPowerState.lowPowerMode !== _lastLowPower
  ) {
    _cachedPowerState = {
      batteryLevel: _lastLevel,
      batteryState: _lastState,
      lowPowerMode: _lastLowPower,
    };
  }
}
function _powerSubscribe(cb) {
  const wrap = () => {
    _powerRotateIfDirty();
    cb();
  };
  const subs = [
    addBatteryLevelListener(wrap),
    addBatteryStateListener(wrap),
    addLowPowerModeListener(wrap),
  ];
  return () => subs.forEach(s => s.remove());
}
function _powerGetSnapshot() {
  _powerRotateIfDirty();
  return _cachedPowerState;
}
function usePowerState() {
  return React.useSyncExternalStore(_powerSubscribe, _powerGetSnapshot, _powerGetSnapshot);
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
