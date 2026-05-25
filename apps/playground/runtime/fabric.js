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
    const elementToCommit = React.createElement(ErrorBoundary, null, pendingElement);
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
  // function objects under the SAME family ids). pendingElement here
  // is <NewApp/>, BUT calling updateContainer with it would compare
  // OldApp vs NewApp by referential equality — and isCompatibleFamily
  // ForHotReloading needs resolveFamily to be set first, otherwise it
  // returns false ("Hot reloading is disabled") and React unmounts.
  // Solution: call performReactRefresh BEFORE updateContainer.
  // performReactRefresh installs resolveFamily on the reconciler and
  // schedules a refresh on every mounted root — that single call is
  // enough to swap the type and preserve hook state, no
  // updateContainer needed.
  pendingElement = null;
  // If the user just reloaded from the LogBox, the boundary stashed a
  // reset function. Fire it BEFORE performReactRefresh so the cleared
  // state lands in the same commit batch as the family swap — the
  // panel disappears and the freshly-evaluated children mount.
  if (typeof globalThis.__rnLinuxBoundaryReset === 'function') {
    const reset = globalThis.__rnLinuxBoundaryReset;
    globalThis.__rnLinuxBoundaryReset = null;
    reset();
  }
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
