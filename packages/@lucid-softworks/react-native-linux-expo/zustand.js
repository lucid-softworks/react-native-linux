'use strict';

// Minimal zustand shim. Real zustand is a tiny state library;
// the surface apps actually reach for from a top-level RN entry
// is the `create` factory and the `shallow` selector:
//
//   import {create} from 'zustand';
//   import {shallow} from 'zustand/shallow';
//   const useStore = create((set, get) => ({count: 0, inc: () => set(s => ({count: s.count + 1}))}));
//
// We re-implement just enough to make stores constructible and
// usable through their hook: `useStore(selector?, equalityFn?)`
// returns the (selected) state and re-renders on change. Listeners
// + getState + setState + subscribe + destroy round out the
// vanilla API.

const React = require('react');

function shallow(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !Object.is(b.get(k), v)) return false;
    return true;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || !Object.is(a[k], b[k])) return false;
  }
  return true;
}

function createStoreImpl(initializer) {
  let state;
  const listeners = new Set();

  const setState = (partial, replace) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    if (Object.is(next, state)) return;
    const prev = state;
    state = replace ? next : Object.assign({}, state, next);
    listeners.forEach(l => l(state, prev));
  };
  const getState = () => state;
  const getInitialState = () => initialState;
  const subscribe = listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const destroy = () => listeners.clear();

  const api = {setState, getState, getInitialState, subscribe, destroy};
  state = initializer(setState, getState, api);
  const initialState = state;
  return api;
}

function createStore(initializer) {
  return createStoreImpl(initializer);
}

function create(initializer) {
  const api = createStoreImpl(initializer);
  // useStore(selector?, equalityFn?) — the hook form.
  //
  // The catch: a selector like `s => ({a: s.a, b: s.b})` returns a
  // NEW object reference every call. useSyncExternalStore tears if
  // getSnapshot returns a different reference each time it's read
  // outside an actual subscribe-fire (React fires "the result of
  // getSnapshot should be cached" and falls into an infinite render
  // loop).
  //
  // Fix: cache the last selector input AND its result, and on every
  // getSnapshot call return the cached result when the equality fn
  // says the new selection matches the old one. equalityFn defaults
  // to Object.is for the no-selector case; consumers passing
  // `shallow` (from zustand/shallow) get the structural comparison.
  function useStore(selector, equalityFn) {
    const sel = typeof selector === 'function' ? selector : s => s;
    const eq = typeof equalityFn === 'function' ? equalityFn : Object.is;
    const cacheRef = React.useRef(null);
    function readWithCache(rawState) {
      const next = sel(rawState);
      if (cacheRef.current && eq(cacheRef.current.value, next)) {
        return cacheRef.current.value;
      }
      cacheRef.current = {value: next};
      return next;
    }
    const getSnapshot = () => readWithCache(api.getState());
    const getServerSnapshot = () => readWithCache(api.getInitialState());
    return React.useSyncExternalStore(api.subscribe, getSnapshot, getServerSnapshot);
  }
  Object.assign(useStore, api);
  return useStore;
}

// esbuild's __toESM wraps non-ESM modules by stamping their value at
// `.default` on a new object; that re-wraps `module.exports.default`
// to point at the whole namespace instead of the create function.
// Marking the module as ESM-shaped tells the interop to pass through
// unchanged, so `import create from 'zustand'` reads the right slot.
Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.create = create;
module.exports.createStore = createStore;
// Default export for `import create from 'zustand'`.
module.exports.default = create;
// /shallow sub-module re-export.
module.exports.shallow = shallow;
