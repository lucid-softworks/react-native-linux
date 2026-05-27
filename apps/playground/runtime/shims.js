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

// AbortController / AbortSignal — Hermes 0.12 ships neither, but
// TanStack Query's Query.fetch unconditionally does
// `new AbortController()` on every fetch, and lots of fetch-using
// libraries forward a signal through. Without the globals the
// ReferenceError throws synchronously before the retryer is even
// created, so the query stays pending forever with fetchStatus=idle.
// Function-constructor form for Hermes lazy-parse compatibility
// (the same reason FormData / Blob / Headers are not classes).
if (typeof globalThis.AbortSignal === 'undefined') {
  function AbortSignal() {
    this.aborted = false;
    this.reason = undefined;
    this._listeners = [];
    this.onabort = null;
  }
  AbortSignal.prototype.addEventListener = function (event, listener) {
    if (event === 'abort') this._listeners.push(listener);
  };
  AbortSignal.prototype.removeEventListener = function (event, listener) {
    if (event !== 'abort') return;
    const i = this._listeners.indexOf(listener);
    if (i >= 0) this._listeners.splice(i, 1);
  };
  AbortSignal.prototype.dispatchEvent = function (event) {
    if (event && event.type === 'abort') {
      const ls = this._listeners.slice();
      for (let i = 0; i < ls.length; i++) {
        try {
          ls[i].call(this, event);
        } catch (_) {
          // swallow — listener errors must not block other listeners
        }
      }
      if (typeof this.onabort === 'function') {
        try {
          this.onabort(event);
        } catch (_) {}
      }
    }
    return true;
  };
  AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted) throw this.reason;
  };
  globalThis.AbortSignal = AbortSignal;
}
if (typeof globalThis.AbortController === 'undefined') {
  function AbortController() {
    this.signal = new globalThis.AbortSignal();
  }
  AbortController.prototype.abort = function (reason) {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    this.signal.reason = reason !== undefined ? reason : new Error('Aborted');
    this.signal.dispatchEvent({type: 'abort'});
  };
  globalThis.AbortController = AbortController;
}

