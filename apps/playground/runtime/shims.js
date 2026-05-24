'use strict';

// Minimal browser-API shims so React + react-reconciler can run on
// Hermes. Hermes ships Promise + console + globalThis; everything below
// is what React's scheduler reaches for that Hermes doesn't provide.
// Real timer plumbing tied to the GTK main loop lands in Phase 5.8.

if (typeof globalThis.queueMicrotask === 'undefined') {
  const resolved = Promise.resolve();
  globalThis.queueMicrotask = (fn) => {
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

const _timers = new Map();
let _timerSeq = 1;
if (typeof globalThis.setTimeout === 'undefined') {
  globalThis.setTimeout = (fn, _ms, ...args) => {
    const id = _timerSeq++;
    _timers.set(id, true);
    _enqueue(() => {
      if (_timers.delete(id)) fn(...args);
    });
    return id;
  };
  globalThis.clearTimeout = (id) => _timers.delete(id);
}
if (typeof globalThis.setInterval === 'undefined') {
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
}
if (typeof globalThis.setImmediate === 'undefined') {
  globalThis.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
  globalThis.clearImmediate = (id) => clearTimeout(id);
}
if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = {now: () => Date.now()};
}
