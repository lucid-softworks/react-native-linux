'use strict';

// `expo-modules-core` shim. Real Expo packages from npm import from
// this module to look up their native host: third-party packages
// `import { requireNativeModule } from 'expo-modules-core'` and
// `requireNativeModule('ExpoFoo')` returns the native instance.
//
// Upstream's `requireOptionalNativeModule` walks three sources in
// order:
//   1. `globalThis.expo?.modules?.[name]` — native registry, populated
//      by iOS / Android's native side.
//   2. `NativeModulesProxy[name]` — legacy bridge proxy.
//   3. `createTurboModuleToExpoProxy(TurboModuleRegistry.get(name), name)`
//      — TurboModule path.
//
// On Linux we mirror (1) directly: our umbrella shim's expo-* JS
// files register their interop objects into `globalThis.expo.modules`
// at load time. Third-party packages that match a registered name
// resolve transparently; the rest get a clear "not available on
// Linux" error instead of crashing on undefined.

// ─── Bootstrap `globalThis.expo` ───────────────────────────────────
//
// Lazy-creates the global if no one set it up. Both this shim AND
// in-tree shims (expo-camera.js, expo-haptics.js, …) call into
// `registerExpoModule(name, impl)` below; whichever loads first
// installs the global, subsequent loaders see it ready.

function ensureGlobal() {
  if (typeof globalThis === 'undefined') {
    throw new Error('expo-modules-core shim requires globalThis');
  }
  if (!globalThis.expo || typeof globalThis.expo !== 'object') {
    globalThis.expo = {};
  }
  if (!globalThis.expo.modules || typeof globalThis.expo.modules !== 'object') {
    globalThis.expo.modules = {};
  }
  if (!globalThis.expo.EventEmitter) {
    globalThis.expo.EventEmitter = EventEmitter;
  }
  if (!globalThis.expo.NativeModule) {
    globalThis.expo.NativeModule = NativeModule;
  }
  if (!globalThis.expo.SharedObject) {
    globalThis.expo.SharedObject = SharedObject;
  }
  if (!globalThis.expo.SharedRef) {
    globalThis.expo.SharedRef = SharedRef;
  }
  return globalThis.expo;
}

// ─── EventEmitter ──────────────────────────────────────────────────
//
// Minimal pub-sub that matches expo's `EventEmitter` contract. Real
// Expo's emitter is a HostObject backed by the native EventEmitter
// runtime; we just need to provide `addListener` / `removeListener`
// / `emit` so the JS-side wrappers around our native modules can
// fan events out the same way they do on iOS / Android.

class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }
  addListener(eventName, listener) {
    let listeners = this._listeners.get(eventName);
    if (!listeners) {
      listeners = new Set();
      this._listeners.set(eventName, listeners);
    }
    listeners.add(listener);
    return {
      remove: () => {
        const set = this._listeners.get(eventName);
        if (set) {
          set.delete(listener);
          if (set.size === 0) this._listeners.delete(eventName);
        }
      },
    };
  }
  removeAllListeners(eventName) {
    if (eventName == null) {
      this._listeners.clear();
    } else {
      this._listeners.delete(eventName);
    }
  }
  emit(eventName, ...args) {
    const listeners = this._listeners.get(eventName);
    if (!listeners) return;
    // Snapshot first — listeners may remove themselves during dispatch.
    for (const listener of Array.from(listeners)) {
      try {
        listener(...args);
      } catch (e) {
        if (typeof rnLinux !== 'undefined' && rnLinux.log) {
          rnLinux.log('error', '[expo-modules-core] listener threw: ' + String(e));
        }
      }
    }
  }
  listenerCount(eventName) {
    const listeners = this._listeners.get(eventName);
    return listeners ? listeners.size : 0;
  }
}

// ─── NativeModule base ─────────────────────────────────────────────
//
// Expo's `NativeModule` is the base every native module extends. It's
// an EventEmitter plus a few host-object hooks (`view`, `release`).
// In-tree shims that register through `registerExpoModule` can opt to
// extend this — most just provide a plain object since our flat
// registry doesn't need the class plumbing.

class NativeModule extends EventEmitter {}

