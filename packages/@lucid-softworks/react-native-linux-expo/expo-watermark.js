'use strict';

// Shim for `expo-watermark`. Upstream's WatermarkView hides the child
// tree from screen recordings / screenshots (iOS uses a UITextField
// secureTextEntry trick; Android uses FLAG_SECURE on the surface).
// Neither X11 nor Wayland exposes a per-window "exclude from screen
// capture" hint a client can request — see expo-screen-capture for
// the same gap on the prevention API. The component renders as a
// plain passthrough View so apps that wrap content in it still
// layout correctly.

const React = require('react');
const {View} = require('react-native');

function WatermarkView({backgroundColor, preview: _preview, style, children, ...rest}) {
  // Honor backgroundColor + style the same way the underlying View
  // would. The content is not protected from recorders on Linux.
  const composedStyle = backgroundColor != null ? [{backgroundColor}, style] : style;
  return React.createElement(View, {style: composedStyle, ...rest}, children);
}

module.exports = WatermarkView;
module.exports.default = WatermarkView;
module.exports.WatermarkView = WatermarkView;
