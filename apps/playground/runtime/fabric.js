'use strict';

// Fabric render entrypoint — lives in the VENDOR bundle so the React
// root + reconciler + refresh hookup all survive across user-bundle
// re-evaluations. That's what makes useState/useEffect state ride
// through edits.
//
// Lifecycle:
//   * Cold start: vendor bundle loads → this file runs once → creates
//     the reconciler, installs RN$AppRegistry. Then the C++ host
//     evaluates the app bundle, which calls renderFabric(<App/>).
//     surface.start() (called next from C++) fires runApplication,
//     captures surfaceId, and tryMount creates the root + commits.
//   * Edit: app bundle re-evaluates. The new <App/> reaches us via
//     renderFabric. We reuse the existing root (NO unmount) and call
//     updateContainer with the new element — react-reconciler diffs
//     it against the live fiber tree. Then performReactRefresh runs
//     so component identities the babel transform registered against
//     stable IDs map back to the still-mounted instances.

const React = require('react');
const Reconciler = require('react-reconciler');
const RefreshRuntime = require('react-refresh/runtime');
const {hostConfig, setSurfaceContext} = require('./fabricHostConfig');
const {ErrorBoundary} = require('./errorOverlay');
const {LogBoxOverlay} = require('./logBox');

const reconciler = Reconciler(hostConfig);

// Register the reconciler with __REACT_DEVTOOLS_GLOBAL_HOOK__ (set up
// by RefreshRuntime.injectIntoGlobalHook in vendor.js). bundleType=1
// (dev) flips on the Fast Refresh hooks (scheduleRefresh +
// setRefreshHandler) in the injected internals — without this,
// performReactRefresh has no renderer to talk to.
reconciler.injectIntoDevTools({
  bundleType: 1,
  rendererPackageName: 'react-native-linux',
  version: '18.3.1',
});

let pendingElement = null;
let root = null;

function tryMount() {
  if (pendingElement === null) return;
  const fabric = globalThis.nativeFabricUIManager;
  const surfaceId = globalThis.__rnFabricSurfaceId;
  if (!fabric || !surfaceId) return; // pre-runApplication; wait

  setSurfaceContext(fabric, surfaceId);

  if (!root) {
    // Cold mount: create the React root and seed it with the first
    // element. performReactRefresh runs after — no families to update
    // yet, but it primes the resolveFamily handler so subsequent
    // renders use Fast Refresh.
    const containerInfo = {};
    root = reconciler.createContainer(
      containerInfo,
      /* tag */ 0,
      /* hydrationCallbacks */ null,
      /* isStrictMode */ false,
      /* concurrentUpdatesByDefault */ null,
      /* identifierPrefix */ '',
      /* onUncaughtError */ err => rnLinux.log('error', String(err)),
      /* onCaughtError */ err => rnLinux.log('error', String(err)),
      /* onRecoverableError */ err => rnLinux.log('warn', String(err)),
      /* transitionCallbacks */ null,
    );
    // Wrap the user's tree in LogBoxOverlay (outermost — survives
    // render crashes the boundary catches) > ErrorBoundary (catches
    // JSX exceptions and renders a RedBox fallback) > user tree.
    // A crash inside the user's tree trips the boundary; the LogBox
    // stays mounted at the top level and keeps showing the toast.
    const elementToCommit = React.createElement(
      LogBoxOverlay,
      null,
      React.createElement(ErrorBoundary, {scope: 'app'}, pendingElement),
    );
    pendingElement = null;
    reconciler.updateContainer(elementToCommit, root, null, () => {
      rnLinux.log('info', '[fabric-render] JSX commit done (cold)');
    });
    // Cold mount: no families exist to "refresh" — the very first
    // render IS their initial mount. Calling performReactRefresh here
    // can stall on complex trees (we hit a 100% CPU spin in
    // RefreshRuntime.scheduleRoot for the rich demo + Tabs combo).
    // Hot reloads still run performReactRefresh below via the second
    // tryMount path; the on-mount call is gratuitous.
    return;
  }

  // Hot reload path. The app bundle just re-evaluated; its top-level
  // re-ran $RefreshReg$ for every component (registering the new
  // function objects under the SAME family ids).
  //
  // Two sub-paths:
  //
  // 1. Post-error recovery: the ErrorBoundary just caught a render
  //    throw and set __rnLinuxRecoveredFromError. performReactRefresh
  //    against the live fiber tree here deadlocks the JS thread for
  //    tens of seconds — it sees a "stale" family and tries to
  //    remount it on top of a tree the boundary's fallback just
  //    detached/reattached, allocating in Object.freeze /
  //    setPrototypeForEach forever. Skip Fast Refresh and do a
  //    full updateContainer remount with the freshly-evaluated
  //    pendingElement instead. State is lost, but the panel goes
  //    away and the new bundle's components mount cleanly.
  //
  // 2. Normal hot reload (file save, no error in the loop):
  //    performReactRefresh installs resolveFamily on the reconciler
  //    and schedules a refresh on every mounted root — that single
  //    call swaps types in place and preserves hook state.
  //    pendingElement isn't consumed; React rediscovers the new
  //    types via family lookup during the scheduled refresh.
  if (globalThis.__rnLinuxRecoveredFromError) {
    globalThis.__rnLinuxRecoveredFromError = false;
    const elementToCommit = React.createElement(
      LogBoxOverlay,
      null,
      React.createElement(ErrorBoundary, {scope: 'app'}, pendingElement),
    );
    pendingElement = null;
    reconciler.updateContainer(elementToCommit, root, null, () => {
      rnLinux.log('info', '[hot-reload] post-error full remount done');
    });
    return;
  }
  pendingElement = null;
  const refreshed = RefreshRuntime.performReactRefresh();
  if (refreshed) {
    rnLinux.log(
      'info',
      '[fast-refresh] ' +
        refreshed.updatedFamilies.size +
        ' families refreshed, ' +
        refreshed.staleFamilies.size +
        ' stale',
    );
  }
}

