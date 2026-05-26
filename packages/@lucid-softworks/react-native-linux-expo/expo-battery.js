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
// re-renders when battery state actually changes. Each hook
// fetches the initial value at mount, then watches for deltas.
function useBatteryLevel() {
  const [v, setV] = React.useState(-1);
  React.useEffect(() => {
    getBatteryLevelAsync().then(setV);
    const sub = addBatteryLevelListener(({batteryLevel}) => setV(batteryLevel));
    return () => sub.remove();
  }, []);
  return v;
}

function useBatteryState() {
  const [v, setV] = React.useState(BatteryState.UNKNOWN);
  React.useEffect(() => {
    getBatteryStateAsync().then(setV);
    const sub = addBatteryStateListener(({batteryState}) => setV(batteryState));
    return () => sub.remove();
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
    // Three listeners patch into the same composed state object —
    // beats one per-call recomputation because addBatteryStateListener
    // already filters out unchanged ticks.
    const subs = [
      addBatteryLevelListener(({batteryLevel}) => setV(s => ({...s, batteryLevel}))),
      addBatteryStateListener(({batteryState}) => setV(s => ({...s, batteryState}))),
      addLowPowerModeListener(({lowPowerMode}) => setV(s => ({...s, lowPowerMode}))),
    ];
    return () => subs.forEach(s => s.remove());
  }, []);
  return v;
}

function useLowPowerMode() {
  const [v, setV] = React.useState(false);
  React.useEffect(() => {
    isLowPowerModeEnabledAsync().then(setV);
    const sub = addLowPowerModeListener(({lowPowerMode}) => setV(lowPowerMode));
    return () => sub.remove();
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
