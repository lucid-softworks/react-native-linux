'use strict';

// Minimal Animated implementation — enough to cover RN's most-used
// surfaces (opacity fade, slide via translate, scale). Real RN ships
// a much bigger module with a native driver, interpolators, multi-
// value compositions, etc.; everything here is the JS-driver path,
// using our requestAnimationFrame shim (~60fps GLib timer).
//
// Public surface:
//   Animated.Value(initial)
//     .setValue(v)
//     .interpolate({inputRange, outputRange})
//     .addListener(cb)
//   Animated.timing(value, {toValue, duration, easing, useNativeDriver})
//     .start(cb?)
//   Animated.sequence([anims]) / Animated.parallel([anims])
//   Animated.loop(anim, {iterations})
//   Animated.View / Animated.Text — wrappers that subscribe to any
//     AnimatedValue passed through `style` and re-render with the
//     resolved scalar.

const React = require('react');
const {View, Text, Image, ScrollView} = require('./components');

// ───────────── value + interpolation ────────────────────────────
//
// Function-constructor style on purpose. Hermes' bytecode compiler
// (vnext/build/bin/hermesc -emit-binary, which we run on the vendor
// bundle for fast cold-start eval) refuses `var X = class {...}` —
// the form esbuild emits when it lowers a top-level class
// declaration into a CommonJS wrapper. Function constructors +
// prototype assignments compile cleanly.

let nextValueId = 0;

function AnimatedValue(initial) {
  this._value = initial == null ? 0 : initial;
  this._listeners = new Map();
  this._id = ++nextValueId;
  // Set to >0 while a useNativeDriver:true animation is driving this
  // value. setValue checks it and skips React-side listeners, leaving
  // only the C++ setNativeProp path to fire — that's the per-frame
  // saving (no fiber reconciliation, no Fabric mount transaction).
  this._nativeOnly = 0;
}

AnimatedValue.prototype.setValue = function (v) {
  if (v === this._value) return;
  this._value = v;
  // When a timing call honours useNativeDriver:true, _nativeOnly>0 for
  // the lifetime of the animation. Skip non-native listeners so React
  // doesn't re-render every frame — only the setNativeProp listeners
  // (which are tagged `cb._native = true`) fire.
  const nativeOnly = this._nativeOnly > 0;
  const cbs = this._listeners.values();
  for (const cb of cbs) {
    if (nativeOnly && !cb._native) continue;
    cb({value: v});
  }
};

AnimatedValue.prototype.__getValue = function () {
  return this._value;
};

// stopAnimation matches RN's API surface — paper / reanimated / etc.
// call it on layout effects to cancel mid-flight transitions before
// remounting. We don't track in-flight animations per-Value yet, so
// this is a no-op that satisfies the call site.
AnimatedValue.prototype.stopAnimation = function (cb) {
  if (typeof cb === 'function') cb(this._value);
};
// removeAllListeners — same: paper cleans up subscriptions on unmount.
AnimatedValue.prototype.removeAllListeners = function () {
  this._listeners = {};
};
AnimatedValue.prototype.addListener = function (cb) {
  const id = String(++nextValueId);
  this._listeners.set(id, cb);
  return id;
};

AnimatedValue.prototype.removeListener = function (id) {
  this._listeners.delete(id);
};

AnimatedValue.prototype.removeAllListeners = function () {
  this._listeners.clear();
};

AnimatedValue.prototype.interpolate = function (config) {
  return new InterpolatedValue(this, config);
};

// Two-axis Animated.Value. Used by PanResponder and any draggable
// affordance — a single ValueXY simultaneously drives an X and a Y
// AnimatedValue, with offset/extract semantics so a gesture handler
// can start a new drag from where the previous one ended.
//
// All the same listener/setValue rules as AnimatedValue, applied
// independently to each axis.
function AnimatedValueXY(initial) {
  const init = initial && typeof initial === 'object' ? initial : {x: 0, y: 0};
  this.x = new AnimatedValue(init.x ?? 0);
  this.y = new AnimatedValue(init.y ?? 0);
  // offset is added on top of the .x / .y base values; getLayout/
  // getTranslateTransform read base + offset. setOffset moves the
  // baseline; flattenOffset folds the offset into the base values
  // and zeroes it; extractOffset does the opposite. Mirrors RN's
  // AnimatedValueXY semantics so drag handlers that lock the value
  // at pan-start work unchanged.
  this._offset = {x: 0, y: 0};
}

