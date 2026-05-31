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
// Integration factories — apps pass these into Sentry.init({integrations: [...]}).
// All return the same empty integration shape; init no-ops the array anyway.
function makeIntegration(name) {
  return function () {
    return {name: name, setupOnce: noop, setup: noop, processEvent: e => e};
  };
}
module.exports.mobileReplayIntegration = makeIntegration('MobileReplay');
module.exports.feedbackIntegration = makeIntegration('Feedback');
module.exports.reactNativeTracingIntegration = makeIntegration('ReactNativeTracing');
module.exports.reactNavigationIntegration = makeIntegration('ReactNavigation');
module.exports.appStartIntegration = makeIntegration('AppStart');
module.exports.deviceContextIntegration = makeIntegration('DeviceContext');
module.exports.nativeReleaseIntegration = makeIntegration('NativeRelease');
module.exports.httpClientIntegration = makeIntegration('HttpClient');
module.exports.reactNativeErrorHandlersIntegration = makeIntegration('ReactNativeErrorHandlers');
module.exports.spotlightBrowserIntegration = makeIntegration('SpotlightBrowser');
module.exports.spotlightIntegration = makeIntegration('Spotlight');
module.exports.browserReplayIntegration = makeIntegration('BrowserReplay');
module.exports.browserTracingIntegration = makeIntegration('BrowserTracing');
module.exports.metricsAggregator = makeIntegration('MetricsAggregator');
// `getDefaultIntegrations` is consulted during init to seed the
// integration list; returning empty array is the canonical noop.
module.exports.getDefaultIntegrations = function () {
  return [];
};
module.exports.startSpan = function (_opts, cb) {
  return cb({end: noop, setAttribute: noop, setStatus: noop});
};
module.exports.startSpanManual = module.exports.startSpan;
module.exports.startInactiveSpan = function () {
  return {end: noop, setAttribute: noop, setStatus: noop};
};
module.exports.getActiveSpan = function () {
  return null;
};
module.exports.setMeasurement = noop;
module.exports.Severity = {
  Fatal: 'fatal',
  Error: 'error',
  Warning: 'warning',
  Info: 'info',
  Debug: 'debug',
};
module.exports.default = module.exports;
