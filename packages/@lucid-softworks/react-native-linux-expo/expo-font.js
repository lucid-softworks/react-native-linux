'use strict';

// Shim for `expo-font`. On iOS/Android, this loads .ttf/.otf bundle
// assets and registers them so RN's Text can `fontFamily: 'MyFont'`.
// GTK uses Pango for font discovery — anything installed on the
// system is already available, custom .ttf needs Fontconfig magic
// that's out of scope for the MVP. So we report "loaded" immediately;
// any unloaded font will just fall back to the system default in
// Pango's resolution, which is the right thing visually for a desktop.

function useFonts(_map) {
  return [true, null];
}

function loadAsync(_fontMap) {
  return Promise.resolve();
}

function isLoaded(_name) {
  return true;
}

function isLoading(_name) {
  return false;
}

function unloadAsync(_name) {
  return Promise.resolve();
}

function unloadAllAsync() {
  return Promise.resolve();
}

module.exports = {
  useFonts,
  loadAsync,
  isLoaded,
  isLoading,
  unloadAsync,
  unloadAllAsync,
  processFontFamily: name => name,
};
