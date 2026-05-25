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
}

export interface ViewProps extends BaseStyleProps {
  backgroundColor?: Color;
  borderColor?: Color;
  borderRadius?: number;
  children?: ReactNode;
}

export interface TextProps extends BaseStyleProps {
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
  children?: ReactNode;
}

export const View: (props: ViewProps) => JSX.Element;
export const Text: (props: TextProps) => JSX.Element;

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
