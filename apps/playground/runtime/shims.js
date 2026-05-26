'use strict';

// Minimal browser-API shims so React + react-reconciler can run on
// Hermes. Hermes ships Promise + globalThis but our embedding does
// NOT install console (that's a host-side opt-in). Everything below is
// what React's scheduler / dev warnings reach for that Hermes doesn't
// provide. Real timer plumbing tied to the GTK main loop lands in
// Phase 5.8.
//
// console is critical: React's DEV warnings (e.g. "Function components
// cannot be given refs") go through console.error, and an uncaught
// ReferenceError there throws out of UIManager::startSurface as a JSI
// exception. The unwind crosses a noexcept destructor and the process
// terminates — so console must be installed before any React code runs.
if (typeof globalThis.console === 'undefined') {
  const make =
    level =>
    (...args) => {
      let s = '';
      for (let i = 0; i < args.length; i++) {
        if (i > 0) s += ' ';
        const a = args[i];
        s +=
          typeof a === 'string'
            ? a
            : (() => {
                try {
                  return JSON.stringify(a);
                } catch {
                  return String(a);
                }
              })();
      }
      rnLinux.log(level, s);
    };
  globalThis.console = {
    log: make('info'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
    trace: make('debug'),
    // Stub the rest so library code that does `console.group(...)`
    // doesn't throw ReferenceError on property access.
    group: () => {},
    groupCollapsed: () => {},
    groupEnd: () => {},
    table: () => {},
    time: () => {},
    timeEnd: () => {},
    timeLog: () => {},
    count: () => {},
    countReset: () => {},
    dir: () => {},
    dirxml: () => {},
    assert: () => {},
    clear: () => {},
  };
}

if (typeof globalThis.queueMicrotask === 'undefined') {
  const resolved = Promise.resolve();
  globalThis.queueMicrotask = fn => {
    resolved.then(() => {
      try {
        fn();
      } catch (e) {
        rnLinux.log('error', 'microtask threw: ' + String(e));
      }
    });
  };
}

// React's scheduler uses setImmediate / setTimeout(0) to yield between
// work units. Without a real event loop we'd ping-pong
// setImmediate→microtask→setImmediate and blow the stack. Workaround
// for the static-render demo: drain queued callbacks at the end of the
// current synchronous tick via a single post-evaluation Promise.then.
const _pendingTasks = [];
let _draining = false;
function _enqueue(fn) {
  _pendingTasks.push(fn);
  if (!_draining) {
    _draining = true;
    Promise.resolve().then(() => {
      while (_pendingTasks.length) {
        const next = _pendingTasks.shift();
        try {
          next();
        } catch (e) {
          rnLinux.log('error', 'task threw: ' + String(e));
        }
      }
      _draining = false;
    });
  }
}

// setTimeout / clearTimeout — backed by g_timeout_add via
// rnLinux.setTimeout. Returns a numeric handle that clearTimeout
// can pass back to remove the GLib source. Args after `ms` are
// captured in the arrow so the native side just calls a zero-arg
// function (matches the JSI binding's `fn->call(rt)`).
if (typeof globalThis.setTimeout === 'undefined') {
  globalThis.setTimeout = (fn, ms, ...args) => {
    const delay = typeof ms === 'number' && ms > 0 ? ms : 0;
    return rnLinux.setTimeout(() => fn(...args), delay);
  };
  globalThis.clearTimeout = id => {
    if (typeof id === 'number') rnLinux.clearTimeout(id);
  };
}
if (typeof globalThis.setInterval === 'undefined') {
  // Real GTK-driven interval (g_timeout_add wired up in
  // RnLinuxBindings.cpp). The C++ side already drainMicrotasks() after
  // each callback so any setState queued inside fires its commit
  // before the next interval tick.
  globalThis.setInterval = (fn, ms) => rnLinux.setInterval(fn, ms | 0);
  globalThis.clearInterval = id => rnLinux.clearInterval(id);
}
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  // ~60fps via g_timeout_add(16, ...). Callback receives a high-res
  // ms timestamp (RN/web convention). Real GdkFrameClock-driven
  // vsync lands in a follow-up.
  globalThis.requestAnimationFrame = fn => rnLinux.requestAnimationFrame(fn);
  globalThis.cancelAnimationFrame = id => rnLinux.cancelAnimationFrame(id);
}
// RN's standard `global` polyfill — third-party libs reach for it
// without `typeof` guards (expo-modules-core, async-storage, …).
// Hermes strict mode throws ReferenceError on unresolved bare
// identifiers; install the alias so a bare `global.foo` lookup
// resolves before module code runs.
if (typeof globalThis.global === 'undefined') {
  globalThis.global = globalThis;
}

// Minimal `process` shim. Most RN-targeted libs only look at
// `process.env.NODE_ENV` (bundler replaces) and `process.platform`.
// Provide just enough so a probe like `process.cwd?.()` doesn't
// throw on access — never executed on desktop.
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: {NODE_ENV: 'development'},
    platform: 'linux',
    versions: {},
    nextTick: fn => Promise.resolve().then(fn),
  };
}

if (typeof globalThis.setImmediate === 'undefined') {
  globalThis.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
  globalThis.clearImmediate = id => clearTimeout(id);
}
if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = {now: () => Date.now()};
}

// RN-style global error reporter. Apps and the LogBox boundary use
// ErrorUtils.setGlobalHandler(fn) to subscribe to async / uncaught
// errors. Our microtask + setTimeout shims already swallow throws (so
// the runtime doesn't die) and previously just logged to stderr; now
// they also fan out to the registered handler so the in-window LogBox
// can render them.
//
// Mirrors the iOS/Android global.ErrorUtils surface:
//   * setGlobalHandler(fn) — replaces the current handler
//   * getGlobalHandler() — current handler (may be a no-op)
//   * reportFatalError(err) — host code uses this to surface errors
//   * reportError(err) — non-fatal variant; fires the same handler
let _globalErrorHandler = (err, _isFatal) => {
  rnLinux.log('error', 'unhandled: ' + (err && err.stack ? err.stack : String(err)));
};
function _reportError(err, isFatal) {
  try {
    _globalErrorHandler(err, !!isFatal);
  } catch (innerErr) {
    rnLinux.log('error', 'global error handler threw: ' + String(innerErr));
  }
}
globalThis.ErrorUtils = {
  setGlobalHandler(fn) {
    if (typeof fn === 'function') _globalErrorHandler = fn;
  },
  getGlobalHandler() {
    return _globalErrorHandler;
  },
  reportFatalError(err) {
    _reportError(err, true);
  },
  reportError(err) {
    _reportError(err, false);
  },
};

// Re-route the shim's swallowed throws through ErrorUtils too. The
// previous rnLinux.log calls stay so the stderr trail is unchanged,
// but the handler now ALSO sees them and can show the LogBox.
const _origMicro = globalThis.queueMicrotask;
globalThis.queueMicrotask = fn => {
  _origMicro(() => {
    try {
      fn();
    } catch (e) {
      rnLinux.log('error', 'microtask threw: ' + String(e));
      _reportError(e, false);
    }
  });
};
// _enqueue is the inner setTimeout/setImmediate driver — wrap its
// task invocation the same way without reaching in.
const _origEnqueue = _enqueue;
function _enqueueWithReport(fn) {
  _origEnqueue(() => {
    try {
      fn();
    } catch (e) {
      rnLinux.log('error', 'task threw: ' + String(e));
      _reportError(e, false);
    }
  });
}
