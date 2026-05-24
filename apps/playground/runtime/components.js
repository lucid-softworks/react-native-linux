'use strict';

// React components mirroring RN's idiom: `<View>` / `<Text>` are
// importable from the runtime, just like `react-native` exports them
// on every other platform.
//
// Internally they're thin wrappers around lowercase host tags that the
// Fabric reconciler (./fabricHostConfig.js) maps to RN shadow nodes:
//   <View> → host <view> → 'View'      shadow node → GTK widget
//   <Text> → host <text> → 'Paragraph' shadow node → GTK widget
// We do the wrap-rather-than-rename dance because JSX treats lowercase
// tags as host strings and uppercase tags as component references —
// only components can be imported.

const React = require('react');

function View(props) {
  return React.createElement('view', props, props.children);
}

function Text(props) {
  return React.createElement('text', props, props.children);
}

module.exports = {View, Text};
