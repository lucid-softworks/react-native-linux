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
}

AnimatedValue.prototype.setValue = function (v) {
  if (v === this._value) return;
  this._value = v;
  const cbs = this._listeners.values();
  for (const cb of cbs) cb({value: v});
};

AnimatedValue.prototype.__getValue = function () {
  return this._value;
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

function InterpolatedValue(source, config) {
  this._source = source;
  this._in = config.inputRange;
  this._out = config.outputRange;
  this._extrapolate = config.extrapolate || 'extend';
  this._listeners = new Map();
  const self = this;
  this._sourceSub = source.addListener(function () {
    const cbs = self._listeners.values();
    for (const cb of cbs) cb({value: self.__getValue()});
  });
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

function extrapolate(x, x0, x1, y0, y1) {
  if (typeof y0 === 'string' || typeof y1 === 'string') {
    // For non-numeric outputs (e.g. colours) we just pick the
    // nearest range bound. A full colour interpolator would lerp
    // RGB, but RN's basic API uses this fallback too for unrecognised
    // shapes.
    const t = (x - x0) / (x1 - x0);
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
  let from = 0;
  let start = 0;
  let raf = 0;
  let onDone = null;
  let cancelled = false;

  function step(t) {
    if (cancelled) return;
    if (!start) {
      start = t;
      from = value.__getValue();
    }
    const elapsed = t - start;
    if (elapsed >= duration) {
      value.setValue(toValue);
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
      raf = globalThis.requestAnimationFrame(step);
    },
    stop() {
      cancelled = true;
      if (raf) globalThis.cancelAnimationFrame(raf);
      if (onDone) onDone({finished: false});
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
const NATIVE_DRIVEABLE_TRANSFORM = new Set(['translateX', 'translateY']);

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
      for (const {value, prop} of native) {
        if (hasSetter) {
          rnLinux.setNativeProp(animId, prop, value.__getValue());
        }
        const id = value.addListener(({value: v}) => {
          if (hasSetter) rnLinux.setNativeProp(animId, prop, v);
        });
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
  View: createAnimatedComponent(View),
  Text: createAnimatedComponent(Text),
  Image: createAnimatedComponent(Image),
  ScrollView: createAnimatedComponent(ScrollView),
  createAnimatedComponent,
  timing,
  sequence,
  parallel,
  loop,
};

module.exports = {Animated, Easing};
