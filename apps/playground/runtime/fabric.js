'use strict';

// Fabric render entrypoint.
//
// RN's SurfaceRegistryBinding::startSurface (fired when our C++ host
// calls SurfaceHandler::start()) invokes
// `globalThis.RN$AppRegistry.runApplication(moduleName, params,
// displayMode)`. We use that callback to capture the live surfaceId,
// then mount the React tree the app handed us via `renderFabric(...)`.
//
// Why deferred: the app calls `renderFabric(<App/>)` at bundle load
// time, but the surfaceId only exists once C++ has registered the
// surface with the Scheduler. We stash the pending element and mount
// once both halves are present.

const Reconciler = require('react-reconciler');
const {hostConfig, setSurfaceContext} = require('./fabricHostConfig');

const reconciler = Reconciler(hostConfig);

let pendingElement = null;
let surfaceReady = false;
let containerInfo = null;
let root = null;

function tryMount() {
  if (!surfaceReady || pendingElement === null) return;
  const fabric = globalThis.nativeFabricUIManager;
  const surfaceId = globalThis.__rnFabricSurfaceId;
  if (!fabric || !surfaceId) {
    rnLinux.log('warn', '[fabric-render] tryMount missing fabric/surfaceId');
    return;
  }
  setSurfaceContext(fabric, surfaceId);
  containerInfo = {childSet: fabric.createChildSet(surfaceId)};
  root = reconciler.createContainer(
    containerInfo,
    /* tag */ 0,
    /* hydrationCallbacks */ null,
    /* isStrictMode */ false,
    /* concurrentUpdatesByDefault */ null,
    /* identifierPrefix */ '',
    /* onUncaughtError */ (err) => rnLinux.log('error', String(err)),
    /* onCaughtError */ (err) => rnLinux.log('error', String(err)),
    /* onRecoverableError */ (err) => rnLinux.log('warn', String(err)),
    /* transitionCallbacks */ null,
  );
  reconciler.updateContainer(pendingElement, root, null, () => {
    rnLinux.log('info', '[fabric-render] initial JSX commit done');
  });
  pendingElement = null;
}

function renderFabric(element) {
  pendingElement = element;
  tryMount();
}

function runApplication(moduleName, parameters, _displayMode) {
  globalThis.__rnFabricSurfaceId = parameters.rootTag;
  surfaceReady = true;
  rnLinux.log('info',
    '[fabric-render] runApplication module=' + moduleName +
    ' surface=' + parameters.rootTag);
  tryMount();
}

globalThis.RN$AppRegistry = {runApplication};
rnLinux.log('info', '[fabric-render] RN$AppRegistry installed');

module.exports = {renderFabric};
