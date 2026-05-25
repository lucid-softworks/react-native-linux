'use strict';

// Shim for `react-native-screens`. The real library wraps each screen
// in a UIViewController / Fragment so iOS/Android can manage screen
// lifecycle, swipe gestures, and memory eviction natively. None of
// that applies on desktop GTK — every component here is a plain View
// passthrough, every imperative method is a no-op.

const React = require('react');
const {View} = require('react-native');

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
  enableScreens,
  enableFreeze,
  enableScreenshotEvents,
  screensEnabled,
  freezeEnabled,
  isSearchBarAvailableForCurrentPlatform,
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
  ScreenStackHeaderBackButtonDisplayMode,
  ScreenStackHeaderStatusBarStyle,
  StackPresentationTypes,
  StackAnimationTypes,
  default: {Screen, ScreenContainer, ScreenStack},
  __esModule: true,
};
