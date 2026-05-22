/**
 * Text codegen spec for the Linux platform.
 *
 * RN's text system splits into:
 *   - Paragraph  (the laid-out container; one widget on Linux)
 *   - Text       (inline styled run)
 *   - RawText    (the leaf string; no widget)
 *
 * The codegen emits descriptors for all three. The Linux mounting layer
 * collapses Paragraph + nested Text + RawText into a single GtkLabel with a
 * PangoAttrList — see vnext/src/views/ParagraphComponentView.cpp.
 */

import type {TextProps, HostComponent} from 'react-native';
import {requireNativeComponent} from 'react-native';

type NativeProps = TextProps;

const TextNativeComponent: HostComponent<NativeProps> =
  requireNativeComponent<NativeProps>('RCTText');

export default TextNativeComponent;