function renderFabric(element) {
  pendingElement = element;
  // Defer to a microtask so the rest of the bundle finishes running
  // FIRST. babel-plugin-react-refresh hoists $RefreshReg$(Component,
  // id) calls to the very end of each transformed file — if we mount
  // synchronously, performReactRefresh sees an empty family map and
  // React unmounts+remounts the tree (state lost).
  queueMicrotask(tryMount);
}

function runApplication(moduleName, parameters, _displayMode) {
  globalThis.__rnFabricSurfaceId = parameters.rootTag;
  rnLinux.log(
    'info',
    '[fabric-render] runApplication module=' + moduleName + ' surface=' + parameters.rootTag,
  );
  ensureFabricEventHandlerInstalled();
  tryMount();
}

// Fabric event dispatcher. The C++ side calls
// `eventEmitter_->dispatchEvent(name, payload)` and the standard
// `UIManagerBinding::dispatchEvent` invokes the handler registered
// below with three args: the fiber's instanceHandle, the event-type
// string, and the payload object. We map the event type → prop name
// (`topClick` / `click` → `onClick`), then dispatch through React
// Native's capture-then-bubble pipeline: capture-phase handlers
// (`on<Name>Capture`) fire root→target, then bubble-phase handlers
// (`on<Name>`) fire target→root. `event.stopPropagation()` halts the
// remaining traversal — same semantics RN/Web userland already
// expects.
//
// A couple of events (`changeText`, `valueChange`) don't bubble in
// the RN model — their user-facing signature is `(text)` / `(value)`,
// not a synthetic event. Those keep the legacy "first-match wins,
// no propagation" walk.
function eventTypeToPropName(type) {
  // `topX` is React Native's older internal prefix; modern Fabric
  // strips it but some bindings still emit it. Drop the prefix
  // before PascalCasing so both forms map to `onX`.
  if (type.startsWith('top') && type.length > 3 && type[3] >= 'A' && type[3] <= 'Z') {
    return 'on' + type.slice(3);
  }
  return 'on' + type.charAt(0).toUpperCase() + type.slice(1);
}

