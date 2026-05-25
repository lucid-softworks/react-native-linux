'use strict';

// Shim for `react-native-screens`. The real library wraps each screen
// in a UIViewController / Fragment so iOS/Android can manage screen
// lifecycle, swipe gestures, and memory eviction natively. None of
// that applies on desktop GTK — every component here is a plain View
// passthrough, every imperative method is a no-op.

const React = require('react');
const {View} = require('./components');

// `enableScreens(true)` is the opt-in real apps call early. Our
// "screens" are always just Views, so always enabled.
function enableScreens(_enable) {}
function enableFreeze(_enable) {}
function enableScreenshotEvents(_enable) {}
function screensEnabled() {
  return true;
}
function freezeEnabled() {
  return false;
}
function isSearchBarAvailableForCurrentPlatform() {
  return false;
}

// Components — all View passthroughs.
function Screen(props) {
  return React.createElement(View, props);
}
function ScreenContainer(props) {
  return React.createElement(View, props);
}
function ScreenStack(props) {
  return React.createElement(View, props);
}
function ScreenStackHeaderConfig(_props) {
  // The header is conventionally rendered by the navigator on iOS/
  // Android. expo-router on desktop has nothing to render here.
  return null;
}
function ScreenStackHeaderLeftView(props) {
  return React.createElement(View, props);
}
function ScreenStackHeaderRightView(props) {
  return React.createElement(View, props);
}
function ScreenStackHeaderCenterView(props) {
  return React.createElement(View, props);
}
function ScreenStackHeaderBackButtonImage(props) {
  return React.createElement(View, props);
}
function ScreenStackHeaderSearchBarView(props) {
  return React.createElement(View, props);
}
function SearchBar(_props) {
  return null;
}
function FullWindowOverlay(props) {
  return React.createElement(View, props);
}
function ScreenStackHeaderSubview(props) {
  return React.createElement(View, props);
}

// Constants used by react-navigation when configuring screens.
const ScreenStackHeaderBackButtonDisplayMode = {
  default: 'default',
  generic: 'generic',
  minimal: 'minimal',
};
const ScreenStackHeaderStatusBarStyle = {
  auto: 'auto',
  inverted: 'inverted',
  light: 'light',
  dark: 'dark',
};
const StackPresentationTypes = {
  push: 'push',
  modal: 'modal',
  transparentModal: 'transparentModal',
  containedModal: 'containedModal',
  containedTransparentModal: 'containedTransparentModal',
  fullScreenModal: 'fullScreenModal',
  formSheet: 'formSheet',
};
const StackAnimationTypes = {
  default: 'default',
  fade: 'fade',
  flip: 'flip',
  none: 'none',
  slide_from_right: 'slide_from_right',
  slide_from_left: 'slide_from_left',
  slide_from_bottom: 'slide_from_bottom',
};

module.exports = {
  // Opt-in / state
  enableScreens,
  enableFreeze,
  enableScreenshotEvents,
  screensEnabled,
  freezeEnabled,
  isSearchBarAvailableForCurrentPlatform,

  // Components
  Screen,
  ScreenContainer,
  ScreenStack,
  ScreenStackHeaderConfig,
  ScreenStackHeaderLeftView,
  ScreenStackHeaderRightView,
  ScreenStackHeaderCenterView,
  ScreenStackHeaderBackButtonImage,
  ScreenStackHeaderSearchBarView,
  ScreenStackHeaderSubview,
  SearchBar,
  FullWindowOverlay,

  // Enums
  ScreenStackHeaderBackButtonDisplayMode,
  ScreenStackHeaderStatusBarStyle,
  StackPresentationTypes,
  StackAnimationTypes,

  default: {Screen, ScreenContainer, ScreenStack},
  __esModule: true,
};
