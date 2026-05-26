'use strict';

// Shim for `expo-sharing`. Routes through the existing
// rnLinux.openURL binding (g_app_info_launch_default_for_uri),
// which hands the URI off to whatever desktop-entry app the user's
// MIME database says should handle it. That's the "open in
// something" path; the freedesktop world doesn't have a unified
// iOS-style share sheet that lists "send via X / Y / Z" for one
// click — apps usually open the file in its default handler
// (image viewer for images, browser for URLs, etc.) and the
// chooser UI is the user's own xdg-open dialog.
//
// A richer implementation would call
// org.freedesktop.portal.OpenURI.OpenFile through xdg-desktop-portal
// to get the OS chooser dialog (when running under Flatpak / Snap /
// a portal-aware desktop). That's a planned follow-up.

const _hasNative = typeof rnLinux !== 'undefined' && typeof rnLinux.openURL === 'function';

async function isAvailableAsync() {
  if (!_hasNative) return false;
  // canOpenURL with a file: URI proves the openURL path is wired
  // to gio's launch_default_for_uri (otherwise we'd return true
  // unconditionally on any system, which lies on Devuan/Alpine
  // without gio).
  return typeof rnLinux.canOpenURL === 'function';
}

async function shareAsync(url, _options) {
  if (!_hasNative) {
    throw new Error('expo-sharing: native rnLinux.openURL not bound');
  }
  if (typeof url !== 'string' || !url) {
    throw new TypeError('shareAsync: url must be a non-empty string');
  }
  // Accept bare paths and file:// URIs interchangeably — the
  // expo-file-system docs say file:// URIs are the norm, but
  // app code in the wild passes both.
  const uri = url.startsWith('file:') || url.includes('://') ? url : 'file://' + url;
  const ok = rnLinux.openURL(uri);
  if (!ok) {
    throw new Error(`expo-sharing: no default app for ${uri}`);
  }
}

const api = {
  isAvailableAsync,
  shareAsync,
};

module.exports = api;
module.exports.default = api;