AnimatedValueXY.prototype.setValue = function (v) {
  if (v && typeof v === 'object') {
    if (v.x != null) this.x.setValue(v.x);
    if (v.y != null) this.y.setValue(v.y);
  }
};

AnimatedValueXY.prototype.setOffset = function (v) {
  if (v && typeof v === 'object') {
    if (v.x != null) this._offset.x = v.x;
    if (v.y != null) this._offset.y = v.y;
  }
};

AnimatedValueXY.prototype.flattenOffset = function () {
  this.x.setValue(this.x.__getValue() + this._offset.x);
  this.y.setValue(this.y.__getValue() + this._offset.y);
  this._offset.x = 0;
  this._offset.y = 0;
};

AnimatedValueXY.prototype.extractOffset = function () {
  this._offset.x += this.x.__getValue();
  this._offset.y += this.y.__getValue();
  this.x.setValue(0);
  this.y.setValue(0);
};

AnimatedValueXY.prototype.__getValue = function () {
  return {
    x: this.x.__getValue() + this._offset.x,
    y: this.y.__getValue() + this._offset.y,
  };
};

AnimatedValueXY.prototype.getLayout = function () {
  // Style-bag form a draggable View typically composes with its
  // existing absolute layout: <View style={[base, valueXY.getLayout()]}>
  // pushes (left, top) without overwriting other style fields.
  return {left: this.x, top: this.y};
};

AnimatedValueXY.prototype.getTranslateTransform = function () {
  // Transform-array form: <View style={{transform: valueXY.getTranslateTransform()}}>.
  // Each entry rides through resolveStyle and reads .__getValue() per
  // frame on the React-side path, or drives setNativeProps on the
  // native-driver path.
  return [{translateX: this.x}, {translateY: this.y}];
};

AnimatedValueXY.prototype.addListener = function (cb) {
  // Single combined listener fires on either-axis change with both
  // current values. RN's ValueXY emits {x, y} on each tick of either
  // axis — apps that track drag deltas read both fields each call.
  const self = this;
  const handler = function () {
    cb({x: self.x.__getValue() + self._offset.x, y: self.y.__getValue() + self._offset.y});
  };
  handler._native = true;
  const ix = this.x.addListener(handler);
  const iy = this.y.addListener(handler);
  return ix + ':' + iy;
};

AnimatedValueXY.prototype.removeListener = function (id) {
  const [ix, iy] = id.split(':');
  this.x.removeListener(ix);
  this.y.removeListener(iy);
};

AnimatedValueXY.prototype.removeAllListeners = function () {
  this.x.removeAllListeners();
  this.y.removeAllListeners();
};

AnimatedValueXY.prototype.stopAnimation = function (cb) {
  this.x.stopAnimation();
  this.y.stopAnimation();
  if (typeof cb === 'function') cb(this.__getValue());
};

function InterpolatedValue(source, config) {
  this._source = source;
  this._in = config.inputRange;
  this._out = config.outputRange;
  this._extrapolate = config.extrapolate || 'extend';
  this._listeners = new Map();
  const self = this;
  // The forwarder has to be marked `_native` so it keeps firing while
  // the SOURCE AnimatedValue is being driven natively (useNativeDriver
  // suppresses non-native listeners on the source — without this flag
  // every InterpolatedValue derived from a native-driven source goes
  // silent for the duration of the animation, and any consumer
  // listening on the interpolation never sees a tick).
  const forwarder = function () {
    const cbs = self._listeners.values();
    for (const cb of cbs) cb({value: self.__getValue()});
  };
  forwarder._native = true;
  this._sourceSub = source.addListener(forwarder);
}

