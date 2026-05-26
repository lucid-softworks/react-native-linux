'use strict';

// Shim for `react-native-safe-area-context`. On iOS this returns the
// notch / home-bar insets; on Android the status-bar height. Desktop
// GTK windows have nothing equivalent — the OS-provided window decor
// (titlebar, scrollbars, panel) lives outside our GTK client area, so
// every inset is 0 by definition. The frame, however, is real — it's
// the live window-content size, which we hand back via the same
// React Context channel the upstream library uses so callers that
// useSafeAreaFrame() to size headers / footers get a correct value.

const React = require('react');
const {View, useWindowDimensions} = require('react-native');

const ZERO_INSETS = {top: 0, right: 0, bottom: 0, left: 0};
// Window dimensions live in a single getter the playground bundle
// installs at boot. If we're embedded in a context that doesn't have
// it (unit tests, headless), fall back to a sensible default so
// initialWindowMetrics still serialises.
function _initialFrame() {
  if (typeof rnLinux !== 'undefined' && typeof rnLinux.getWindowDimensions === 'function') {
    const d = rnLinux.getWindowDimensions();
    return {x: 0, y: 0, width: d.width || 0, height: d.height || 0};
  }
  return {x: 0, y: 0, width: 0, height: 0};
}

const SafeAreaInsetsContext = React.createContext(ZERO_INSETS);
const SafeAreaFrameContext = React.createContext(_initialFrame());

const SafeAreaProvider = React.forwardRef(function SafeAreaProvider(
  {children, initialMetrics: _ignored, style, ...rest},
  ref,
) {
  // useWindowDimensions re-renders on resize, so the frame Context
  // stays live without a separate event subscription. Insets always
  // pass zero — there's no Linux equivalent of a notch / status bar
  // that displaces app content.
  const {width, height} = useWindowDimensions();
  const frame = React.useMemo(() => ({x: 0, y: 0, width, height}), [width, height]);
  return React.createElement(
    SafeAreaInsetsContext.Provider,
    {value: ZERO_INSETS},
    React.createElement(
      SafeAreaFrameContext.Provider,
      {value: frame},
      React.createElement(View, {style: [{flex: 1}, style], ...rest, ref}, children),
    ),
  );
});

// SafeAreaView applies the insets as padding (matching the upstream
// component's iOS / Android behavior). On Linux insets are always
// zero, so the View renders unchanged — but callers that explicitly
// `edges={['top']}` etc. still get the right type and the prop is
// silently accepted instead of warned about.
const SafeAreaView = React.forwardRef(function SafeAreaView(
  {children, edges: _ignored, style, ...rest},
  ref,
) {
  const insets = React.useContext(SafeAreaInsetsContext);
  const padding = {
    paddingTop: insets.top,
    paddingRight: insets.right,
    paddingBottom: insets.bottom,
    paddingLeft: insets.left,
  };
  return React.createElement(View, {style: [padding, style], ...rest, ref}, children);
});

function SafeAreaConsumer({children}) {
  const insets = React.useContext(SafeAreaInsetsContext);
  return children(insets);
}

function useSafeAreaInsets() {
  return React.useContext(SafeAreaInsetsContext);
}

function useSafeAreaFrame() {
  return React.useContext(SafeAreaFrameContext);
}

function withSafeAreaInsets(Component) {
  return function WithSafeAreaInsets(props) {
    const insets = React.useContext(SafeAreaInsetsContext);
    return React.createElement(Component, {...props, insets});
  };
}

const initialWindowMetrics = {insets: ZERO_INSETS, frame: _initialFrame()};

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
