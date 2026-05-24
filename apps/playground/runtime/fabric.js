'use strict';

// Fabric render entrypoint.
//
// First-eval flow:
//   1. C++ host starts → SurfaceRegistryBinding::startSurface fires
//      globalThis.RN$AppRegistry.runApplication, which we install
//      below. That captures the surfaceId on globalThis.
//   2. The app's `renderFabric(<App/>)` call mounts the React tree
//      via react-reconciler.createContainer + updateContainer, with
//      the host config that drives nativeFabricUIManager.
//
// Reload-eval flow:
//   The C++ side re-evaluates the bundle in the same Hermes runtime.
//   `globalThis.__rnFabricSurfaceId` still holds the live surfaceId
//   (set on the first eval) so we mount immediately — no second
//   surface.start needed. Each reload throws away the previous React
//   root and creates a fresh one; persistent mode then issues a
//   completeRoot with the new tree, which replaces whatever was on
//   the surface. (Component state is lost across edits until
//   react-refresh is wired up — that's the next layer.)

const Reconciler = require('react-reconciler');
const {hostConfig, setSurfaceContext} = require('./fabricHostConfig');

const reconciler = Reconciler(hostConfig);

let pendingElement = null;

function tryMount() {
  if (pendingElement === null) return;
  const fabric = globalThis.nativeFabricUIManager;
  const surfaceId = globalThis.__rnFabricSurfaceId;
  if (!fabric || !surfaceId) return;  // pre-runApplication; wait

  // Reload: tear down the previous reconciler+root so its useEffect
  // cleanups fire (clearInterval, etc.) before we replace the tree.
  // The old reconciler's hostConfig closures still point at valid
  // jsi/Fabric bindings (globalThis.nativeFabricUIManager survives),
  // so unmount completes cleanly.
  const prev = globalThis.__rnFabricInstance;
  if (prev) {
    try {
      prev.reconciler.updateContainer(null, prev.root, null, () => {});
    } catch (e) {
      rnLinux.log('warn', '[fabric-render] previous unmount threw: ' + e);
    }
  }

  setSurfaceContext(fabric, surfaceId);
  // Container is just a sink the reconciler hands back to us in
  // createContainerChildSet / replaceContainerChildren. The child-set
  // itself is created per-commit by the host config.
  const containerInfo = {};
  const root = reconciler.createContainer(
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
  globalThis.__rnFabricInstance = {reconciler, root};
  const elementToCommit = pendingElement;
  pendingElement = null;
  reconciler.updateContainer(elementToCommit, root, null, () => {
    rnLinux.log('info', '[fabric-render] JSX commit done');
  });
}

function renderFabric(element) {
  pendingElement = element;
  tryMount();
}

function runApplication(moduleName, parameters, _displayMode) {
  globalThis.__rnFabricSurfaceId = parameters.rootTag;
  rnLinux.log('info',
    '[fabric-render] runApplication module=' + moduleName +
    ' surface=' + parameters.rootTag);
  tryMount();
}

globalThis.RN$AppRegistry = {runApplication};
rnLinux.log('info', '[fabric-render] RN$AppRegistry installed');

module.exports = {renderFabric};
