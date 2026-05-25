'use strict';

// React components mirroring RN's idiom: `<View>` / `<Text>` /
// `<Pressable>` / `<Button>` are importable from the runtime, just
// like `react-native` exports them on every other platform.
//
// Internally View/Text are thin wrappers around lowercase host tags
// the Fabric reconciler (./fabricHostConfig.js) maps to RN shadow
// nodes:
//   <View>     → host <view> → 'View'      shadow node → GTK widget
//   <Text>     → host <text> → 'Paragraph' shadow node → GTK widget
//   <Pressable>→ View + onClick — taps fire through the GtkGestureClick
//                attached to every ViewComponentView (see
//                vnext/src/views/ViewComponentView.cpp)
//   <Button>   → Pressable wrapping a centered Text
//
// We do the wrap-rather-than-rename dance because JSX treats lowercase
// tags as host strings and uppercase tags as component references —
// only components can be imported.

const React = require('react');

function View(props) {
  return React.createElement('view', props, props.children);
}

// RN's stock cxx TextLayoutManager returns {0,0} for measure() —
// without that, Yoga gives every <Text> zero height and siblings
// overlap. Until we wire a Pango-backed measurer, we estimate the
// height from fontSize so flex layouts don't collapse. Width still
// flows from the flex container.
function Text(props) {
  const {fontSize = 14, height, ...rest} = props;
  const estimatedHeight = Math.ceil(fontSize * 1.45);
  return React.createElement(
    'text',
    {...rest, fontSize, height: height ?? estimatedHeight},
    props.children,
  );
}

// <Pressable onPress={fn}> — a clickable View. We expose `onPress` as
// the public surface (matches react-native's API) and translate to
// `onClick` on the underlying host tag, which is what the Fabric
// host config registers with the C++ side.
function Pressable(props) {
  const {onPress, ...rest} = props;
  return React.createElement('view', {...rest, onClick: onPress}, props.children);
}

// <Button title="..." onPress={fn}> — a Pressable with a centered
// Text label. Convenience for the common "tap target with words"
// case; for richer content use <Pressable> directly.
function Button(props) {
  const {
    title,
    onPress,
    width = 160,
    height = 44,
    backgroundColor = '#3b82f6',
    color = '#ffffff',
    fontSize = 15,
    fontWeight = '600',
    borderRadius = 8,
    ...rest
  } = props;
  return React.createElement(
    Pressable,
    {
      ...rest,
      onPress,
      width,
      height,
      backgroundColor,
      borderRadius,
    },
    React.createElement(
      Text,
      {
        top: Math.max(0, (height - 22) / 2),
        left: 0,
        width,
        height: 22,
        color,
        fontSize,
        fontWeight,
        textAlign: 'center',
      },
      title,
    ),
  );
}

module.exports = {View, Text, Pressable, Button};
