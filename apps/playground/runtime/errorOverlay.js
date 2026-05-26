'use strict';

// The boundary class itself lives in the umbrella shim package so the
// expo-router shim can wrap each route in one too — that's how a
// crash inside a tab unmounts only the screen subtree (Tabs / its
// pathname useState / the bar all stay mounted) while a crash above
// the router still falls through to the outer wrapping in fabric.js.
//
// This thin re-export keeps fabric.js's `require('./errorOverlay')`
// working unchanged.

module.exports = require('@lucid-softworks/react-native-linux-expo/error-boundary');
