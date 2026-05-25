// Public type surface of the playground runtime. The actual
// implementations live in vendor.js / fabric.js / components.js,
// loaded once at cold start onto globalThis.__rnv — but from the
// app bundle's perspective these are just normal imports.
//
// We hand-write the .d.ts (rather than emit it from TS sources)
// because the runtime files stayed .js for now. When they migrate
// to TS this file can go away.

import type {ReactNode} from 'react';

type Color = string | number | readonly [number, number, number, number?];

interface BaseStyleProps {
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  width?: number;
  height?: number;
  position?: 'absolute' | 'relative';
  opacity?: number;
  collapsable?: boolean;
  // Yoga flexbox
  flex?: number;
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  justifyContent?:
    | 'flex-start' | 'center' | 'flex-end'
    | 'space-between' | 'space-around' | 'space-evenly';
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline';
  alignSelf?: 'auto' | 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline';
  alignContent?:
    | 'flex-start' | 'center' | 'flex-end'
    | 'space-between' | 'space-around' | 'stretch';
  gap?: number;
  rowGap?: number;
  columnGap?: number;
  padding?: number;
  paddingTop?: number; paddingRight?: number;
  paddingBottom?: number; paddingLeft?: number;
  paddingHorizontal?: number; paddingVertical?: number;
  margin?: number;
  marginTop?: number; marginRight?: number;
  marginBottom?: number; marginLeft?: number;
  marginHorizontal?: number; marginVertical?: number;
}

// Anything you'd put in `<View style={...}>`. Equivalent to a
// ViewProps row sans event-y / non-style fields like onClick.
export type ViewStyle = BaseStyleProps & {
  backgroundColor?: Color;
  borderColor?: Color;
  borderWidth?: number;
  borderTopWidth?: number;
  borderRightWidth?: number;
  borderBottomWidth?: number;
  borderLeftWidth?: number;
  borderRadius?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomRightRadius?: number;
  borderBottomLeftRadius?: number;
};

export type TextStyle = BaseStyleProps & {
  color?: Color;
  backgroundColor?: Color;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?:
    | 'normal' | 'bold'
    | '100' | '200' | '300' | '400'
    | '500' | '600' | '700' | '800' | '900';
  fontStyle?: 'normal' | 'italic' | 'oblique';
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'left' | 'right' | 'center' | 'justify';
};

// Accepts the same shapes RN's StyleSheet flattening does — a single
// object, an array of objects (nullable / falsy entries permitted
// for conditional styling), or null.
export type StyleProp<T> = T | null | false | undefined | readonly StyleProp<T>[];

// Direct ViewStyle keys can be passed as top-level props on <View>
// (legacy / inline shortcut) OR bundled in `style`. The style prop
// wins when both are set.
export interface ViewProps extends ViewStyle {
  style?: StyleProp<ViewStyle>;
  onClick?: () => void;
  children?: ReactNode;
}

export interface TextProps extends TextStyle {
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
}

export interface PressableProps extends Omit<ViewProps, 'onClick'> {
  onPress?: () => void;
}

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  title: string;
  color?: Color;
  fontSize?: number;
  fontWeight?: TextProps['fontWeight'];
}

export interface ScrollViewProps extends ViewProps {
  horizontal?: boolean;
  showsHorizontalScrollIndicator?: boolean;
  showsVerticalScrollIndicator?: boolean;
}

export interface ImageSource {
  uri: string;
  width?: number;
  height?: number;
  scale?: number;
}

export interface ImageProps extends Omit<ViewProps, 'children' | 'onClick'> {
  source: ImageSource | ImageSource[];
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center' | 'repeat';
  tintColor?: Color;
}

export interface TextInputProps extends Omit<ViewProps, 'children' | 'onClick'> {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  placeholderTextColor?: Color;
  maxLength?: number;
  autoFocus?: boolean;
  onChangeText?: (text: string) => void;
}

export const View: (props: ViewProps) => JSX.Element;
export const ScrollView: (props: ScrollViewProps) => JSX.Element;
export const Image: (props: ImageProps) => JSX.Element;
export const TextInput: (props: TextInputProps) => JSX.Element;
export const Text: (props: TextProps) => JSX.Element;
export const Pressable: (props: PressableProps) => JSX.Element;
export const Button: (props: ButtonProps) => JSX.Element;

// RN-style StyleSheet helper. `create` is essentially identity at
// runtime; the value-add is the TypeScript inference on the keys.
export const StyleSheet: {
  create<T extends {[k: string]: ViewStyle | TextStyle}>(styles: T): T;
  flatten<T>(style: StyleProp<T>): T;
  compose<T>(a: StyleProp<T>, b: StyleProp<T>): StyleProp<T>;
  hairlineWidth: number;
  absoluteFill: ViewStyle;
  absoluteFillObject: ViewStyle;
};

export interface FlatListProps<T> {
  data: readonly T[];
  renderItem: (info: {item: T; index: number}) => JSX.Element | null;
  keyExtractor?: (item: T, index: number) => string;
  ItemSeparatorComponent?: (() => JSX.Element) | JSX.Element;
  ListHeaderComponent?: (() => JSX.Element) | JSX.Element;
  ListFooterComponent?: (() => JSX.Element) | JSX.Element;
  ListEmptyComponent?: (() => JSX.Element) | JSX.Element;
  horizontal?: boolean;
  numColumns?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  extraData?: unknown;
}
export const FlatList: <T>(props: FlatListProps<T>) => JSX.Element;

export interface ModalProps {
  visible?: boolean;
  transparent?: boolean;
  animationType?: 'none' | 'slide' | 'fade';
  onRequestClose?: () => void;
  onShow?: () => void;
  children?: ReactNode;
}
export const Modal: (props: ModalProps) => JSX.Element | null;

// renderFabric mounts a React element into the Fabric surface that
// C++ opens. Subsequent calls (from re-eval'd app bundles) feed
// Fast Refresh — see runtime/fabric.js.
export function renderFabric(element: ReactNode): void;

// The JSI-bridge React entrypoint. Kept around as a legacy path;
// new code should use renderFabric.
export function render(element: ReactNode, onCommit?: () => void): unknown;

// The lightning-path JSI bridge surface. Hermes-side bindings
// installed by vnext/src/jsi/RnLinuxBindings.cpp. The whole surface
// is exposed via `rnLinux.X` globals.
declare global {
  const rnLinux: {
    log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void;
    setInterval(fn: () => void, ms: number): number;
    clearInterval(id: number): void;
    // … (other rnLinux.* members live in vnext/src/jsi)
  };
}
