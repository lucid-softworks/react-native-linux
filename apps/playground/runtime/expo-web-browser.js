'use strict';

// Shim for `expo-web-browser`. Real implementation on iOS/Android
// opens an in-app browser (SFSafariViewController / Custom Tabs).
// We route through Linking.openURL which on Linux ends up calling
// g_app_info_launch_default_for_uri, opening the system's default
// browser (Firefox, Chrome, etc.). Closest sensible analog.

const {Linking} = require('./react-native');

function openBrowserAsync(url, _options) {
  Linking.openURL(url);
  // The real API returns {type: 'opened' | 'cancel' | 'dismiss'}.
  return Promise.resolve({type: 'opened'});
}

function dismissBrowser() {
  // Can't dismiss the system browser from here; no-op.
  return Promise.resolve();
}

function maybeCompleteAuthSession() {
  // OAuth-flow helper; meaningful only when the auth callback comes
  // back through the in-app browser. Not applicable on desktop.
  return {type: 'failed', error: 'not-supported'};
}

module.exports = {
  openBrowserAsync,
  dismissBrowser,
  maybeCompleteAuthSession,
  // Constants the real module exports
  WebBrowserPresentationStyle: {
    AUTOMATIC: 'automatic',
    FULL_SCREEN: 'fullScreen',
    PAGE_SHEET: 'pageSheet',
    FORM_SHEET: 'formSheet',
    CURRENT_CONTEXT: 'currentContext',
    OVER_FULL_SCREEN: 'overFullScreen',
    OVER_CURRENT_CONTEXT: 'overCurrentContext',
    POPOVER: 'popover',
  },
};
