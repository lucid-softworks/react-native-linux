'use strict';

// Shim for the `expo` module — the small surface real Expo apps
// touch from their top-level entry. The big one is
// `registerRootComponent`, which on iOS/Android wraps the App
// component with Expo's gesture/error-boundary/dev-launcher layers
// and then hands it to AppRegistry.registerComponent. On desktop we
// don't need any of that — registering with AppRegistry is enough;
// the platform package's `runApplication` mounts the component into
// the Fabric surface.
//
// Apps written as `import {registerRootComponent} from 'expo'; …
// registerRootComponent(App)` drop in unchanged.

const {AppRegistry} = require('react-native');

function registerRootComponent(App) {
  AppRegistry.registerComponent('main', () => App);
}

module.exports = {
  registerRootComponent,
};