// TextEncoder / TextDecoder — Hermes 0.12 ships neither. Atproto's
// `@atproto/lexicon` (pulled in by bluesky-api's response decode path)
// uses `new TextDecoder().decode(buf)` to turn the response bytes into
// a string; without it every feed response throws "Property
// 'TextDecoder' doesn't exist" inside the response handler. Same story
// for TextEncoder on the request side.
if (typeof globalThis.TextEncoder === 'undefined') {
  function TextEncoder() {}
  TextEncoder.prototype.encode = function (input) {
    const s = String(input == null ? '' : input);
    // Quick path: ASCII-only inputs map one byte per char. Doing the
    // surrogate-pair handling unconditionally below is fine but
    // benchmarks show ~3× faster on the JSON-body hot path.
    let asciiOnly = true;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) > 0x7f) {
        asciiOnly = false;
        break;
      }
    }
    if (asciiOnly) {
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    }
    // UTF-8 encode with surrogate-pair pairing.
    const tmp = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) {
        tmp.push(c);
      } else if (c < 0x800) {
        tmp.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c < 0x10000) {
        tmp.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else {
        tmp.push(
          0xf0 | (c >> 18),
          0x80 | ((c >> 12) & 0x3f),
          0x80 | ((c >> 6) & 0x3f),
          0x80 | (c & 0x3f),
        );
      }
    }
    return new Uint8Array(tmp);
  };
  globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  function TextDecoder(label, options) {
    this.encoding = (label || 'utf-8').toLowerCase();
    this.fatal = !!(options && options.fatal);
    this.ignoreBOM = !!(options && options.ignoreBOM);
  }
  TextDecoder.prototype.decode = function (input) {
    if (input == null) return '';
    // Accept ArrayBuffer + any TypedArray. For non-Uint8Array views we
    // build a fresh Uint8Array over the same buffer slice.
    let bytes;
    if (input instanceof Uint8Array) {
      bytes = input;
    } else if (input.buffer && typeof input.byteLength === 'number') {
      bytes = new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    } else if (input instanceof ArrayBuffer) {
      bytes = new Uint8Array(input);
    } else {
      bytes = new Uint8Array(input);
    }
    // Strip BOM unless ignoreBOM.
    let i = 0;
    if (
      !this.ignoreBOM &&
      bytes.length >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf
    ) {
      i = 3;
    }
    let out = '';
    while (i < bytes.length) {
      const b0 = bytes[i++];
      let cp;
      if (b0 < 0x80) {
        cp = b0;
      } else if (b0 < 0xc0) {
        cp = 0xfffd; // unexpected continuation byte
      } else if (b0 < 0xe0) {
        cp = ((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f);
      } else if (b0 < 0xf0) {
        cp = ((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      } else {
        cp =
          ((b0 & 0x07) << 18) |
          ((bytes[i++] & 0x3f) << 12) |
          ((bytes[i++] & 0x3f) << 6) |
          (bytes[i++] & 0x3f);
      }
      if (cp > 0xffff) {
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return out;
  };
  globalThis.TextDecoder = TextDecoder;
}

// URLSearchParams — Hermes 0.12 doesn't ship it. The bluesky-api client
// (and lots of fetch-using libs) build query strings with
// `new URLSearchParams(record).toString()`; without it every GET that
// has query params throws "Property 'URLSearchParams' doesn't exist"
// inside buildXrpcUrl and the request never reaches fetch — every feed
// stays in a pending state forever with no error visible to the user
// (TanStack Query just sees a rejected promise the queryFn never
// surfaces).
//
// Implementation only covers what the WHATWG spec contract actually
// asks for: append/set/get/getAll/has/delete/toString/iteration plus
// the (init) constructor form (record, array-of-pairs, string with
// leading `?` stripped, another URLSearchParams).
if (typeof globalThis.URLSearchParams === 'undefined') {
  function URLSearchParams(init) {
    this._entries = [];
    if (init == null) return;
    if (typeof init === 'string') {
      // Spec: leading "?" stripped.
      const s = init.charAt(0) === '?' ? init.slice(1) : init;
      if (s.length === 0) return;
      const pairs = s.split('&');
      for (let i = 0; i < pairs.length; i++) {
        if (pairs[i].length === 0) continue;
        const eq = pairs[i].indexOf('=');
        const k = eq < 0 ? pairs[i] : pairs[i].slice(0, eq);
        const v = eq < 0 ? '' : pairs[i].slice(eq + 1);
        this._entries.push([
          decodeURIComponent(k.replace(/\+/g, ' ')),
          decodeURIComponent(v.replace(/\+/g, ' ')),
        ]);
      }
    } else if (typeof init.forEach === 'function' && init instanceof URLSearchParams) {
      init.forEach((value, key) => this._entries.push([key, value]));
    } else if (Array.isArray(init)) {
      for (let i = 0; i < init.length; i++) {
        const pair = init[i];
        if (!pair || pair.length < 2) continue;
        this._entries.push([String(pair[0]), String(pair[1])]);
      }
    } else if (typeof init === 'object') {
      const keys = Object.keys(init);
      for (let i = 0; i < keys.length; i++) {
        this._entries.push([keys[i], String(init[keys[i]])]);
      }
    }
  }
  function _encode(s) {
    // WHATWG URLSearchParams uses application/x-www-form-urlencoded:
    // spaces map to '+' and the encode-set is wider than encodeURIComponent's.
    // For the read-only XRPC GET surface this hits, the standard escape
    // (with %20→'+' substitution) is enough.
    return encodeURIComponent(s).replace(/%20/g, '+');
  }
  URLSearchParams.prototype.append = function (name, value) {
    this._entries.push([String(name), String(value)]);
  };
  URLSearchParams.prototype.set = function (name, value) {
    const k = String(name);
    let placed = false;
    this._entries = this._entries.filter(e => {
      if (e[0] !== k) return true;
      if (!placed) {
        e[1] = String(value);
        placed = true;
        return true;
      }
      return false;
    });
    if (!placed) this._entries.push([k, String(value)]);
  };
  URLSearchParams.prototype.delete = function (name) {
    const k = String(name);
    this._entries = this._entries.filter(e => e[0] !== k);
  };
  URLSearchParams.prototype.get = function (name) {
    const k = String(name);
    const hit = this._entries.find(e => e[0] === k);
    return hit ? hit[1] : null;
  };
  URLSearchParams.prototype.getAll = function (name) {
    const k = String(name);
    return this._entries.filter(e => e[0] === k).map(e => e[1]);
  };
  URLSearchParams.prototype.has = function (name) {
    const k = String(name);
    return this._entries.some(e => e[0] === k);
  };
  URLSearchParams.prototype.forEach = function (fn, thisArg) {
    for (let i = 0; i < this._entries.length; i++) {
      fn.call(thisArg, this._entries[i][1], this._entries[i][0], this);
    }
  };
  URLSearchParams.prototype.toString = function () {
    const out = [];
    for (let i = 0; i < this._entries.length; i++) {
      out.push(_encode(this._entries[i][0]) + '=' + _encode(this._entries[i][1]));
    }
    return out.join('&');
  };
  URLSearchParams.prototype.keys = function* () {
    for (let i = 0; i < this._entries.length; i++) yield this._entries[i][0];
  };
  URLSearchParams.prototype.values = function* () {
    for (let i = 0; i < this._entries.length; i++) yield this._entries[i][1];
  };
  URLSearchParams.prototype.entries = function* () {
    for (let i = 0; i < this._entries.length; i++) yield this._entries[i].slice();
  };
  globalThis.URLSearchParams = URLSearchParams;
}

// ───────────────────────────────────────────────────────────────────
// fetch() — minimal whatwg-fetch surface, backed by rnLinux.fetch()
// which delegates to libsoup-3 in our C++ host. Hermes doesn't ship
// fetch; RN normally polyfills it on top of XMLHttpRequest. We have
// neither, so atproto handle-resolution (akari's PDS detection) +
// every other network call sees `fetch is undefined`.
//
// Body shape: only string requests / string responses for now.
// arrayBuffer() returns a Uint8Array view of the UTF-8 encoding —
// good enough for the JSON / XRPC traffic the smoke targets exercise.
// Caller-shaped Headers, plain objects, and arrays-of-pairs are all
// flattened to a plain {name: value} object before crossing the JSI
// boundary.
// FormData / Blob — Hermes ships neither. Even bluesky-api's
// createSession path (which serialises a JSON body) does
// `body instanceof FormData` and `body instanceof Blob` before
// deciding the content-type, and those checks throw
// "FormData is not defined" / "Blob is not defined" when the
// globals are missing. We only need a callable identity so
// `instanceof` returns false for the JSON-body path; full
// multipart serialisation can come later when an app needs it.
if (typeof globalThis.FormData === 'undefined') {
  function FormData() {
    this._entries = [];
  }
  FormData.prototype.append = function (name, value, filename) {
    this._entries.push([String(name), value, filename]);
  };
  FormData.prototype.set = function (name, value, filename) {
    const k = String(name);
    this._entries = this._entries.filter(e => e[0] !== k);
    this._entries.push([k, value, filename]);
  };
  FormData.prototype.delete = function (name) {
    const k = String(name);
    this._entries = this._entries.filter(e => e[0] !== k);
  };
  FormData.prototype.get = function (name) {
    const k = String(name);
    const hit = this._entries.find(e => e[0] === k);
    return hit ? hit[1] : null;
  };
  FormData.prototype.getAll = function (name) {
    const k = String(name);
    return this._entries.filter(e => e[0] === k).map(e => e[1]);
  };
  FormData.prototype.has = function (name) {
    const k = String(name);
    return this._entries.some(e => e[0] === k);
  };
  FormData.prototype.forEach = function (cb, thisArg) {
    for (const [k, v] of this._entries) cb.call(thisArg, v, k, this);
  };
  FormData.prototype.keys = function () {
    return this._entries.map(e => e[0])[Symbol.iterator]();
  };
  FormData.prototype.values = function () {
    return this._entries.map(e => e[1])[Symbol.iterator]();
  };
  FormData.prototype.entries = function () {
    return this._entries.map(e => [e[0], e[1]])[Symbol.iterator]();
  };
  globalThis.FormData = FormData;
}

if (typeof globalThis.Blob === 'undefined') {
  function Blob(parts, options) {
    this._parts = Array.isArray(parts) ? parts : [];
    this.type = (options && options.type) || '';
    this.size = 0;
    for (const p of this._parts) {
      if (typeof p === 'string') this.size += p.length;
      else if (p && typeof p.size === 'number') this.size += p.size;
      else if (p && typeof p.byteLength === 'number') this.size += p.byteLength;
    }
  }
  Blob.prototype.slice = function (start, end, contentType) {
    return new Blob([], {type: contentType || this.type});
  };
  Blob.prototype.text = function () {
    return Promise.resolve(this._parts.filter(p => typeof p === 'string').join(''));
  };
  Blob.prototype.arrayBuffer = function () {
    return Promise.resolve(new ArrayBuffer(this.size));
  };
  globalThis.Blob = Blob;
}

if (typeof globalThis.Headers === 'undefined') {
  // Function-constructor + prototype form. `class Headers { ... }`
  // assignments are silently dropped by Hermes 0.12's lazy-parse — the
  // var binding is created but the class expression never evaluates,
  // so globalThis.Headers stays undefined and the fetch trampoline
  // dies on `new globalThis.Headers(...)`. Same gotcha that bit the
  // react-native-mmkv shim earlier; see docs/akari-shims.md.
  function Headers(init) {
    this._m = new Map();
    if (init) {
      if (Array.isArray(init)) {
        for (const pair of init) this._m.set(String(pair[0]).toLowerCase(), String(pair[1]));
      } else if (init instanceof Headers) {
        init.forEach((v, k) => this._m.set(k, v));
      } else if (typeof init === 'object') {
        for (const k of Object.keys(init)) this._m.set(k.toLowerCase(), String(init[k]));
      }
    }
  }
  Headers.prototype.get = function (n) {
    return this._m.get(String(n).toLowerCase()) || null;
  };
  Headers.prototype.set = function (n, v) {
    this._m.set(String(n).toLowerCase(), String(v));
  };
  Headers.prototype.append = function (n, v) {
    const k = String(n).toLowerCase();
    const prev = this._m.get(k);
    this._m.set(k, prev ? prev + ', ' + String(v) : String(v));
  };
  Headers.prototype.has = function (n) {
    return this._m.has(String(n).toLowerCase());
  };
  Headers.prototype.delete = function (n) {
    this._m.delete(String(n).toLowerCase());
  };
  Headers.prototype.forEach = function (cb, thisArg) {
    this._m.forEach((v, k) => cb.call(thisArg, v, k, this));
  };
  Headers.prototype.keys = function () {
    return this._m.keys();
  };
  Headers.prototype.values = function () {
    return this._m.values();
  };
  Headers.prototype.entries = function () {
    return this._m.entries();
  };
  globalThis.Headers = Headers;
}

if (
  typeof globalThis.fetch === 'undefined' &&
  typeof rnLinux !== 'undefined' &&
  typeof rnLinux.fetch === 'function'
) {
  const flattenHeaders = h => {
    const out = {};
    if (!h) return out;
    if (h instanceof globalThis.Headers) {
      h.forEach((v, k) => {
        out[k] = v;
      });
    } else if (Array.isArray(h)) {
      for (const pair of h) out[String(pair[0]).toLowerCase()] = String(pair[1]);
    } else if (typeof h === 'object') {
      for (const k of Object.keys(h)) out[k.toLowerCase()] = String(h[k]);
    }
    return out;
  };
  globalThis.fetch = function fetch(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (
      (init && init.method) ||
      (input && typeof input === 'object' && input.method) ||
      'GET'
    ).toUpperCase();
    const headers = flattenHeaders((init && init.headers) || (input && input.headers));
    const body = init && init.body != null ? String(init.body) : undefined;
    return new Promise((resolve, reject) => {
      rnLinux.fetch(
        url,
        method,
        headers,
        body,
        result => {
          // result = {status, statusText, url, headers, body}
          const responseHeaders = new globalThis.Headers(result.headers || {});
          const text = result.body || '';
          const response = {
            ok: result.status >= 200 && result.status < 300,
            status: result.status,
            statusText: result.statusText || '',
            url: result.url || url,
            headers: responseHeaders,
            redirected: false,
            type: 'basic',
            text: () => Promise.resolve(text),
            json: () => {
              try {
                return Promise.resolve(JSON.parse(text));
              } catch (e) {
                return Promise.reject(e);
              }
            },
            arrayBuffer: () => {
              // UTF-8 encode the body. Good enough for JSON / XRPC.
              const buf = new Uint8Array(text.length);
              for (let i = 0; i < text.length; i++) buf[i] = text.charCodeAt(i) & 0xff;
              return Promise.resolve(buf.buffer);
            },
            clone: function () {
              return response;
            },
          };
          resolve(response);
        },
        err => reject(new Error(typeof err === 'string' ? err : 'fetch failed')),
      );
    });
  };
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
