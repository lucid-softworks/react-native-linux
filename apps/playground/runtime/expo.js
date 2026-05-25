'use strict';

// Shim for the `expo` module — the small surface real Expo apps
// touch from their top-level entry. The big one is
// `registerRootComponent`, which on iOS/Android wraps the App
// component with Expo's gesture/error-boundary/dev-launcher layers
// and then hands it to AppRegistry.registerComponent. On desktop we
// don't need any of that — we just need to render the component
// into our Fabric surface, which `renderFabric` already does.
//
// Apps written as `import {registerRootComponent} from 'expo'; …
// registerRootComponent(App)` drop in unchanged.

const React = require('react');
const {renderFabric} = require('./fabric');

function registerRootComponent(App) {
  renderFabric(React.createElement(App));
}

module.exports = {
  registerRootComponent,
};
