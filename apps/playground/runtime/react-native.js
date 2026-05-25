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

const {View, ScrollView, Image, Text, TextInput, Pressable, Button} =
  require('./components');
const StyleSheet = require('./stylesheet');
const {FlatList} = require('./flatlist');
const {Modal} = require('./modal');
const {Animated, Easing} = require('./animated');

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
  get: (kind) =>
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
  openURL: () => Promise.reject(new Error(
    "Linking.openURL not wired yet on react-native-linux")),
  canOpenURL: () => Promise.resolve(false),
  addEventListener: () => ({remove: () => {}}),
};

module.exports = {
  // Components
  View, ScrollView, Image, Text, TextInput, Pressable, Button,
  FlatList, Modal,
  // Animated
  Animated, Easing,
  // Layout helper
  StyleSheet,
  // Platform globals
  Platform,
  Dimensions,
  Appearance,
  useColorScheme,
  Linking,
};