function makeSyntheticFabricEvent(type, payload) {
  // Mirrors the shape the legacy tag-registry path's makeSyntheticEvent
  // produced so user code that destructures `nativeEvent` keeps
  // working.
  return {
    nativeEvent: payload || {},
    type,
    timeStamp: 0,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    _propagationStopped: false,
    // currentTarget is rewritten per fiber as the dispatcher walks
    // the ancestor chain; target stays pinned at the originating
    // instanceHandle for the lifetime of the event. Both default to
    // null so handlers that read them early don't crash.
    target: null,
    currentTarget: null,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this._propagationStopped = true;
    },
    persist() {},
  };
}

// Most RN events pass a synthetic event to the handler. A few don't:
// onChangeText receives the plain text string, onValueChange (Switch)
// receives the new bool. PanResponder events keep the synthetic
// event but expose `gestureState` as a sibling of `nativeEvent` —
// the shape RN's PanResponder.create wrappers read. handlerArgForEvent
// picks the right shape for each event type. The C++ side dispatches
// a folly::dynamic payload regardless; this is purely the JS-side
// userland-API translation.
function handlerArgForEvent(type, payload, syntheticEvent) {
  switch (type) {
    case 'changeText':
    case 'topChangeText':
      return payload && payload.text != null ? payload.text : '';
    case 'valueChange':
    case 'topValueChange':
      return payload ? !!payload.value : false;
    case 'panResponderGrant':
    case 'topPanResponderGrant':
    case 'panResponderMove':
    case 'topPanResponderMove':
    case 'panResponderRelease':
    case 'topPanResponderRelease': {
      // The C++ payload is flat: locationX/Y, pageX/Y, moveX/Y,
      // dx, dy, vx, vy, target. Split it into the nativeEvent +
      // gestureState pair the PanResponder shim expects.
      const p = payload || {};
      syntheticEvent.nativeEvent = {
        locationX: p.locationX,
        locationY: p.locationY,
        pageX: p.pageX,
        pageY: p.pageY,
        target: p.target,
      };
      syntheticEvent.gestureState = {
        dx: p.dx ?? 0,
        dy: p.dy ?? 0,
        vx: p.vx ?? 0,
        vy: p.vy ?? 0,
        moveX: p.moveX,
        moveY: p.moveY,
        numberActiveTouches: 1,
      };
      return syntheticEvent;
    }
    default:
      return syntheticEvent;
  }
}

// Events that don't bubble in RN's model. We still build a synthetic
// event for them (so userland can call e.stopPropagation if it wants
// to, even though there's nothing left to bubble to), but the
// dispatcher walks the chain looking for the first handler and stops
// — no capture phase, no further propagation.
//
// Click / longPress / hoverIn / hoverOut do bubble (that's the
// React DOM contract userland inherits from web), and they take the
// full capture + bubble pipeline below.
const NON_BUBBLING_TYPES = new Set([
  'scroll',
  'topScroll',
  'refresh',
  'topRefresh',
  'layout',
  'topLayout',
  'focus',
  'topFocus',
  'blur',
  'topBlur',
  'submitEditing',
  'topSubmitEditing',
  'keyPress',
  'topKeyPress',
  'panResponderGrant',
  'topPanResponderGrant',
  'panResponderMove',
  'topPanResponderMove',
  'panResponderRelease',
  'topPanResponderRelease',
]);

// Walk fiber.return collecting every ancestor up to root. Capped at
// 64 to keep pathological trees from spinning the JS thread.
function collectFiberChain(target) {
  const chain = [];
  let fiber = target;
  while (fiber && chain.length < 64) {
    chain.push(fiber);
    fiber = fiber.return;
  }
  if (fiber) {
    rnLinux.log('warn', '[fabric-events] chain truncated at 64 ancestors');
  }
  return chain;
}

