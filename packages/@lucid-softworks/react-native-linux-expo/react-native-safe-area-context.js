'use strict';

// Shim for `react-native-safe-area-context`. On iOS this returns the
// notch/home-bar insets; on Android the status-bar height. Desktop
// GTK windows have nothing equivalent — the whole client area is
// safe — so every inset is 0 and SafeAreaView is a passthrough View.

const React = require('react');
const {View} = require('react-native');

const ZERO_INSETS = {top: 0, right: 0, bottom: 0, left: 0};
const ZERO_FRAME = {x: 0, y: 0, width: 0, height: 0};

const SafeAreaInsetsContext = React.createContext(ZERO_INSETS);
const SafeAreaFrameContext = React.createContext(ZERO_FRAME);

function SafeAreaProvider({children, initialMetrics: _ignored, ...rest}) {
  return React.createElement(View, {style: {flex: 1}, ...rest}, children);
}

function SafeAreaView({children, edges: _ignored, ...rest}) {
  return React.createElement(View, rest, children);
}

function SafeAreaConsumer({children}) {
  return children(ZERO_INSETS);
}

function useSafeAreaInsets() {
  return React.useContext(SafeAreaInsetsContext);
}

function useSafeAreaFrame() {
  return React.useContext(SafeAreaFrameContext);
}

function withSafeAreaInsets(Component) {
  return function WithSafeAreaInsets(props) {
    return React.createElement(Component, {...props, insets: ZERO_INSETS});
  };
}

const initialWindowMetrics = {insets: ZERO_INSETS, frame: ZERO_FRAME};

module.exports = {
  SafeAreaProvider,
  SafeAreaView,
  SafeAreaConsumer,
  SafeAreaInsetsContext,
  SafeAreaFrameContext,
  useSafeAreaInsets,
  useSafeAreaFrame,
  withSafeAreaInsets,
  initialWindowMetrics,
};
