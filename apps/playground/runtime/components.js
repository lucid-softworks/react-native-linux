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
  // RN's ScrollView splits styling between the outer scrolling
  // viewport (`style`) and the inner content wrapper
  // (`contentContainerStyle`). Akari's auth screen relies on
  // `contentContainerStyle: { flexGrow: 1, justifyContent: 'center',
  // alignItems: 'center' }` to centre its content vertically and
  // horizontally — dropping that prop pins everything to the
  // viewport's top-left. Wrap the children in an inner View with the
  // content-container style so the flex declarations land somewhere
  // Yoga can act on.
  const {contentContainerStyle, children, ...rest} = props;
  const inner = contentContainerStyle
    ? React.createElement('view', {style: contentContainerStyle}, children)
    : children;
  return React.createElement('scrollview', {...rest, ref}, inner);
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
  const {value, onChangeText, onSubmitEditing, onKeyPress, ...rest} = props;
  return React.createElement('textinput', {
    ...rest,
    ref,
    text: value,
    onChangeText,
    onSubmitEditing,
    onKeyPress,
  });
});

// Tracks whether we're inside an outer <Text>. The outermost Text
// emits a `<text>` host (Paragraph shadow node — Yoga layout root +
// AttributedString owner); inner Texts emit `<innertext>` host
// (Text shadow node — just contributes one fragment with its own
// TextAttributes to the ancestor Paragraph's AttributedString). That
// lets `<Text>foo <Text style={{color:'red'}}>bar</Text></Text>`
// produce two fragments with distinct styling instead of collapsing.
//
// We avoid wrapping every Text in a Provider — even with a stable
// `true` value, the extra fiber in a deep tree compounds. Instead the
// outer Text branches once on whether it's the root, and only emits
// the Provider when it actually has children that might be Texts.
const InTextContext = React.createContext(false);

const Text = React.forwardRef(function Text(props, ref) {
  const inText = React.useContext(InTextContext);
  if (inText) {
    // Already inside a Text — render the data-only fragment host.
    return React.createElement('innertext', {...props, ref}, props.children);
  }
  // Outer Text — Paragraph shadow node. Only wrap children in the
  // Provider if there are non-string children (string children turn
  // into RawText leaves; no nested Text possible).
  const hasElementChildren = React.Children.toArray(props.children).some(
    c => c != null && typeof c !== 'string',
  );
  const host = React.createElement('text', {...props, ref}, props.children);
  return hasElementChildren
    ? React.createElement(InTextContext.Provider, {value: true}, host)
    : host;
});

// <Pressable onPress={fn}> — a clickable View. We expose `onPress` as
// the public surface (matches react-native's API) and translate to
// `onClick` on the underlying host tag, which is what the Fabric
// host config registers with the C++ side.
//
// `children` can be either a ReactNode (the common case) OR a
// function (state) => ReactNode — the latter is RN's render-prop
// form that exposes the {pressed, hovered, focused} state to the
// caller (used by react-native-paper's TouchableRipple, react-
// navigation's pressable links, every theme-aware button library).
// Without unwrapping it React throws "Functions are not valid as a
// React child" and the whole subtree blanks out. We don't yet track
// pressed/hovered state plumbed back from GTK, so the state arg is
// {pressed: false, hovered: false, focused: false} — apps get
// rendering, just no visual press feedback yet.
const Pressable = React.forwardRef(function Pressable(props, ref) {
  const {onPress, children, style, ...rest} = props;
  // RN's Pressable accepts BOTH `children` and `style` in render-prop
  // form, evaluated with the current interaction state. Evaluate both
  // here so flattenStyle (which only handles object/array forms) sees
  // a usable shape — otherwise function-style silently drops every
  // backgroundColor / padding / flex declaration on the button.
  const state = {pressed: false, hovered: false, focused: false};
  const resolvedChildren = typeof children === 'function' ? children(state) : children;
  const resolvedStyle = typeof style === 'function' ? style(state) : style;
  return React.createElement(
    'view',
    {...rest, ref, style: resolvedStyle, onClick: onPress},
    resolvedChildren,
  );
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
