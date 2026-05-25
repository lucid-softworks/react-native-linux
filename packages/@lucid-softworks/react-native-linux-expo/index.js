'use strict';

// This package is not meant to be imported as a single entry. Each Expo
// module shim sits at the package root under its own filename (e.g.
// `./expo-status-bar`, `./expo-router`) and is wired into Metro via a
// `resolveRequest` table in the consumer's `metro.config.js`. The table
// rewrites bare specifiers like `expo-status-bar` to point at our shim
// when `platform === 'linux'`, leaving iOS/Android resolution untouched.
//
// See template/metro.config.js for the canonical wiring.
module.exports = {};
