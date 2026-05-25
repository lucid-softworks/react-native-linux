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

// Dimensions.get('window'|'screen') queries the active surface via
// rnLinux.getWindowDimensions. 'screen' degrades to 'window' because
// GTK doesn't surface a separate "screen" rect from JS-accessible
// state in a windowed app (multi-monitor display info would require
// reading the GdkMonitor list).
const _zeroDim = {width: 0, height: 0, scale: 1, fontScale: 1};
const Dimensions = {
  get: kind => {
    if (kind !== 'screen' && kind !== 'window') return _zeroDim;
    if (typeof rnLinux === 'undefined' || !rnLinux.getWindowDimensions) return _zeroDim;
    const d = rnLinux.getWindowDimensions();
    return d || _zeroDim;
  },
  // RN's API includes a change listener for orientation/resize. Apps
  // wire onLayout against their root View for this; we don't fire
  // change events yet, so return a no-op subscription.
  addEventListener: () => ({remove: () => {}}),
  removeEventListener: () => {},
};

// Reads the GTK setting `gtk-application-prefer-dark-theme` on each
// call so apps see the current system preference. We don't yet emit
// change events when the user toggles their theme — apps that want
// reactivity would need a useEffect subscription wrapper today.
function _readScheme() {
  if (typeof rnLinux !== 'undefined' && rnLinux.getColorScheme) {
    return rnLinux.getColorScheme();
  }
  return 'light';
}
const Appearance = {
  getColorScheme: _readScheme,
  addChangeListener: () => ({remove: () => {}}),
};

function useColorScheme() {
  return _readScheme();
}

// Promise-based (not async) so hermesc can compile the bundle —
// the hermes -emit-binary path doesn't accept async function syntax.
// Both methods route through GIO's g_app_info_launch_default_for_uri
// equivalents; canOpenURL only checks for a registered scheme handler
// (no GET-style verification).
const Linking = {
  openURL: url => {
    if (typeof rnLinux === 'undefined' || !rnLinux.openURL) {
      return Promise.reject(new Error('Linking unavailable'));
    }
    const ok = rnLinux.openURL(String(url));
    return ok ? Promise.resolve() : Promise.reject(new Error('Linking.openURL failed for ' + url));
  },
  canOpenURL: url => {
    if (typeof rnLinux === 'undefined' || !rnLinux.canOpenURL) {
      return Promise.resolve(false);
    }
    return Promise.resolve(!!rnLinux.canOpenURL(String(url)));
  },
  getInitialURL: () => Promise.resolve(null),
  addEventListener: () => ({remove: () => {}}),
};

// RN's classic Clipboard module ships via @react-native-clipboard/clipboard
// today, but apps still import a Clipboard object from 'react-native'
// for legacy paths. Expose the small surface both shapes use.
const Clipboard = {
  setString: s => {
    if (typeof rnLinux !== 'undefined' && rnLinux.clipboardSetString) {
      rnLinux.clipboardSetString(String(s));
    }
  },
  getString: () => {
    if (typeof rnLinux === 'undefined' || !rnLinux.clipboardGetStringSync) {
      return Promise.resolve('');
    }
    try {
      return Promise.resolve(String(rnLinux.clipboardGetStringSync() ?? ''));
    } catch (_e) {
      return Promise.resolve('');
    }
  },
};

// Alert.alert(title, message?, buttons?, options?) → GtkAlertDialog
// via rnLinux.showAlert. We pass the button labels through; the C++
// callback returns the index of the pressed button so we can fire
// the right onPress. iOS/Android styles ('cancel' / 'destructive')
// are accepted but ignored — GtkAlertDialog handles its own styling.
const Alert = {
  alert(title, message, buttons, _options) {
    const list = Array.isArray(buttons) && buttons.length > 0 ? buttons : [{text: 'OK'}];
    const labels = list.map((b, i) => (b && b.text) || 'Button ' + i);
    const onPicked = idx => {
      if (idx < 0 || idx >= list.length) return;
      const b = list[idx];
      if (b && typeof b.onPress === 'function') {
        try {
          b.onPress();
        } catch (e) {
          rnLinux.log('error', 'Alert.onPress threw: ' + String(e));
        }
      }
    };
    if (typeof rnLinux !== 'undefined' && rnLinux.showAlert) {
      rnLinux.showAlert(String(title ?? ''), String(message ?? ''), labels, onPicked);
    }
  },
  prompt(title, message, _cbOrButtons, _type, _defaultValue, _keyboardType, _options) {
    // Real prompt() needs a TextInput inside the dialog — GtkAlertDialog
    // doesn't expose one, so this would need a hand-rolled GtkDialog +
    // GtkEntry. Stub for now so apps don't crash on import.
    Alert.alert(title, message, [{text: 'OK'}]);
  },
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
  Clipboard,
  Alert,
  AppRegistry,
};
