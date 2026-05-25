'use strict';

// The 'react-native' module surface as the playground exposes it.
// Apps written for iOS/Android can `import {View, Text} from 'react-native'`
// and land on our Fabric-backed Linux primitives instead of having to
// rewrite imports.
//
// We pull the components + StyleSheet directly from their source
// modules (avoiding require('./') → runtime/index.js which also
// loads the legacy JSI-bridge reconciler we don't want at this entry
// point). Anything RN provides that we don't have yet either stubs
// to a sensible no-op or throws at use-time so apps know they hit a
// gap.

const React = require('react');
const {
  View,
  ScrollView,
  Image,
  Text,
  TextInput,
  Pressable,
  Button,
  Switch,
  ActivityIndicator,
} = require('./components');
const StyleSheet = require('./stylesheet');
const {FlatList} = require('./flatlist');
const {Modal} = require('./modal');
const {Animated, Easing} = require('./animated');
const {renderFabric} = require('./fabric');

// AppRegistry — minimal surface for Expo's registerRootComponent
// path. registerComponent immediately mounts via renderFabric since
// the playground only runs one app at a time and the Fabric surface
// is already up by the time the app bundle hits this code. Real
// react-native's AppRegistry holds component factories until the
// native side calls runApplication; we collapse that into one step.
const registrations = new Map();
const AppRegistry = {
  registerComponent(appKey, factory) {
    registrations.set(appKey, factory);
    const Component = factory();
    renderFabric(React.createElement(Component));
    return appKey;
  },
  getApplication(appKey, _initialProps) {
    const factory = registrations.get(appKey);
    if (!factory) return null;
    return {element: React.createElement(factory())};
  },
  getRunnable(appKey) {
    return registrations.get(appKey) ? {appKey} : undefined;
  },
  getAppKeys() {
    return Array.from(registrations.keys());
  },
  registerRunnable(appKey, run) {
    registrations.set(appKey, () => null);
    return appKey;
  },
  unmountApplicationComponentAtRootTag() {},
};

const Platform = {
  OS: 'linux',
  Version: 1,
  isPad: false,
  isTV: false,
  isTesting: false,
  select(spec) {
    if (spec == null) return undefined;
    if ('linux' in spec) return spec.linux;
    if ('native' in spec) return spec.native;
    if ('default' in spec) return spec.default;
    return undefined;
  },
};

const Dimensions = {
  get: kind =>
    kind === 'screen' || kind === 'window'
      ? {width: 1024, height: 860, scale: 1, fontScale: 1}
      : {width: 0, height: 0, scale: 1, fontScale: 1},
  addEventListener: () => ({remove: () => {}}),
  removeEventListener: () => {},
};

const Appearance = {
  getColorScheme: () => 'dark',
  addChangeListener: () => ({remove: () => {}}),
};

function useColorScheme() {
  return 'dark';
}

// Promise-based (not async) so hermesc can compile the bundle —
// the hermes -emit-binary path doesn't accept async function syntax.
const Linking = {
  openURL: () => Promise.reject(new Error('Linking.openURL not wired yet on react-native-linux')),
  canOpenURL: () => Promise.resolve(false),
  addEventListener: () => ({remove: () => {}}),
};

// SafeAreaView from 'react-native' itself (vs. react-native-safe-area-context).
// RN deprecated it on iOS in favour of the community module, but apps still
// import it. Desktop GTK windows have no notch/inset, so the whole client
// area is "safe" — passthrough View. Ref forwards so libraries can measure.
const SafeAreaView = React.forwardRef(function SafeAreaView(props, ref) {
  return React.createElement(View, {...props, ref}, props.children);
});

module.exports = {
  // Components
  View,
  ScrollView,
  Image,
  Text,
  TextInput,
  Pressable,
  Button,
  Switch,
  ActivityIndicator,
  FlatList,
  Modal,
  SafeAreaView,
  // Animated
  Animated,
  Easing,
  // Layout helper
  StyleSheet,
  // Platform globals
  Platform,
  Dimensions,
  Appearance,
  useColorScheme,
  Linking,
  AppRegistry,
};