InterpolatedValue.prototype.__getValue = function () {
  const x = this._source.__getValue();
  const ranges = this._in;
  const out = this._out;
  if (x <= ranges[0]) {
    return this._extrapolate === 'clamp'
      ? out[0]
      : extrapolate(x, ranges[0], ranges[1], out[0], out[1]);
  }
  if (x >= ranges[ranges.length - 1]) {
    const i = ranges.length - 1;
    return this._extrapolate === 'clamp'
      ? out[i]
      : extrapolate(x, ranges[i - 1], ranges[i], out[i - 1], out[i]);
  }
  for (let i = 1; i < ranges.length; i++) {
    if (x < ranges[i]) {
      return extrapolate(x, ranges[i - 1], ranges[i], out[i - 1], out[i]);
    }
  }
  return out[out.length - 1];
};

InterpolatedValue.prototype.addListener = function (cb) {
  const id = String(++nextValueId);
  this._listeners.set(id, cb);
  return id;
};
InterpolatedValue.prototype.removeListener = function (id) {
  this._listeners.delete(id);
};
InterpolatedValue.prototype.removeAllListeners = function () {
  this._listeners.clear();
};

// Tight named-color subset matching what fabricHostConfig knows about
// — the inverse direction (string → [r,g,b,a]) lives there. Kept
// duplicated rather than imported because the host config is a leaf
// module and we don't want to introduce a JS-side dep cycle just for
// an animation helper.
const ANIM_NAMED_COLORS = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 255],
  white: [255, 255, 255, 255],
  red: [255, 0, 0, 255],
  green: [0, 128, 0, 255],
  blue: [0, 0, 255, 255],
  yellow: [255, 255, 0, 255],
  gray: [128, 128, 128, 255],
  grey: [128, 128, 128, 255],
  orange: [255, 165, 0, 255],
  pink: [255, 192, 203, 255],
};

// Parse a CSS-style color string into [r, g, b, a] with channels 0-255
// and alpha 0-1. Returns null if the input doesn't match any known
// shape, so extrapolate() can fall back to the nearest-bound
// behaviour instead of producing rgba(NaN, …).
function parseColorString(c) {
  if (typeof c !== 'string') return null;
  const named = ANIM_NAMED_COLORS[c.toLowerCase()];
  if (named) return named.slice();
  let m;
  if ((m = /^#([0-9a-f]{6})$/i.exec(c))) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 255];
  }
  if ((m = /^#([0-9a-f]{8})$/i.exec(c))) {
    const n = parseInt(m[1], 16);
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }
  if ((m = /^#([0-9a-f]{3})$/i.exec(c))) {
    const s = m[1];
    return [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), 255];
  }
  if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c))) {
    return [+m[1], +m[2], +m[3], m[4] != null ? +m[4] * 255 : 255];
  }
  return null;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
