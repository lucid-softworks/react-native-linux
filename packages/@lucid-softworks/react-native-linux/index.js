'use strict';

// @lucid-softworks/react-native-linux re-exports react-native. Metro's
// platform extension resolution (configured by
// @lucid-softworks/react-native-linux-cli) picks up `*.linux.js`
// files in this package before falling back to react-native's `.js`/`.native.js`
// implementations.
//
// In other words: app code keeps importing from 'react-native'. We do not
// expose a separate import surface.

module.exports = require('react-native');
