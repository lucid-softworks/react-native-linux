'use strict';

// @legendapp/state shim. Reactive state library w/ observable proxies.
// We implement enough of the core API to satisfy import + boot:
// `observable`, `observe`, `useObservable`, `useSelector`,
// `Memo`/`For`/`Show` components, and the persist + sync surfaces
// as no-ops.

const React = require('react');

function observable(initial) {
  let value = initial;
  const listeners = new Set();
  function notify() {
    listeners.forEach(l => l(value));
  }
  function obs() {
    return value;
  }
  obs.get = () => value;
  obs.set = next => {
    value = typeof next === 'function' ? next(value) : next;
    notify();
  };
  obs.peek = () => value;
  obs.onChange = cb => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  };
  obs.delete = () => {
    value = undefined;
    notify();
  };
  return obs;
}

function observe(cb) {
  cb();
  return () => {};
}

function batch(cb) {
  cb();
}

// React hooks
function useObservable(initial) {
  const ref = React.useRef(null);
  if (ref.current === null)
    ref.current = observable(typeof initial === 'function' ? initial() : initial);
  return ref.current;
}
function useSelector(selector) {
  const sel = typeof selector === 'function' ? selector : () => selector;
  return React.useSyncExternalStore(
    () => () => {},
    () => sel(),
    () => sel(),
  );
}
function useComputed(selector) {
  return useSelector(selector);
}

// Reactive components — same passthrough role as moti's wrappers.
function Memo(props) {
  return props.children;
}
function For(_props) {
  return null;
}
function Show(props) {
  return props.if ? props.children : null;
}
function Reactive(props) {
  return props.children;
}

function stamp(o) {
  Object.defineProperty(o, '__esModule', {value: true});
  return o;
}

const base = stamp({observable, observe, batch, computed: observable, opaqueObject: x => x});
const react = stamp({
  useObservable,
  useSelector,
  useComputed,
  observer: Inner => Inner,
  Memo,
  For,
  Show,
  Reactive,
});
const persist = stamp({
  configureObservablePersistence: () => {},
  syncObservable: () => () => {},
  persistObservable: () => () => {},
});
const sync = stamp({
  configureSynced: () => () => {},
  synced: x => x,
});
const persistAsyncStorage = stamp({
  ObservablePersistAsyncStorage: function () {},
  // Lowercase factory form — newer @legendapp/state versions
  // configureSynced({plugin: observablePersistAsyncStorage(...)}).
  observablePersistAsyncStorage: function (_opts) {
    return {load: () => Promise.resolve(), save: () => Promise.resolve(), name: 'AsyncStorage'};
  },
});
const syncSupabase = stamp({
  syncedSupabase: x => x,
  configureSyncedSupabase: x => x,
});

module.exports = {base, react, persist, sync, persistAsyncStorage, syncSupabase};
