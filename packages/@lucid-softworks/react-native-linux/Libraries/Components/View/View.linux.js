'use strict';

// Metro picks up this file (over react-native/Libraries/Components/View/View)
// when the platform is 'linux'. Linux's View is just RN's stock View driven
// by the upstream ViewComponentDescriptor — we keep the JS surface identical
// so app code never imports anything Linux-specific.

const View = require('react-native/Libraries/Components/View/View').default;

module.exports = View;
module.exports.default = View;
