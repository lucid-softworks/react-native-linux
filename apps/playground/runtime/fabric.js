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
    // Wrap the user's tree in an ErrorBoundary so JS exceptions during
    // render / commit / lifecycle land on an in-window RedBox instead
    // of leaving the user staring at a blank surface.
    const elementToCommit = React.createElement(
      ErrorBoundary,
      {scope: 'app', catchAsync: true},
      pendingElement,
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
      ErrorBoundary,
      {scope: 'app', catchAsync: true},
      pendingElement,
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
  tryMount();
}

globalThis.RN$AppRegistry = {runApplication};
rnLinux.log('info', '[fabric-render] RN$AppRegistry installed');

module.exports = {renderFabric};