function invokeHandler(handler, event, fiber, propName) {
  // currentTarget rotates per fiber so handlers that introspect it
  // see "the fiber my prop is attached to" rather than the original
  // target. Same contract React DOM gives.
  event.currentTarget = fiber;
  try {
    handler(event);
  } catch (e) {
    rnLinux.log('error', '[fabric-events] ' + propName + ' threw: ' + String(e));
  }
}

// GTK4 propagates pointer events to every <View> ancestor's gesture
// controller in BUBBLE order (deepest first). Each ancestor fires its
// own event with a different `instanceHandle`, and our fiber walk
// would re-run bubble for each one — userland would see a child
// Pressable's onPress AND each parent's onClick, with duplicates per
// gesture in the chain. The bubble walk from the deepest event
// already visits every ancestor's `on<Name>` prop through the fiber
// tree, so we dedupe the burst to a single dispatch per physical
// action. Only the GTK-propagating pointer events need this; layout,
// scroll, change, focus/blur, etc. are single-fire by construction.
const GESTURE_BURST_TYPES = new Set([
  'click',
  'topClick',
  'longPress',
  'topLongPress',
  'hoverIn',
  'topHoverIn',
  'hoverOut',
  'topHoverOut',
  // PanResponder events fire from a GtkGestureDrag on every nested
  // <View> too — same dedupe story as click/longPress.
  'panResponderGrant',
  'topPanResponderGrant',
  'panResponderMove',
  'topPanResponderMove',
  'panResponderRelease',
  'topPanResponderRelease',
  // Touch events ride GtkEventControllerLegacy on every <View>; one
  // physical press lands on the deepest View's controller and on
  // each ancestor's. Dedupe the ancestor follow-ups; the bubble
  // walk from the deepest target already visits every ancestor's
  // `onTouchX` prop.
  'touchStart',
  'topTouchStart',
  'touchMove',
  'topTouchMove',
  'touchEnd',
  'topTouchEnd',
  'touchCancel',
  'topTouchCancel',
]);
// Gesture-burst dedupe — GTK4 delivers a single physical pointer
// action to every nested <View>'s controller in BUBBLE order
// (deepest-first), so we get N events per click with N different
// instanceHandles. We accept the first event of each (type, target)
// pair within a short window and drop everything else of the same
// type until that window expires. A 32 ms window covers any single
// physical click — even a slow software-rendered Fabric mount
// processes the whole burst in a few ms — without suppressing
// rapid follow-up clicks the user actually makes (human double-
// click floor is ~120 ms).
//
// We tried two fiber-walk approaches first (strict-ancestor match,
// stateNode-tag ancestor set). Both worked between events of the
// same TYPE before any state changed, but the burst includes events
// like touchEnd / panResponderRelease / click in order, and each
// handler that runs in between can trigger a React commit. After
// the commit, the next event's `instanceHandle` is in a fresh fiber
// tree whose `.return` chain no longer matches the stored ancestor
// set. Tags-not-references doesn't save us because the SHAPE of the
// chain shifts — outer's child fiber can land in a different
// subtree position once Pressable's host re-renders. A time-window
// is timing-coupled but immune to that whole class of edge case.
const RECENT_BURST_WINDOW_MS = 32;
const lastDispatchedByType = new Map();
function isAncestorGestureBurst(type, instanceHandle) {
  if (!GESTURE_BURST_TYPES.has(type)) return false;
  const sn = instanceHandle && instanceHandle.stateNode;
  const tag = sn && typeof sn.tag === 'number' ? sn.tag : null;
  const now = Date.now();
  const prev = lastDispatchedByType.get(type);
  if (prev && now - prev.at < RECENT_BURST_WINDOW_MS && prev.tag !== tag) {
    // Same event type, within burst window, different target — this
    // is GTK's parent <View> re-firing the same physical action.
    // Drop without updating `prev`: the first event of the burst
    // (the deepest target, fired first by BUBBLE) stays the anchor
    // for the full window.
    return true;
  }
  lastDispatchedByType.set(type, {tag, at: now});
  return false;
}

