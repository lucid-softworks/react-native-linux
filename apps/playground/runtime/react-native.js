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

// Dimensions.get('window') queries the active surface via
// rnLinux.getWindowDimensions. 'screen' queries the monitor the
// window is on via rnLinux.getScreenDimensions
// (gdk_display_get_monitor_at_surface → gdk_monitor_get_geometry).
// Responsive RN apps that switch layouts on `Dimensions.get('screen').width`
// see the real monitor extent instead of the transient window size.

const _zeroDim = {width: 0, height: 0, scale: 1, fontScale: 1};

// Fan-out for the single C++-side `setOnDimensionsChange` listener.
// Every `Dimensions.addEventListener('change', cb)` and every
// `useWindowDimensions` mount appends here; C++ fires once per real
// resize and we run the whole list inline.
const _dimChangeListeners = new Set();
let _currentDim = _zeroDim;
let _currentScreenDim = _zeroDim;
let _dimNativeWired = false;

function _refreshDim() {
  if (typeof rnLinux === 'undefined' || !rnLinux.getWindowDimensions) return _zeroDim;
  const d = rnLinux.getWindowDimensions();
  return d || _zeroDim;
}

function _refreshScreenDim() {
  if (typeof rnLinux === 'undefined' || !rnLinux.getScreenDimensions) {
    // Pre-binding (or older host without the screen binding) — fall
    // back to the window dims so callers still get a usable shape.
    return _refreshDim();
  }
  const d = rnLinux.getScreenDimensions();
  return d && d.width > 0 ? d : _refreshDim();
}

function _ensureNativeWired() {
  if (_dimNativeWired) return;
  if (typeof rnLinux === 'undefined' || !rnLinux.setOnDimensionsChange) return;
  _dimNativeWired = true;
  _currentDim = _refreshDim();
  _currentScreenDim = _refreshScreenDim();
  rnLinux.setOnDimensionsChange(next => {
    _currentDim = next || _refreshDim();
    // Re-read screen on resize too — the user may have dragged the
    // window across to a different-sized monitor.
    _currentScreenDim = _refreshScreenDim();
    // Snapshot iteration — subscriber `remove` calls during dispatch
    // are common (useEffect cleanup on unmount) and would otherwise
    // invalidate the Set iterator.
    const snapshot = Array.from(_dimChangeListeners);
    for (const fn of snapshot) {
      try {
        fn({window: _currentDim, screen: _currentScreenDim});
      } catch (e) {
        if (typeof rnLinux !== 'undefined') {
          rnLinux.log('error', '[Dimensions] listener threw: ' + (e && e.message));
        }
      }
    }
  });
}

const Dimensions = {
  get: kind => {
    if (kind !== 'screen' && kind !== 'window') return _zeroDim;
    _ensureNativeWired();
    // Always read fresh — `useWindowDimensions` below caches into
    // useState, but external `Dimensions.get` callers expect the
    // current value, not whatever we last cached.
    if (kind === 'screen') {
      _currentScreenDim = _refreshScreenDim();
      return _currentScreenDim;
    }
    _currentDim = _refreshDim();
    return _currentDim;
  },
  addEventListener: (event, cb) => {
    if (event !== 'change' || typeof cb !== 'function') {
      return {remove: () => {}};
    }
    _ensureNativeWired();
    _dimChangeListeners.add(cb);
    return {remove: () => _dimChangeListeners.delete(cb)};
  },
  removeEventListener: (event, cb) => {
    if (event === 'change') _dimChangeListeners.delete(cb);
  },
};

