'use strict';

// Public surface of the playground's runtime. Apps import `render` and
// hand it a React element; the runtime takes care of bootstrapping
// Hermes shims, the react-reconciler host config, and the root
// container — none of which a typical app should ever touch.
//
// When the lightning-path bridge is replaced by real Fabric in Phase
// 5.4+, this module's implementation moves; the `render(element)` API
// stays the same.

require('./shims');
// Side-effect: installs globalThis.RN$AppRegistry so that
// SurfaceRegistryBinding::startSurface (fired when our C++ host calls
// SurfaceHandler::start()) has a runApplication target. Drives a
// hand-rolled shadow tree through nativeFabricUIManager to exercise
// the Fabric → MountingManager → GTK widget pipeline.
require('./fabric');

const Reconciler = require('react-reconciler');
const {hostConfig} = require('./hostConfig');

const reconciler = Reconciler(hostConfig);

function render(element, onCommit) {
  const root = reconciler.createContainer(
    /* containerInfo */ {},
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
  reconciler.updateContainer(element, root, null, () => {
    rnLinux.log('info', 'initial render committed');
    if (typeof onCommit === 'function') onCommit();
  });
  return root;
}

module.exports = {render};
