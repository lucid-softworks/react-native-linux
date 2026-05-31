'use strict';

// expo-asset shim. Real impl preloads + caches resolved asset URIs +
// metadata via a native module. We don't ship a Linux backend for
// it yet, so the JS surface returns the asset module reference with
// its bundled path filled in directly. `downloadAsync` resolves
// immediately because everything is already in the bundle.

// Required side-effect: register the native module so any
// `requireNativeModule('ExpoAsset')` from upstream code finds a
// stub rather than throwing.
try {
  const expoModulesCore = require('./expo-modules-core');
  if (expoModulesCore && typeof expoModulesCore.registerExpoModule === 'function') {
    expoModulesCore.registerExpoModule('ExpoAsset', {});
  }
} catch (_) {
  // expo-modules-core not loaded yet; the constructor below still
  // works without the native registration.
}

function Asset(props) {
  if (typeof props === 'string') {
    this.uri = props;
    this.localUri = props;
    this.hash = null;
    this.name = props.split('/').pop() || 'asset';
    this.type = (this.name.split('.').pop() || '').toLowerCase();
    this.width = null;
    this.height = null;
  } else {
    Object.assign(this, props || {});
    if (!this.localUri && this.uri) this.localUri = this.uri;
  }
  this.downloaded = true;
}

Asset.prototype.downloadAsync = function () {
  return Promise.resolve(this);
};

Asset.fromModule = function (moduleId) {
  // In a real bundler `moduleId` would be the metro asset reference
  // an `__d` call shipped — for esbuild-bundled assets we get the
  // dataurl directly so `moduleId` IS the uri string.
  if (typeof moduleId === 'string') return new Asset(moduleId);
  if (moduleId && moduleId.uri) return new Asset(moduleId);
  return new Asset({uri: ''});
};

Asset.fromURI = function (uri) {
  return new Asset({uri});
};

Asset.loadAsync = function (modules) {
  const arr = Array.isArray(modules) ? modules : [modules];
  return Promise.all(arr.map(m => Asset.fromModule(m).downloadAsync()));
};

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.Asset = Asset;
module.exports.default = {Asset};
module.exports.useAssets = function () {
  return [[], null];
};
