'use strict';

// moti shim. Real moti is a Reanimated-powered animation DSL that
// wraps RN primitives with a declarative `from` / `animate` / `exit`
// prop API:
//
//   <MotiView from={{opacity: 0}} animate={{opacity: 1}} transition={{type: 'timing'}} />
//
// We don't have Reanimated worklets, so the shim degrades to a JS-
// only Animated.timing equivalent: the component mounts at the
// `animate` values directly (skipping the `from` interpolation), so
// the steady-state matches but the transition is instant. For smoke
// coverage this is enough — the mount succeeds and pixels appear.
//
// What's exported:
//   * MotiView / MotiText / MotiImage / MotiScrollView / motify
//   * useDynamicAnimation (returns an `animationState` object with
//     animateTo(values), current, addListener no-ops)
//   * useAnimationState (canned states API; the current state's
//     values become the animate prop)
//   * AnimatePresence (no-op wrapper that just renders children)

const React = require('react');
const RN = require('react-native');

function makeMoti(Inner) {
  return function MotiInner(props) {
    const {from: _from, animate, exit: _exit, transition: _t, delay: _d, style, ...rest} = props;
    // Compose animate values into the style bag. If `animate` is a
    // plain object, treat its entries as style props.
    const animatedStyle =
      animate && typeof animate === 'object' && !Array.isArray(animate) ? animate : null;
    return React.createElement(Inner, {
      ...rest,
      style: animatedStyle ? [style, animatedStyle] : style,
    });
  };
}

const MotiView = makeMoti(RN.View);
const MotiText = makeMoti(RN.Text);
const MotiImage = makeMoti(RN.Image);
const MotiScrollView = makeMoti(RN.ScrollView);
const motify = Inner => makeMoti(Inner);

function useDynamicAnimation(getInitial) {
  const stateRef = React.useRef(typeof getInitial === 'function' ? getInitial() : getInitial || {});
  // animateTo would normally schedule worklets; for the smoke path
  // we mutate the ref and trigger a re-render via setState.
  const [, force] = React.useReducer(n => n + 1, 0);
  const api = React.useMemo(
    () => ({
      animateTo(next) {
        stateRef.current = typeof next === 'function' ? next(stateRef.current) : next;
        force();
      },
      get current() {
        return stateRef.current;
      },
    }),
    [],
  );
  return api;
}

function useAnimationState(config) {
  const [name, setName] = React.useState(
    config && config.from ? 'from' : Object.keys(config || {})[0] || 'from',
  );
  const state = (config && config[name]) || {};
  return {
    transitionTo: next => setName(typeof next === 'function' ? next(name) : next),
    current: state,
    __current: state,
  };
}

function AnimatePresence(props) {
  return props.children;
}

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.MotiView = MotiView;
module.exports.MotiText = MotiText;
module.exports.MotiImage = MotiImage;
module.exports.MotiScrollView = MotiScrollView;
// moti also re-exports the same components under the unprefixed
// RN-style names (so apps can `import {View, Text} from 'moti'`
// and treat them as drop-in animated replacements).
module.exports.View = MotiView;
module.exports.Text = MotiText;
module.exports.Image = MotiImage;
module.exports.ScrollView = MotiScrollView;
module.exports.motify = motify;
module.exports.useDynamicAnimation = useDynamicAnimation;
module.exports.useAnimationState = useAnimationState;
module.exports.AnimatePresence = AnimatePresence;