function dispatchFabricEvent(instanceHandle, type, payload) {
  if (instanceHandle == null) return;
  if (isAncestorGestureBurst(type, instanceHandle)) return;
  const propName = eventTypeToPropName(type);
  const event = makeSyntheticFabricEvent(type, payload);
  const handlerArg = handlerArgForEvent(type, payload, event);

  // Non-bubbling events: bare-payload (changeText, valueChange),
  // single-target synthetic (layout, scroll, focus, blur, refresh,
  // submitEditing, keyPress), and PanResponder events. Walk the
  // fiber chain looking for the first matching ancestor and stop.
  // Handler-identity dedupe isn't needed here since we return on the
  // first fire; forwardRef-wrapper duplicates are skipped by virtue
  // of stopping after one invocation.
  if (handlerArg !== event || NON_BUBBLING_TYPES.has(type)) {
    if (handlerArg === event) event.target = instanceHandle;
    let fiber = instanceHandle;
    let depth = 0;
    while (fiber && depth < 64) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      const handler = props && props[propName];
      if (typeof handler === 'function') {
        if (handlerArg === event) event.currentTarget = fiber;
        try {
          handler(handlerArg);
        } catch (e) {
          rnLinux.log('error', '[fabric-events] ' + propName + ' threw: ' + String(e));
        }
        return;
      }
      fiber = fiber.return;
      depth++;
    }
    return;
  }

  // Full capture + bubble pipeline for synthetic-event handlers.
  event.target = instanceHandle;
  const chain = collectFiberChain(instanceHandle);
  const captureName = propName + 'Capture';
  // React's forwardRef / wrapper components carry the SAME `onClick`
  // (and `onClickCapture`) function down to the host child they
  // render. Walking the fiber chain would therefore invoke the same
  // handler twice — once on the wrapper FC fiber, once on the host
  // fiber. Track invoked handler identities per phase and skip
  // repeats. (Same per-phase set is correct: a user installing the
  // identical function as both Capture and bubble is intentional —
  // those run in different phases.)
  const seenCapture = new Set();
  const seenBubble = new Set();

  // Capture phase: root → target. Invokes `on<Name>Capture` props the
  // parents installed to peek at the event before children handle it.
  for (let i = chain.length - 1; i >= 0; i--) {
    if (event._propagationStopped) return;
    const fiber = chain[i];
    const props = fiber.memoizedProps || fiber.pendingProps;
    const handler = props && props[captureName];
    if (typeof handler === 'function' && !seenCapture.has(handler)) {
      seenCapture.add(handler);
      invokeHandler(handler, event, fiber, captureName);
    }
  }

  // Bubble phase: target → root. Standard `on<Name>` propagation.
  // A handler can call event.stopPropagation() to halt the walk
  // before the next ancestor fires — same contract as React DOM.
  for (let i = 0; i < chain.length; i++) {
    if (event._propagationStopped) return;
    const fiber = chain[i];
    const props = fiber.memoizedProps || fiber.pendingProps;
    const handler = props && props[propName];
    if (typeof handler === 'function' && !seenBubble.has(handler)) {
      seenBubble.add(handler);
      invokeHandler(handler, event, fiber, propName);
    }
  }
}

let __fabricEventHandlerInstalled = false;
function ensureFabricEventHandlerInstalled() {
  if (__fabricEventHandlerInstalled) return;
  const fabric = globalThis.nativeFabricUIManager;
  if (!fabric || typeof fabric.registerEventHandler !== 'function') {
    rnLinux.log(
      'warn',
      '[fabric-events] nativeFabricUIManager.registerEventHandler missing — Phase 2 wiring inert',
    );
    return;
  }
  fabric.registerEventHandler((instanceHandle, type, payload) => {
    dispatchFabricEvent(instanceHandle, type, payload);
  });
  __fabricEventHandlerInstalled = true;
  rnLinux.log('info', '[fabric-events] handler installed');
}

globalThis.RN$AppRegistry = {runApplication};
rnLinux.log('info', '[fabric-render] RN$AppRegistry installed');

module.exports = {renderFabric};
