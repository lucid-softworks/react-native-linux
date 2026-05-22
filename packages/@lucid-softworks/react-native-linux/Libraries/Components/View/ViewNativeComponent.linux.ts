/**
 * View codegen spec for the Linux platform.
 *
 * `@react-native/codegen` consumes this file (matched by the `*NativeComponent.{ts,js}`
 * suffix) and emits:
 *
 *   - vnext/codegen/react/renderer/components/rnlinux/Props.h
 *   - vnext/codegen/react/renderer/components/rnlinux/ComponentDescriptors.h
 *   - vnext/codegen/react/renderer/components/rnlinux/ShadowNodes.h
 *
 * For now we register the upstream `RCTView` directly — Linux uses RN's
 * shared `ViewComponentDescriptor`, so all we need is the JS handle.
 */

import type {ViewProps, HostComponent} from 'react-native';
import {requireNativeComponent} from 'react-native';

type NativeProps = ViewProps;

const ViewNativeComponent: HostComponent<NativeProps> =
  requireNativeComponent<NativeProps>('RCTView');

export default ViewNativeComponent;