// useWindowDimensions — RN hook returning the current 'window'
// dimensions, re-rendering on resize.
//
// `useSyncExternalStore` is the correct primitive here. With
// useState + useEffect there's a window between the initial render
// (which captures whatever value `getSnapshot` returned at that
// moment) and the effect commit (which subscribes); a resize that
// fires in that window is missed. `useSyncExternalStore` resolves
// this by re-reading the snapshot synchronously after subscribe and
// re-rendering if it changed.
//
// `_currentDim` is mutated by `setOnDimensionsChange` (above) on
// every real resize; subscribers fire and React re-reads the
// snapshot. `getSnapshot` returns the SAME reference between resizes,
// so React's bail-out check (Object.is on the snapshot) avoids
// re-renders when nothing actually changed.
function _dimSubscribe(cb) {
  _ensureNativeWired();
  _dimChangeListeners.add(cb);
  return () => _dimChangeListeners.delete(cb);
}
function _dimGetSnapshot() {
  _ensureNativeWired();
  return _currentDim;
}
function useWindowDimensions() {
  return React.useSyncExternalStore(_dimSubscribe, _dimGetSnapshot, _dimGetSnapshot);
}

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
  prompt(title, message, cbOrButtons, type, defaultValue, _keyboardType, _options) {
    // RN's three call shapes:
    //   Alert.prompt(title, message)
    //     → just a confirmation; no text result.
    //   Alert.prompt(title, message, (text) => …)
    //     → single OK + Cancel; OK fires the cb with the typed text.
    //   Alert.prompt(title, message, [{text, onPress, style}, …])
    //     → each button's onPress receives the typed text.
    let buttons;
    if (typeof cbOrButtons === 'function') {
      buttons = [
        {text: 'Cancel', style: 'cancel'},
        {text: 'OK', onPress: cbOrButtons},
      ];
    } else if (Array.isArray(cbOrButtons) && cbOrButtons.length > 0) {
      buttons = cbOrButtons;
    } else {
      // No callback / button list — degenerate to a plain Alert so the
      // call still surfaces something.
      Alert.alert(title, message, [{text: 'OK'}]);
      return;
    }
    const labels = buttons.map((b, i) => (b && b.text) || 'Button ' + i);
    const secureEntry = type === 'secure-text' || type === 'login-password';
    const onPicked = (idx, text) => {
      if (idx < 0 || idx >= buttons.length) return; // window closed / Escape
      const b = buttons[idx];
      if (b && typeof b.onPress === 'function') {
        try {
          b.onPress(text);
        } catch (e) {
          rnLinux.log('error', 'Alert.prompt onPress threw: ' + String(e));
        }
      }
    };
    if (typeof rnLinux !== 'undefined' && rnLinux.showPrompt) {
      rnLinux.showPrompt(
        String(title ?? ''),
        String(message ?? ''),
        String(defaultValue ?? ''),
        secureEntry,
        labels,
        onPicked,
      );
    } else if (typeof rnLinux !== 'undefined' && rnLinux.showAlert) {
      // Older C++ build without showPrompt — degrade to a button-only
      // alert so apps don't break. onPress sees an empty text arg.
      rnLinux.showAlert(String(title ?? ''), String(message ?? ''), labels, idx =>
        onPicked(idx, ''),
      );
    }
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
// ScrollViews. Desktop has no touch pull gesture, but GtkScrolledWindow
// emits an `edge-overshot` signal when the user yanks the scrollbar
// past the top with a wheel or trackpad — the closest analogue, and
// the same UX as iOS rubber-band-to-refresh. We render nothing here;
// the ScrollView shim picks the props out of `refreshControl` and
// forwards `onRefresh`/`refreshing` as top-level props, and the
// fabricHostConfig binds them through `rnLinux.fabricOnRefresh` +
// `rnLinux.scrollViewSetRefreshing`. Visual styling props
// (tintColor, colors, title*) are intentionally ignored — desktop
// shows the standard GtkScrolledWindow scrollbar rubber-band.
function RefreshControl(_props) {
  return null;
}

// PanResponder — RN's iOS/Android implementation lives on top of the
// responder graph (which we don't have on desktop). Instead, we drive
// the same callback contract from GtkGestureDrag: a single-touch drag
// affordance produces panStart/panMove/panRelease signals on the
// underlying View, and the JS shim funnels them into the user's
// onPanResponderGrant / Move / Release callbacks with the synthetic
// event + gestureState shape RN consumers expect.
//
// Out of scope (matches what we don't have natively): multi-touch
// negotiation, terminate/terminationRequest, pinch / rotation gestures.
// The single-finger drag covers swipeable cards, slider thumbs,
// signature pads, and the "Animated.event(…, {useNativeDriver:false})"
// follow-up that most uses of PanResponder pair with.
const PanResponder = {
  create(config) {
    // Wrap each user callback so we can swallow throws — RN apps
    // are inconsistent about catching inside gesture handlers, and
    // a thrown error here would otherwise drop subsequent moves on
    // the floor.
    const fire = (key, evt) => {
      const fn = config && config[key];
      if (typeof fn !== 'function') return;
      try {
        fn(evt, evt.gestureState);
      } catch (e) {
        rnLinux.log('error', 'PanResponder.' + key + ' threw: ' + String(e));
      }
    };
    return {
      panHandlers: {
        // Host-level prop names the fabricHostConfig recognises and
        // routes to the new rnLinux.fabricOnPan* registries. These
        // intentionally don't collide with onLongPress / onClick /
        // onHover* — both can coexist on the same View.
        onPanResponderGrantNative: evt => fire('onPanResponderGrant', evt),
        onPanResponderMoveNative: evt => fire('onPanResponderMove', evt),
        onPanResponderReleaseNative: evt => {
          fire('onPanResponderRelease', evt);
          // RN's Terminate fires when the responder is forcibly torn
          // away (parent scroll claims it, etc.). On desktop a drag-
          // end is always a release, so Terminate is a no-op alias —
          // some apps register both for safety.
          fire('onPanResponderTerminate', evt);
        },
      },
    };
  },
};

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

// AccessibilityInfo — Paper subscribes to reduceMotionChanged on
// mount. We have no AT-SPI bridge yet so all values are
// optimistic-defaults; the addEventListener contract returns a
// subscription with .remove() and an unsubscribe function for
// back-compat with the pre-0.65 callback-removal API.
const _emptySub = {remove: () => {}};
const AccessibilityInfo = {
  isReduceMotionEnabled: () => Promise.resolve(false),
  isScreenReaderEnabled: () => Promise.resolve(false),
  isReduceTransparencyEnabled: () => Promise.resolve(false),
  isBoldTextEnabled: () => Promise.resolve(false),
  isGrayscaleEnabled: () => Promise.resolve(false),
  isInvertColorsEnabled: () => Promise.resolve(false),
  isHighTextContrastEnabled: () => Promise.resolve(false),
  addEventListener: (_event, _handler) => _emptySub,
  removeEventListener: () => {},
  announceForAccessibility: () => {},
  setAccessibilityFocus: () => {},
  fetch: () => Promise.resolve(false),
};

// AppState — many libs subscribe to foreground/background transitions.
// Desktop apps are always 'active' until window-state events get wired
// up; the subscription API stays consistent so cleanups don't crash.
const AppState = {
  currentState: 'active',
  addEventListener: (_event, _handler) => _emptySub,
  removeEventListener: () => {},
};

// DeviceEventEmitter — RN's pre-TurboModule event bus. A noop
// implementation keeps libraries that emit / subscribe through it
// from crashing; events just never fire.
const DeviceEventEmitter = {
  addListener: (_event, _handler) => _emptySub,
  removeListener: () => {},
  removeAllListeners: () => {},
  emit: () => {},
};

// NativeEventEmitter — third-party libs (react-native-device-info,
// expo-modules) construct `new NativeEventEmitter(NativeModules.X)`
// at module-eval time, so it has to be a real constructor or the
// require() walk for the entire library crashes with "is not a
// constructor". The wrapped native module is allowed to be a stub
// or even undefined; we just store it and route subscriptions through
// the same noop bus DeviceEventEmitter uses. Events never fire on
// desktop, but subscription/cleanup contracts stay intact.
function NativeEventEmitter(nativeModule) {
  this._module = nativeModule || null;
}
NativeEventEmitter.prototype.addListener = function (_event, _handler) {
  return _emptySub;
};
NativeEventEmitter.prototype.removeListener = function () {};
NativeEventEmitter.prototype.removeAllListeners = function () {};
NativeEventEmitter.prototype.removeSubscription = function () {};
NativeEventEmitter.prototype.emit = function () {};

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

// LogBox — the warning-rollup overlay. Real impl filters duplicate
// warnings + shows an in-app overlay. RN apps frequently call
// `LogBox.ignoreLogs([...])` from their root to silence noisy
// dependency warnings. We don't ship the overlay yet, so the
// methods are no-ops; importing it is enough to satisfy the call
// without breaking the rest of the boot path.
const LogBox = {
  ignoreLogs: () => {},
  ignoreAllLogs: () => {},
  install: () => {},
  uninstall: () => {},
};

// Settings — iOS-only key/value store. RN apps that gate features
// on iOS sometimes still call Settings.get/set on every platform;
// returning undefined is the documented Android behaviour we mirror.
const Settings = {
  get: () => undefined,
  set: () => {},
  watchKeys: () => 0,
  clearWatch: () => {},
};

// ToastAndroid / Vibration — present-but-noop on desktop so cross-
// platform code paths don't ReferenceError.
const ToastAndroid = {SHORT: 0, LONG: 1, show: () => {}, showWithGravity: () => {}};
const Vibration = {vibrate: () => {}, cancel: () => {}};

// Share — the in-app share sheet. Real backing for desktop is
// xdg-desktop-portal OpenURI; until then resolve the promise so
// callers get a clean "dismissed" path.
const Share = {
  share: () => Promise.resolve({action: 'dismissed'}),
  sharedAction: 'sharedAction',
  dismissedAction: 'dismissed',
};

// findNodeHandle — Pre-Fabric ref-to-tag conversion. With our
// Fabric reconciler the public instance already carries a `_nativeTag`;
// fall back to null when the input doesn't have one so callers don't
// crash on `null.value`.
function findNodeHandle(componentOrHandle) {
  if (componentOrHandle == null) return null;
  if (typeof componentOrHandle === 'number') return componentOrHandle;
  return componentOrHandle._nativeTag || null;
}

// UIManager — legacy bridge for measure / configureNextLayoutAnimation.
// Most reads are now via Fabric refs; provide enough surface that
// imports + simple calls don't throw.
const UIManager = {
  measure: (_node, cb) => cb && cb(0, 0, 0, 0, 0, 0),
  measureInWindow: (_node, cb) => cb && cb(0, 0, 0, 0),
  measureLayout: (_node, _ref, _fail, cb) => cb && cb(0, 0, 0, 0),
  dispatchViewManagerCommand: () => {},
  configureNextLayoutAnimation: () => {},
  hasViewManagerConfig: () => false,
  getViewManagerConfig: () => null,
  setLayoutAnimationEnabledExperimental: () => {},
};

const LayoutAnimation = {
  configureNext: () => {},
  create: (duration, type, prop) => ({
    duration,
    type,
    property: prop,
    create: {},
    update: {},
    delete: {},
  }),
  Types: {
    spring: 'spring',
    linear: 'linear',
    easeInEaseOut: 'easeInEaseOut',
    easeIn: 'easeIn',
    easeOut: 'easeOut',
    keyboard: 'keyboard',
  },
  Properties: {opacity: 'opacity', scaleX: 'scaleX', scaleXY: 'scaleXY', scaleY: 'scaleY'},
  Presets: {
    easeInEaseOut: {duration: 300, create: {}, update: {}, delete: {}},
    linear: {duration: 500, create: {}, update: {}, delete: {}},
    spring: {duration: 700, create: {}, update: {}, delete: {}},
  },
};

const InteractionManager = {
  runAfterInteractions: cb => {
    if (typeof cb === 'function') cb();
    return {then: () => {}, cancel: () => {}, done: () => {}};
  },
  createInteractionHandle: () => 0,
  clearInteractionHandle: () => {},
  setDeadline: () => {},
};

const BackHandler = {
  addEventListener: () => ({remove: () => {}}),
  removeEventListener: () => {},
  exitApp: () => {},
};

const PermissionsAndroid = {
  request: () => Promise.resolve('granted'),
  requestMultiple: () => Promise.resolve({}),
  check: () => Promise.resolve(true),
  PERMISSIONS: {},
  RESULTS: {GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again'},
};

const StatusBar = function (props) {
  // Render-prop component that doesn't actually render anything;
  // exists so apps that mount <StatusBar barStyle="dark-content"/>
  // don't ReferenceError. Plain function form for Hermes lazy-parse
  // compatibility (no class declaration).
  return null;
};
StatusBar.setBarStyle = () => {};
StatusBar.setBackgroundColor = () => {};
StatusBar.setHidden = () => {};
StatusBar.setTranslucent = () => {};
StatusBar.setNetworkActivityIndicatorVisible = () => {};

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
  PanResponder,
  // Animated
  Animated,
  Easing,
  // Layout helper
  StyleSheet,
  // Platform globals
  Platform,
  Dimensions,
  useWindowDimensions,
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
  AccessibilityInfo,
  AppState,
  DeviceEventEmitter,
  NativeEventEmitter,
  LogBox,
  Settings,
  ToastAndroid,
  Vibration,
  Share,
  findNodeHandle,
  UIManager,
  LayoutAnimation,
  InteractionManager,
  BackHandler,
  PermissionsAndroid,
  StatusBar,
};
