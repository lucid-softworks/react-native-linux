'use strict';

// @sentry/react-native shim. Real impl wires native crash handlers
// + an HTTP transport to ingest.sentry.io. We're not shipping crash
// reporting today, so init / captureException / etc. all become
// no-ops. Apps that wrap their root in Sentry.wrap() get a
// passthrough HOC.

const React = require('react');

function noop() {}
function noopAsync() {
  return Promise.resolve();
}

Object.defineProperty(module.exports, '__esModule', {value: true});

module.exports.init = noop;
module.exports.captureException = noop;
module.exports.captureMessage = noop;
module.exports.captureEvent = noop;
module.exports.setUser = noop;
module.exports.setTag = noop;
module.exports.setTags = noop;
module.exports.setContext = noop;
module.exports.setExtra = noop;
module.exports.setExtras = noop;
module.exports.addBreadcrumb = noop;
module.exports.configureScope = noop;
module.exports.withScope = function (cb) {
  cb({setTag: noop, setExtra: noop, setUser: noop, setContext: noop});
};
module.exports.startTransaction = function () {
  return {finish: noop, setData: noop, setTag: noop};
};
module.exports.flush = noopAsync;
module.exports.close = noopAsync;
module.exports.wrap = function (App) {
  return App;
};
module.exports.ErrorBoundary = function (props) {
  return props.children || null;
};
module.exports.Profiler = function (props) {
  return props.children || null;
};
module.exports.TouchEventBoundary = function (props) {
  return props.children || null;
};
module.exports.ReactNavigationInstrumentation = function () {
  return {registerNavigationContainer: noop};
};
module.exports.ReactNativeTracing = function () {};
module.exports.Severity = {
  Fatal: 'fatal',
  Error: 'error',
  Warning: 'warning',
  Info: 'info',
  Debug: 'debug',
};
module.exports.default = module.exports;
