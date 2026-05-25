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
// Installs globalThis.RN$AppRegistry so SurfaceRegistryBinding::startSurface
// (fired when our C++ host calls SurfaceHandler::start()) has a
// runApplication target. The export `renderFabric` drives a real
// react-reconciler tree through nativeFabricUIManager — the Fabric
// equivalent of the JSI-bridge `render` below.
const {renderFabric} = require('./fabric');

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

const {View, ScrollView, Image, Text, TextInput, Pressable, Button} = require('./components');
const StyleSheet = require('./stylesheet');

module.exports = {
  render, renderFabric,
  View, ScrollView, Image, Text, TextInput, Pressable, Button,
  StyleSheet,
};
