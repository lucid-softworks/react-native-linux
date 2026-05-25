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

// Wrap every host-tag-emitting component in React.forwardRef so apps
// can do `<View ref={r}>` and get the underlying host instance via
// commitAttachRef → getPublicInstance. Without forwardRef the ref
// would silently dead-end on the function component itself (React
// logs a DEV warning and ref.current stays null).
const View = React.forwardRef(function View(props, ref) {
  return React.createElement('view', {...props, ref}, props.children);
});

const ScrollView = React.forwardRef(function ScrollView(props, ref) {
  return React.createElement('scrollview', {...props, ref}, props.children);
});

// <Image source={{uri: 'file:///path/to/img.png'}} resizeMode="cover" />
// RN's ImageProps parser reads the `source` prop into its internal
// `sources` vector — it accepts either a single {uri,…} object or an
// array of them (multi-density). Pass through unchanged.
const Image = React.forwardRef(function Image(props, ref) {
  return React.createElement('image', {...props, ref});
});

// <TextInput value="..." onChangeText={fn} placeholder="..."> — RN's
// value prop maps to BaseTextInputProps.text (we rename here). The
// onChangeText callback is stripped and registered via
// rnLinux.fabricOnChangeText in the host config; the C++ component
// view dispatches into it on every GtkText "changed" signal.
const TextInput = React.forwardRef(function TextInput(props, ref) {
  const {value, onChangeText, ...rest} = props;
  return React.createElement('textinput', {
    ...rest,
    ref,
    text: value,
    onChangeText,
  });
});

// Tracks whether we're inside an outer <Text>. The outermost Text
// emits a `<text>` host (Paragraph shadow node — Yoga layout root +
// AttributedString owner); inner Texts emit `<innertext>` host
// (Text shadow node — just contributes one fragment with its own
// TextAttributes to the ancestor Paragraph's AttributedString). That
// lets `<Text>foo <Text style={{color:'red'}}>bar</Text></Text>`
// produce two fragments with distinct styling instead of collapsing.
const InTextContext = React.createContext(false);

const Text = React.forwardRef(function Text(props, ref) {
  const inText = React.useContext(InTextContext);
  const hostTag = inText ? 'innertext' : 'text';
  return React.createElement(
    InTextContext.Provider,
    {value: true},
    React.createElement(hostTag, {...props, ref}, props.children),
  );
});

// <Pressable onPress={fn}> — a clickable View. We expose `onPress` as
// the public surface (matches react-native's API) and translate to
// `onClick` on the underlying host tag, which is what the Fabric
// host config registers with the C++ side.
const Pressable = React.forwardRef(function Pressable(props, ref) {
  const {onPress, ...rest} = props;
  return React.createElement('view', {...rest, ref, onClick: onPress}, props.children);
});

// <Switch value={bool} onValueChange={fn} disabled={bool} /> — backed
// by GtkSwitch on the C++ side (SwitchComponentView). RN-idiomatic
// onValueChange callback receives the new boolean.
const Switch = React.forwardRef(function Switch(props, ref) {
  return React.createElement('switch', {...props, ref});
});

// <ActivityIndicator animating size color /> — backed by GtkSpinner.
// GTK's spinner is always one size; RN's "small" / "large" / number
// hints don't map cleanly so they get accepted but ignored at the
// widget level. `color` is similarly a no-op pending custom theme
// tinting (CSS provider work).
const ActivityIndicator = React.forwardRef(function ActivityIndicator(props, ref) {
  const {animating = true, hidesWhenStopped = true, size: _s, color: _c, ...rest} = props;
  return React.createElement('spinner', {...rest, ref, animating, hidesWhenStopped});
});

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

module.exports = {
  View,
  ScrollView,
  Image,
  Text,
  TextInput,
  Pressable,
  Button,
  Switch,
  ActivityIndicator,
};
