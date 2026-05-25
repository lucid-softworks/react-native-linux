'use strict';

// Shim for `react-native-reanimated`. The real library is a giant
// animation runtime that runs JS on the UI thread via worklets — way
// too much to faithfully implement on desktop right now. Apps that
// just `import 'react-native-reanimated'` for side effects (the Expo
// tabs template does this in app/_layout.tsx) work fine with this
// stub. Apps that actually use `useSharedValue`, `useAnimatedStyle`,
// `Animated.View` from reanimated, etc. will silently miss animations
// but at least won't crash on import.

const React = require('react');
const {View, Text, Image, ScrollView} = require('react-native');

function useSharedValue(initial) {
  const ref = React.useRef({value: initial});
  return ref.current;
}

function useAnimatedStyle(fn) {
  try {
    return typeof fn === 'function' ? fn() : {};
  } catch {
    return {};
  }
}

function useDerivedValue(fn) {
  const ref = React.useRef({value: undefined});
  try {
    ref.current.value = typeof fn === 'function' ? fn() : undefined;
  } catch {
    ref.current.value = undefined;
  }
  return ref.current;
}

function useAnimatedRef() {
  return React.useRef(null);
}

function useAnimatedReaction(_prepare, _react) {}
function useAnimatedGestureHandler() {
  return () => {};
}
function useAnimatedScrollHandler() {
  return () => {};
}
function useAnimatedProps(fn) {
  try {
    return typeof fn === 'function' ? fn() : {};
  } catch {
    return {};
  }
}

const withTiming = (target, _config, callback) => {
  if (callback) callback(true);
  return target;
};
const withSpring = (target, _config, callback) => {
  if (callback) callback(true);
  return target;
};
const withDecay = (config, callback) => {
  if (callback) callback(true);
  return config.velocity ?? 0;
};
const withDelay = (_ms, value) => value;
const withRepeat = value => value;
const withSequence = (...values) => values[values.length - 1];
const cancelAnimation = _value => {};

const Easing = {
  linear: t => t,
  ease: t => t,
  quad: t => t * t,
  cubic: t => t * t * t,
  in: fn => fn,
  out: fn => fn,
  inOut: fn => fn,
  bezier: () => t => t,
  bezierFn: () => t => t,
};

function runOnJS(fn) {
  return (...args) => fn(...args);
}
function runOnUI(fn) {
  return (...args) => fn(...args);
}

const Animated = {
  View,
  Text,
  Image,
  ScrollView,
  createAnimatedComponent: Comp => Comp,
};

module.exports = {
  default: Animated,
  __esModule: true,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  useDerivedValue,
  useAnimatedRef,
  useAnimatedReaction,
  useAnimatedGestureHandler,
  useAnimatedScrollHandler,
  withTiming,
  withSpring,
  withDecay,
  withDelay,
  withRepeat,
  withSequence,
  cancelAnimation,
  Easing,
  runOnJS,
  runOnUI,
  ...Animated,
  Layout: {duration: () => ({})},
  FadeIn: {duration: () => ({})},
  FadeOut: {duration: () => ({})},
  SlideInRight: {duration: () => ({})},
  SlideInLeft: {duration: () => ({})},
  SlideOutRight: {duration: () => ({})},
  SlideOutLeft: {duration: () => ({})},
};
