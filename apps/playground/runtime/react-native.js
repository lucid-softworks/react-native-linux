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
// NB: ./fabric is required lazily inside registerComponent rather
// than at module load. The shared ErrorBoundary lives in the umbrella
// shim package and pulls in 'react-native' (i.e. THIS module) during
// its own evaluation. Top-loading ./fabric here turned that into a
// circular: vendor → fabric → errorOverlay → error-boundary →
// react-native → fabric (still mid-eval) → renderFabric undefined →
// registerComponent later crashes with "undefined is not a function".

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
    const {renderFabric} = require('./fabric');
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

// TurboModuleRegistry — the canonical RN entry point for getting a
// native module instance. C++ side installs `globalThis.__turboModuleProxy`
// (see vnext/src/jsi/TurboModuleRegistry.cpp). Apps doing:
//   const PC = TurboModuleRegistry.getEnforcing('PlatformConstants');
//   const c  = PC.getConstants();
// hit the registered factory, get a HostObject back, and call through
// it like any RN-side native module.
const TurboModuleRegistry = {
  get(name) {
    if (typeof globalThis.__turboModuleProxy !== 'function') return null;
    return globalThis.__turboModuleProxy(String(name));
  },
  getEnforcing(name) {
    const m = this.get(name);
    if (m == null) {
      throw new Error(
        "TurboModuleRegistry.getEnforcing(...): '" +
          name +
          "' could not be found. Verify that the native binary registered it.",
      );
    }
    return m;
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

// KeyboardAvoidingView pushes content up when an on-screen keyboard
// rises on iOS/Android. Desktop windows have a hardware keyboard that
// doesn't displace the layout, so this is a pure passthrough. Accept
// (and discard) the iOS-specific props so apps don't crash on import.
const KeyboardAvoidingView = React.forwardRef(function KeyboardAvoidingView(props, ref) {
  const {
    behavior: _b,
    keyboardVerticalOffset: _o,
    contentContainerStyle: _c,
    enabled: _e,
    ...rest
  } = props;
  return React.createElement(View, {...rest, ref}, props.children);
});

// RefreshControl is the pull-to-refresh affordance on mobile
// ScrollViews. Desktop has no pull gesture, so this is a no-op shim:
// the component renders nothing, swallows props (onRefresh, refreshing,
// tintColor, colors). ScrollView passes it via the `refreshControl`
// prop which our scrollview host doesn't currently honor either.
// Future: route to a Ctrl+R-style reload or hook the edge-reached
// signal of GtkScrolledWindow.
function RefreshControl(_props) {
  return null;
}

// NativeModules — legacy bridge surface. Real RN code (Platform,
// PlatformColor, AppearanceModule, …) still does `NativeModules.X`
// rather than going through TurboModuleRegistry. Back it with a
// Proxy that lazy-defers to TurboModuleRegistry, returning a
// reasonable empty object so destructuring like
// `const {PlatformConstants} = NativeModules` works without
// crashing. Anything we haven't implemented just behaves as "module
// present but methods missing", which most defensive RN code handles.
// NativeModules — every key returns either a real TurboModule (if
// registered) or a defensive stub that won't crash destructures or
// `.getConstants()` probes. Real libraries (Paper, etc.) blanket-call
// methods on NativeModules.X without checking if X is wired, so a
// hard "undefined" or empty-object stub makes them die at the first
// method call. Returning a Proxy-of-noop-methods keeps them limping.
const _platformConstants = {OS: 'linux'};
const _stubModule = name =>
  new Proxy(
    {
      getConstants: () => (name === 'PlatformConstants' ? _platformConstants : {}),
    },
    {
      get(target, key) {
        if (key in target) return target[key];
        // Anything not declared: return a noop function. Most RN
        // libraries call NativeModules.X.method(...) without checking;
        // a noop is far less harmful than a TypeError.
        return () => undefined;
      },
    },
  );
const NativeModules = new Proxy(
  {},
  {
    get(_target, name) {
      if (typeof name !== 'string') return undefined;
      try {
        const mod = TurboModuleRegistry.get(name);
        if (mod) return mod;
      } catch {}
      return _stubModule(name);
    },
  },
);

// I18nManager — many RN libraries read isRTL to mirror layouts.
// Desktop GTK has no LTR/RTL toggle exposed to JS yet; report LTR.
const I18nManager = {
  isRTL: false,
  doLeftAndRightSwapInRTL: true,
  allowRTL: () => {},
  forceRTL: () => {},
  swapLeftAndRightInRTL: () => {},
  getConstants: () => ({isRTL: false, doLeftAndRightSwapInRTL: true, localeIdentifier: 'en_US'}),
};

// PixelRatio — most libraries use the (no-op on desktop) members.
const PixelRatio = {
  get: () => 1,
  getFontScale: () => 1,
  getPixelSizeForLayoutSize: size => Math.round(size),
  roundToNearestPixel: size => Math.round(size),
};

// processColor — Paper passes string colors through this before
// handing them to native shadow/tint code paths. Return the input
// unchanged (our fabricHostConfig.js normalizeColor handles strings).
const processColor = c => c;

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
  KeyboardAvoidingView,
  RefreshControl,
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
  TurboModuleRegistry,
  NativeModules,
  I18nManager,
  PixelRatio,
  processColor,
};