// ─── SharedObject / SharedRef ──────────────────────────────────────
//
// Real expo has these as opaque host objects for ref-counted resources
// (textures, files). Plain-JS no-op base classes are enough for the
// imports to resolve — modules that genuinely need ref-counting
// implement their own backing on the C++ side via rnLinux.* bindings.

class SharedObject extends EventEmitter {
  release() {
    /* no-op */
  }
}

class SharedRef extends SharedObject {}

// ─── Registry API ──────────────────────────────────────────────────

function registerExpoModule(name, impl) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('registerExpoModule: name must be a non-empty string');
  }
  if (impl == null) {
    throw new TypeError('registerExpoModule: implementation must not be null');
  }
  const expo = ensureGlobal();
  expo.modules[name] = impl;
}

function requireNativeModule(moduleName) {
  const m = requireOptionalNativeModule(moduleName);
  if (!m) {
    throw new Error(
      `Cannot find native module '${moduleName}'. ` +
        `On Linux, native modules must be registered through ` +
        `expo-modules-core's registerExpoModule. ` +
        `See packages/@lucid-softworks/react-native-linux-expo/ for ` +
        `existing in-tree registrations and add a new one if the ` +
        `module ships a Linux backend.`,
    );
  }
  return m;
}

function requireOptionalNativeModule(moduleName) {
  const expo = ensureGlobal();
  const fromRegistry = expo.modules[moduleName];
  if (fromRegistry) return fromRegistry;
  // Match upstream's fallback: check TurboModule registry. We don't
  // have NativeModulesProxy on Linux, so the bridge-proxy path is
  // skipped.
  try {
    const ReactNative = require('react-native');
    if (ReactNative && ReactNative.TurboModuleRegistry) {
      const tm = ReactNative.TurboModuleRegistry.get(moduleName);
      if (tm) return tm;
    }
  } catch {
    /* react-native shim may not expose TurboModuleRegistry yet — fine */
  }
  return null;
}

// ─── Hooks + types ─────────────────────────────────────────────────
//
// Just enough so `import { useEvent } from 'expo-modules-core'` and
// `import type { ... } from 'expo-modules-core'` from third-party
// packages don't blow up.

const React = require('react');

function useEvent(eventEmitter, eventName, initialValue) {
  const [value, setValue] = React.useState(initialValue);
  React.useEffect(() => {
    if (!eventEmitter || typeof eventEmitter.addListener !== 'function') {
      return undefined;
    }
    const sub = eventEmitter.addListener(eventName, ev => setValue(ev));
    return () => sub.remove();
  }, [eventEmitter, eventName]);
  return value;
}

function useEventListener(eventEmitter, eventName, listener) {
  React.useEffect(() => {
    if (!eventEmitter || typeof eventEmitter.addListener !== 'function') {
      return undefined;
    }
    const sub = eventEmitter.addListener(eventName, listener);
    return () => sub.remove();
  }, [eventEmitter, eventName, listener]);
}

// Initialize the global immediately so a `require('expo-modules-core')`
// at app eval time hydrates `globalThis.expo` before any other shim
// touches it.
ensureGlobal();

// ─── Misc errors mirroring the upstream surface ────────────────────

class CodedError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'CodedError';
  }
}

class UnavailabilityError extends CodedError {
  constructor(moduleName, propertyName) {
    super(
      'ERR_UNAVAILABLE',
      `The method or property ${moduleName}.${propertyName} is not available on Linux, ` +
        `are you sure you've linked all the native dependencies properly?`,
    );
  }
}

module.exports = {
  requireNativeModule,
  requireOptionalNativeModule,
  registerExpoModule,
  EventEmitter,
  NativeModule,
  SharedObject,
  SharedRef,
  CodedError,
  UnavailabilityError,
  useEvent,
  useEventListener,
  // expo's `Platform` re-export — third-party packages import this to
  // gate platform-specific code paths. Mirror react-native's Platform
  // shape: { OS, select }.
  get Platform() {
    return require('react-native').Platform;
  },
  // `NativeModulesProxy` re-export. Third-party packages reach for it
  // expecting an object indexed by name; return our registry directly
  // so a missing module surfaces as `undefined` rather than a crash.
  get NativeModulesProxy() {
    return ensureGlobal().modules;
  },
};
