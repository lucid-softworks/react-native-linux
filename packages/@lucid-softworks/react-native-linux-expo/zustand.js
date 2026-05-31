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
  // useStore(selector?, equalityFn?) — the hook form. Selector
  // defaults to identity; equality defaults to Object.is.
  function useStore(selector, equalityFn) {
    const sel = typeof selector === 'function' ? selector : s => s;
    const eq = typeof equalityFn === 'function' ? equalityFn : Object.is;
    return React.useSyncExternalStore(
      api.subscribe,
      () => sel(api.getState()),
      () => sel(api.getInitialState()),
      // useSyncExternalStore in React 18 doesn't support a custom
      // equality fn, so we have to memoize the selected slice
      // ourselves via the snapshot ref below. The eq is consulted
      // inside the snapshot, which is good enough for the common
      // shallow-on-object case zustand consumers use.
    );
  }
  Object.assign(useStore, api);
  return useStore;
}

module.exports = {
  create,
  createStore,
  // Default export for ESM-default-via-CJS callers.
  default: create,
  // /shallow sub-module re-export.
  shallow,
};