function clamp1(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerpColor(c0, c1, t) {
  const a = parseColorString(c0);
  const b = parseColorString(c1);
  if (!a || !b) return null;
  // extrapolate-mode 'extend' lets t fall outside [0,1]; clamp the
  // channels to legal CSS ranges so we never produce rgba(-12, …)
  // or alpha > 1 which fabricHostConfig.normalizeColor's regex
  // rejects.
  const r = Math.round(clamp255(a[0] + (b[0] - a[0]) * t));
  const g = Math.round(clamp255(a[1] + (b[1] - a[1]) * t));
  const bl = Math.round(clamp255(a[2] + (b[2] - a[2]) * t));
  const al = clamp1((a[3] + (b[3] - a[3]) * t) / 255);
  return 'rgba(' + r + ', ' + g + ', ' + bl + ', ' + al.toFixed(3) + ')';
}

function extrapolate(x, x0, x1, y0, y1) {
  if (typeof y0 === 'string' || typeof y1 === 'string') {
    const t = (x - x0) / (x1 - x0);
    const lerped = lerpColor(y0, y1, t);
    // lerpColor returns null when either endpoint isn't a recognised
    // colour string (degrees, unit suffixes, transform keywords, …).
    // Fall back to the original nearest-bound behaviour there so we
    // never emit rgba(NaN) into the prop bag.
    if (lerped !== null) return lerped;
    return t < 0.5 ? y0 : y1;
  }
  const t = (x - x0) / (x1 - x0);
  return y0 + (y1 - y0) * t;
}

// ───────────── easings ──────────────────────────────────────────

const Easing = {
  linear: t => t,
  ease: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t,
  out: t => 1 - (1 - t) * (1 - t),
  inOut: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
};

// ───────────── timing / sequence / parallel / loop ──────────────

function timing(value, config) {
  const toValue = config.toValue;
  const duration = config.duration ?? 250;
  const easing = config.easing ?? Easing.linear;
  // RN-compat: when useNativeDriver:true the per-frame setValue should
  // bypass React listeners (only the setNativeProp listener fires).
  // Honour it for AnimatedValues only — InterpolatedValues don't have
  // their own _nativeOnly; the upstream source's flag governs.
  const useNative = config.useNativeDriver === true && typeof value._nativeOnly === 'number';
  let from = 0;
  let start = 0;
  let raf = 0;
  let onDone = null;
  let cancelled = false;
  let entered = false;

  function enter() {
    if (entered || !useNative) return;
    entered = true;
    value._nativeOnly += 1;
  }
  function exit() {
    if (!entered) return;
    entered = false;
    value._nativeOnly = Math.max(0, value._nativeOnly - 1);
  }

  function step(t) {
    if (cancelled) {
      exit();
      return;
    }
    if (!start) {
      start = t;
      from = value.__getValue();
    }
    const elapsed = t - start;
    if (elapsed >= duration) {
      value.setValue(toValue);
      exit();
      if (onDone) onDone({finished: true});
      return;
    }
    const p = easing(elapsed / duration);
    value.setValue(from + (toValue - from) * p);
    raf = globalThis.requestAnimationFrame(step);
  }

  return {
    start(cb) {
      onDone = cb;
      enter();
      raf = globalThis.requestAnimationFrame(step);
    },
    stop() {
      cancelled = true;
      exit();
      if (raf) globalThis.cancelAnimationFrame(raf);
      if (onDone) onDone({finished: false});
    },
  };
}

// Damped harmonic oscillator: dx/dt = v, dv/dt = -(k·x + c·v) / m.
// Mirrors RN's spring physics from Animated/animations/SpringAnimation
// (stiffness/damping form). The legacy bouncy/tension+friction config
// names map onto stiffness/damping via the same constants RN uses, so
// existing apps drop in unchanged.
//
// We integrate with a fixed-step RK4 substep inside the rAF callback
// (one rAF tick = one integration "frame" of duration `dt` in seconds),
// which keeps the simulation stable when frame intervals vary on the
// software-paint VM. The substep count (1 ms each) is small enough
// that a long-paused tab catching up doesn't blow the spring past
// `toValue` and oscillate forever.
function timingSpring(value, config) {
  const toValue = config.toValue;
  // Same defaults RN ships. tension/friction shortcuts re-map to
  // stiffness/damping via the upstream `fromOrigamiTensionAndFriction`
  // identity (tension*0.62 + 1, friction*0.65 + 0.65) — close enough
  // for desktop UI use without porting Origami's full Pop interpolator.
  const stiffness = config.stiffness ?? (config.tension != null ? config.tension * 0.62 + 1 : 100);
  const damping = config.damping ?? (config.friction != null ? config.friction * 0.65 + 0.65 : 10);
  const mass = config.mass ?? 1;
  const initialVelocity = config.velocity ?? 0;
  const restDispThreshold = config.restDisplacementThreshold ?? 0.001;
  const restSpeedThreshold = config.restSpeedThreshold ?? 0.001;
  const overshootClamping = config.overshootClamping === true;
  const useNative = config.useNativeDriver === true && typeof value._nativeOnly === 'number';

  let from = 0;
  let v = initialVelocity;
  let lastT = 0;
  let raf = 0;
  let onDone = null;
  let cancelled = false;
  let entered = false;

  function enter() {
    if (entered || !useNative) return;
    entered = true;
    value._nativeOnly += 1;
  }
  function exit() {
    if (!entered) return;
    entered = false;
    value._nativeOnly = Math.max(0, value._nativeOnly - 1);
  }

  function step(t) {
    if (cancelled) {
      exit();
      return;
    }
    if (!lastT) {
      lastT = t;
      from = value.__getValue();
    }
    // dt is in seconds. Clamp to 64 ms / substep at most so a stalled
    // tab can't inject one giant timestep that explodes the spring.
    let dt = Math.min(0.064, (t - lastT) / 1000);
    lastT = t;

    // Semi-implicit Euler with 1 ms substeps. Simpler than RK4 and
    // numerically stable for the range of stiffness/damping desktop UI
    // springs typically use (Origami's slowest is ~stiffness=50,
    // damping=10 — well within the stable region at 1 ms).
    const subStep = 0.001;
    let x = from;
    while (dt > 0) {
      const h = Math.min(subStep, dt);
      const springForce = -stiffness * (x - toValue);
      const dampingForce = -damping * v;
      const a = (springForce + dampingForce) / mass;
      v += a * h;
      x += v * h;
      dt -= h;
    }
    from = x;

    // Stop when we've come to rest near toValue. overshootClamping
    // additionally snaps from past-toValue back to toValue — common
    // for Modal slide-up where overshoot looks broken.
    const atRest = Math.abs(v) < restSpeedThreshold && Math.abs(x - toValue) < restDispThreshold;
    const clamped = overshootClamping && ((v < 0 && x < toValue) || (v > 0 && x > toValue));
    if (atRest || clamped) {
      value.setValue(toValue);
      exit();
      if (onDone) onDone({finished: true});
      return;
    }
    value.setValue(x);
    raf = globalThis.requestAnimationFrame(step);
  }

  return {
    start(cb) {
      onDone = cb;
      enter();
      raf = globalThis.requestAnimationFrame(step);
    },
    stop() {
      cancelled = true;
      exit();
      if (raf) globalThis.cancelAnimationFrame(raf);
      if (onDone) onDone({finished: false});
    },
  };
}

// Animated.delay(ms) is just an animation handle that resolves
// `finished: true` after `ms` ms. Used inside sequence() to space out
// the steps of a multi-stage reveal.
function delay(ms) {
  let id = 0;
  let onDone = null;
  let cancelled = false;
  return {
    start(cb) {
      onDone = cb;
      id = globalThis.setTimeout(() => {
        id = 0;
        if (!cancelled && onDone) onDone({finished: true});
      }, ms);
    },
    stop() {
      cancelled = true;
      if (id) globalThis.clearTimeout(id);
      if (onDone) onDone({finished: false});
    },
  };
}

// Animated.stagger(time, animations) starts the i-th animation `i*time`
// ms after the call. Common for list reveals — each item slides up
// one tick after the previous. Resolves `finished` only after EVERY
// child resolves; stop cancels them all.
function stagger(time, anims) {
  let cancelled = false;
  let done = 0;
  const timeouts = [];
  return {
    start(cb) {
      if (anims.length === 0) {
        if (cb) cb({finished: true});
        return;
      }
      let anyUnfinished = false;
      anims.forEach((a, i) => {
        const id = globalThis.setTimeout(() => {
          if (cancelled) return;
          a.start(result => {
            if (!result.finished) anyUnfinished = true;
            done++;
            if (done === anims.length && cb) {
              cb({finished: !anyUnfinished && !cancelled});
            }
          });
        }, i * time);
        timeouts.push(id);
      });
    },
    stop() {
      cancelled = true;
      timeouts.forEach(id => globalThis.clearTimeout(id));
      anims.forEach(a => a.stop());
    },
  };
}

function sequence(anims) {
  let i = 0;
  let current = null;
  let cancelled = false;
  return {
    start(cb) {
      function next() {
        if (cancelled || i >= anims.length) {
          if (cb) cb({finished: !cancelled});
          return;
        }
        current = anims[i++];
        current.start(result => {
          if (result.finished) next();
          else if (cb) cb(result);
        });
      }
      next();
    },
    stop() {
      cancelled = true;
      if (current) current.stop();
    },
  };
}

function parallel(anims) {
  let done = 0;
  let cancelled = false;
  return {
    start(cb) {
      anims.forEach(a => {
        a.start(result => {
          done++;
          if (done === anims.length && cb) {
            cb({finished: !cancelled && result.finished});
          }
        });
      });
    },
    stop() {
      cancelled = true;
      anims.forEach(a => a.stop());
    },
  };
}

function loop(anim, {iterations = -1} = {}) {
  let i = 0;
  let cancelled = false;
  return {
    start(cb) {
      function next() {
        if (cancelled || (iterations >= 0 && i >= iterations)) {
          if (cb) cb({finished: !cancelled});
          return;
        }
        i++;
        anim.start(result => {
          if (result.finished) next();
          else if (cb) cb(result);
        });
      }
      next();
    },
    stop() {
      cancelled = true;
      anim.stop();
    },
  };
}

// ───────────── createAnimatedComponent ──────────────────────────
//
// Subscribes to any Animated.Value or InterpolatedValue that shows
// up in the `style` prop and forces a re-render whenever it changes.
// The re-render reads the current scalar and ships a plain object
// down to the host config — Fabric never sees the AnimatedValue.

function isAnimated(x) {
  return !!x && (x instanceof AnimatedValue || x instanceof InterpolatedValue);
}

// Props we can drive directly via the rnLinux.setNativeProp C++ binding —
// no React re-render, no Fabric commit, no mount transaction per frame.
// Mirrors what RN's "useNativeDriver" supports: opacity + transform
// translates. Anything else falls back to the slow path (forceUpdate +
// reconcile + commit + mount).
const NATIVE_DRIVEABLE_TOP_LEVEL = new Set(['opacity']);
const NATIVE_DRIVEABLE_TRANSFORM = new Set([
  'translateX',
  'translateY',
  'scale',
  'scaleX',
  'scaleY',
]);

function resolveStyle(style) {
  if (style == null || style === false) return style;
  if (Array.isArray(style)) return style.map(resolveStyle);
  if (typeof style !== 'object') return style;
  const out = {};
  for (const k in style) {
    const v = style[k];
    // `transform` is an array of single-key objects, each of which can
    // carry an animated value. Fabric chokes on AnimatedValue objects
    // in props, so resolve them to their current scalar even when
    // native-driven (the native binding overwrites the GTK position
    // every tick; this is just the React-side snapshot).
    if (k === 'transform' && Array.isArray(v)) {
      out[k] = v.map(entry => {
        if (entry == null || typeof entry !== 'object') return entry;
        const resolved = {};
        for (const tk in entry) {
          const tv = entry[tk];
          resolved[tk] = isAnimated(tv) ? tv.__getValue() : tv;
        }
        return resolved;
      });
    } else {
      out[k] = isAnimated(v) ? v.__getValue() : v;
    }
  }
  return out;
}

// Walk `style` and collect `{value, prop}` pairs for every Animated
// occurrence. Native bindings get the GTK property name we want to
// drive; React bindings get the value alone (the listener calls
// forceUpdate). Same value can be in both lists if it appears in
// multiple slots — that's a degenerate case the playground doesn't
// hit, but we handle it correctly by registering distinct listeners.
function classifyAnimatedValues(style, native, react) {
  if (style == null || style === false) return;
  if (Array.isArray(style)) {
    style.forEach(s => classifyAnimatedValues(s, native, react));
    return;
  }
  if (typeof style !== 'object') return;
  for (const k in style) {
    const v = style[k];
    if (k === 'transform' && Array.isArray(v)) {
      // transform: [{translateX: v1}, {scale: v2}, ...]
      for (const entry of v) {
        if (entry == null || typeof entry !== 'object') continue;
        for (const tk in entry) {
          const tv = entry[tk];
          if (!isAnimated(tv)) continue;
          if (NATIVE_DRIVEABLE_TRANSFORM.has(tk)) {
            native.push({value: tv, prop: tk});
          } else {
            react.push(tv);
          }
        }
      }
      continue;
    }
    if (!isAnimated(v)) continue;
    if (NATIVE_DRIVEABLE_TOP_LEVEL.has(k)) {
      native.push({value: v, prop: k});
    } else {
      react.push(v);
    }
  }
}

let nextAnimId = 1;

function createAnimatedComponent(Inner) {
  return function AnimatedHost(props) {
    const [, force] = React.useReducer(n => n + 1, 0);
    // Stable nativeID for the lifetime of this host. The C++ side
    // (ViewComponentView::updateProps) registers a `nativeID → widget`
    // mapping on this string, so listeners can call setNativeProp
    // without going through a React ref (our reconciler does not
    // support refs cleanly yet — passing one crashes Fabric).
    const animIdRef = React.useRef(null);
    if (animIdRef.current === null) {
      animIdRef.current = 'rnl-anim-' + nextAnimId++;
    }
    const animId = animIdRef.current;

    React.useEffect(() => {
      const native = [];
      const react = [];
      classifyAnimatedValues(props.style, native, react);

      const subs = [];
      const hasSetter = typeof rnLinux !== 'undefined' && rnLinux.setNativeProp;
      const hasBatchSetter = typeof rnLinux !== 'undefined' && rnLinux.setNativeProps;

      // Per-host pending bag. Multiple AnimatedValues firing on the
      // same rAF tick (Paper's floating-label rides translateX +
      // translateY + scale together) each push into `pending`; a
      // microtask flushes once via rnLinux.setNativeProps so the C++
      // side rebuilds the GskTransform a single time per frame
      // instead of N times.
      //
      // Microtask is the right hook: AnimatedValue.setValue → native
      // listener runs synchronously inside the rAF callback; all of
      // them have fired by the time the rAF returns. Hermes drains
      // microtasks after the rAF callback, so the flush sees the
      // complete bag.
      const pending = {};
      let scheduled = false;
      function flush() {
        scheduled = false;
        if (hasBatchSetter) {
          rnLinux.setNativeProps(animId, pending);
        } else if (hasSetter) {
          for (const k in pending) {
            rnLinux.setNativeProp(animId, k, pending[k]);
          }
        }
        for (const k in pending) delete pending[k];
      }
      function enqueue(prop, v) {
        pending[prop] = v;
        if (scheduled) return;
        scheduled = true;
        globalThis.queueMicrotask(flush);
      }

      // Initial sync: seed the bag with the current values + flush
      // once so the widget reflects the right state before any timing
      // call starts. Without this, an Animated.View mounting with a
      // non-zero starting opacity / translate stays at the GTK
      // default (1, 0) until the first animation tick.
      for (const {value, prop} of native) {
        pending[prop] = value.__getValue();
      }
      if (native.length && (hasBatchSetter || hasSetter)) {
        flush();
      }

      for (const {value, prop} of native) {
        const nativeCb = ({value: v}) => enqueue(prop, v);
        nativeCb._native = true;
        const id = value.addListener(nativeCb);
        subs.push({value, id});
      }
      for (const value of react) {
        const id = value.addListener(() => force());
        subs.push({value, id});
      }
      return () => {
        subs.forEach(({value, id}) => value.removeListener(id));
      };
    }, [props.style, animId]);

    return React.createElement(Inner, {
      ...props,
      nativeID: animId,
      style: resolveStyle(props.style),
    });
  };
}

// ───────────── module export ────────────────────────────────────

const Animated = {
  Value: AnimatedValue,
  ValueXY: AnimatedValueXY,
  View: createAnimatedComponent(View),
  Text: createAnimatedComponent(Text),
  Image: createAnimatedComponent(Image),
  ScrollView: createAnimatedComponent(ScrollView),
  createAnimatedComponent,
  timing,
  spring: timingSpring,
  delay,
  stagger,
  sequence,
  parallel,
  loop,
};

module.exports = {Animated, Easing};
