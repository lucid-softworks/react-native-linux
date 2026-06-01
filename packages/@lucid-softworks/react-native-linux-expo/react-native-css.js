'use strict';

// react-native-css shim. The real package compiles tailwindcss + custom
// CSS via lightningcss at metro/babel time and emits a routing table
// the runtime hooks into. We don't have that build pipeline here, so
// we hand-roll a Tailwind-utility-to-RN-style mapping that covers ~80%
// of the v4 default class set and degrade unknown classes to no-ops.
//
// API surface (from react-native-css@0.0.0-nightly.5ce6396):
//   * useCssElement(Component, props, mapping) — wraps a component so
//     mapping className-like props become style-like props.
//   * useNativeVariable / useUnstableNativeVariable — CSS-var reader.
//     We return undefined; consumers tolerate this for non-themed apps.
//   * styled(Component, mapping) — HOC sugar over useCssElement.
//   * colorScheme — getter/setter for dark mode. We pin to 'light'.
//   * vars(map) — wraps CSS vars into a style object. No-op here.
//   * VariableContextProvider — render-pass-through.
//   * StyleCollection — metro-side style registry. No-op stubs.

const React = require('react');

// Tailwind v4 spacing scale: 1 unit = 0.25rem = 4px.
const SPACING_UNIT = 4;

// Curated palette (Tailwind v4 defaults). Names match Tailwind's own
// `bg-<name>`, `text-<name>`, `border-<name>` shorthand. We carry the
// full 50–950 ramp for the most-used hues + the named-tone constants.
const COLORS = {
  transparent: 'transparent',
  current: 'currentColor',
  white: '#ffffff',
  black: '#000000',
  'slate-50': '#f8fafc',
  'slate-100': '#f1f5f9',
  'slate-200': '#e2e8f0',
  'slate-300': '#cbd5e1',
  'slate-400': '#94a3b8',
  'slate-500': '#64748b',
  'slate-600': '#475569',
  'slate-700': '#334155',
  'slate-800': '#1e293b',
  'slate-900': '#0f172a',
  'slate-950': '#020617',
  'gray-50': '#f9fafb',
  'gray-100': '#f3f4f6',
  'gray-200': '#e5e7eb',
  'gray-300': '#d1d5db',
  'gray-400': '#9ca3af',
  'gray-500': '#6b7280',
  'gray-600': '#4b5563',
  'gray-700': '#374151',
  'gray-800': '#1f2937',
  'gray-900': '#111827',
  'gray-950': '#030712',
  'zinc-50': '#fafafa',
  'zinc-100': '#f4f4f5',
  'zinc-200': '#e4e4e7',
  'zinc-300': '#d4d4d8',
  'zinc-400': '#a1a1aa',
  'zinc-500': '#71717a',
  'zinc-600': '#52525b',
  'zinc-700': '#3f3f46',
  'zinc-800': '#27272a',
  'zinc-900': '#18181b',
  'zinc-950': '#09090b',
  'neutral-50': '#fafafa',
  'neutral-100': '#f5f5f5',
  'neutral-200': '#e5e5e5',
  'neutral-300': '#d4d4d4',
  'neutral-400': '#a3a3a3',
  'neutral-500': '#737373',
  'neutral-600': '#525252',
  'neutral-700': '#404040',
  'neutral-800': '#262626',
  'neutral-900': '#171717',
  'neutral-950': '#0a0a0a',
  'stone-50': '#fafaf9',
  'stone-100': '#f5f5f4',
  'stone-200': '#e7e5e4',
  'stone-300': '#d6d3d1',
  'stone-400': '#a8a29e',
  'stone-500': '#78716c',
  'stone-600': '#57534e',
  'stone-700': '#44403c',
  'stone-800': '#292524',
  'stone-900': '#1c1917',
  'stone-950': '#0c0a09',
  'red-50': '#fef2f2',
  'red-100': '#fee2e2',
  'red-500': '#ef4444',
  'red-600': '#dc2626',
  'red-700': '#b91c1c',
  'red-800': '#991b1b',
  'red-900': '#7f1d1d',
  'orange-500': '#f97316',
  'amber-500': '#f59e0b',
  'yellow-500': '#eab308',
  'green-50': '#f0fdf4',
  'green-500': '#22c55e',
  'green-600': '#16a34a',
  'green-700': '#15803d',
  'emerald-500': '#10b981',
  'teal-500': '#14b8a6',
  'cyan-500': '#06b6d4',
  'sky-500': '#0ea5e9',
  'blue-50': '#eff6ff',
  'blue-100': '#dbeafe',
  'blue-500': '#3b82f6',
  'blue-600': '#2563eb',
  'blue-700': '#1d4ed8',
  'indigo-500': '#6366f1',
  'indigo-600': '#4f46e5',
  'violet-500': '#8b5cf6',
  'purple-500': '#a855f7',
  'fuchsia-500': '#d946ef',
  'pink-500': '#ec4899',
  'rose-500': '#f43f5e',
};

// Static one-shot lookups for class strings whose value never depends
// on a numeric suffix. Hot path — every parse runs through this map
// first before falling into the regex-driven `dynamicLookup` below.
const STATIC = {
  // ─── Display / flex ────────────────────────────────────────────
  flex: {display: 'flex'},
  block: {display: 'flex'},
  inline: {display: 'flex'},
  hidden: {display: 'none'},
  contents: {},
  'flex-1': {flex: 1},
  'flex-auto': {flex: 1, flexBasis: 'auto'},
  'flex-initial': {flex: 0, flexBasis: 'auto'},
  'flex-none': {flexGrow: 0, flexShrink: 0, flexBasis: 'auto'},
  'flex-row': {flexDirection: 'row'},
  'flex-col': {flexDirection: 'column'},
  'flex-row-reverse': {flexDirection: 'row-reverse'},
  'flex-col-reverse': {flexDirection: 'column-reverse'},
  'flex-wrap': {flexWrap: 'wrap'},
  'flex-nowrap': {flexWrap: 'nowrap'},
  'flex-wrap-reverse': {flexWrap: 'wrap-reverse'},
  shrink: {flexShrink: 1},
  'shrink-0': {flexShrink: 0},
  grow: {flexGrow: 1},
  'grow-0': {flexGrow: 0},

  // ─── Alignment ─────────────────────────────────────────────────
  'items-start': {alignItems: 'flex-start'},
  'items-center': {alignItems: 'center'},
  'items-end': {alignItems: 'flex-end'},
  'items-stretch': {alignItems: 'stretch'},
  'items-baseline': {alignItems: 'baseline'},
  'justify-start': {justifyContent: 'flex-start'},
  'justify-center': {justifyContent: 'center'},
  'justify-end': {justifyContent: 'flex-end'},
  'justify-between': {justifyContent: 'space-between'},
  'justify-around': {justifyContent: 'space-around'},
  'justify-evenly': {justifyContent: 'space-evenly'},
  'self-auto': {alignSelf: 'auto'},
  'self-start': {alignSelf: 'flex-start'},
  'self-center': {alignSelf: 'center'},
  'self-end': {alignSelf: 'flex-end'},
  'self-stretch': {alignSelf: 'stretch'},
  'self-baseline': {alignSelf: 'baseline'},

  // ─── Text ──────────────────────────────────────────────────────
  'text-left': {textAlign: 'left'},
  'text-center': {textAlign: 'center'},
  'text-right': {textAlign: 'right'},
  'text-justify': {textAlign: 'justify'},
  'text-xs': {fontSize: 12, lineHeight: 16},
  'text-sm': {fontSize: 14, lineHeight: 20},
  'text-md': {fontSize: 16, lineHeight: 24},
  'text-base': {fontSize: 16, lineHeight: 24},
  'text-lg': {fontSize: 18, lineHeight: 28},
  'text-xl': {fontSize: 20, lineHeight: 28},
  'text-2xl': {fontSize: 24, lineHeight: 32},
  'text-3xl': {fontSize: 30, lineHeight: 36},
  'text-4xl': {fontSize: 36, lineHeight: 40},
  'text-5xl': {fontSize: 48, lineHeight: 48},
  'text-6xl': {fontSize: 60, lineHeight: 60},
  'text-7xl': {fontSize: 72, lineHeight: 72},
  'text-8xl': {fontSize: 96, lineHeight: 96},
  'text-9xl': {fontSize: 128, lineHeight: 128},
  italic: {fontStyle: 'italic'},
  'not-italic': {fontStyle: 'normal'},
  underline: {textDecorationLine: 'underline'},
  'line-through': {textDecorationLine: 'line-through'},
  'no-underline': {textDecorationLine: 'none'},
  uppercase: {textTransform: 'uppercase'},
  lowercase: {textTransform: 'lowercase'},
  capitalize: {textTransform: 'capitalize'},
  'normal-case': {textTransform: 'none'},
  'font-thin': {fontWeight: '100'},
  'font-extralight': {fontWeight: '200'},
  'font-light': {fontWeight: '300'},
  'font-normal': {fontWeight: '400'},
  'font-medium': {fontWeight: '500'},
  'font-semibold': {fontWeight: '600'},
  'font-bold': {fontWeight: '700'},
  'font-extrabold': {fontWeight: '800'},
  'font-black': {fontWeight: '900'},

  // ─── Position ──────────────────────────────────────────────────
  absolute: {position: 'absolute'},
  relative: {position: 'relative'},
  static: {position: 'relative'},

  // ─── Overflow ──────────────────────────────────────────────────
  'overflow-hidden': {overflow: 'hidden'},
  'overflow-visible': {overflow: 'visible'},
  'overflow-scroll': {overflow: 'scroll'},

  // ─── Border ────────────────────────────────────────────────────
  border: {borderWidth: 1},
  'border-0': {borderWidth: 0},
  'border-2': {borderWidth: 2},
  'border-4': {borderWidth: 4},
  'border-8': {borderWidth: 8},
  'border-solid': {borderStyle: 'solid'},
  'border-dashed': {borderStyle: 'dashed'},
  'border-dotted': {borderStyle: 'dotted'},
  rounded: {borderRadius: 4},
  'rounded-none': {borderRadius: 0},
  'rounded-sm': {borderRadius: 2},
  'rounded-md': {borderRadius: 6},
  'rounded-lg': {borderRadius: 8},
  'rounded-xl': {borderRadius: 12},
  'rounded-2xl': {borderRadius: 16},
  'rounded-3xl': {borderRadius: 24},
  'rounded-full': {borderRadius: 9999},

  // ─── Width / height shorthands ─────────────────────────────────
  'w-full': {width: '100%'},
  'h-full': {height: '100%'},
  'w-screen': {width: '100%'},
  'h-screen': {height: '100%'},
  'w-auto': {width: 'auto'},
  'h-auto': {height: 'auto'},
  'min-h-screen': {minHeight: '100%'},
  'min-w-0': {minWidth: 0},

  // ─── Center / margins ──────────────────────────────────────────
  'mx-auto': {marginHorizontal: 'auto'},
  'my-auto': {marginVertical: 'auto'},
  'ml-auto': {marginLeft: 'auto'},
  'mr-auto': {marginRight: 'auto'},
  'mt-auto': {marginTop: 'auto'},
  'mb-auto': {marginBottom: 'auto'},

  // ─── Opacity ───────────────────────────────────────────────────
  'opacity-0': {opacity: 0},
  'opacity-100': {opacity: 1},

  // ─── object-fit (image) ────────────────────────────────────────
  'object-contain': {resizeMode: 'contain'},
  'object-cover': {resizeMode: 'cover'},
  'object-fill': {resizeMode: 'stretch'},
  'object-none': {resizeMode: 'center'},
};

// ────────────────────────────────────────────────────────────────
// Numeric-suffix utilities.

function parseSpacingValue(s) {
  if (s === 'px') return 1;
  if (s === '0') return 0;
  if (s === 'auto') return 'auto';
  if (s === '0.5') return 2;
  if (s === '1.5') return 6;
  if (s === '2.5') return 10;
  if (s === '3.5') return 14;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return n * SPACING_UNIT;
}

function parseDimensionValue(s) {
  if (s === 'full') return '100%';
  if (s === 'screen') return '100%';
  if (s === 'auto') return 'auto';
  if (s === '1/2') return '50%';
  if (s === '1/3') return '33.333%';
  if (s === '2/3') return '66.667%';
  if (s === '1/4') return '25%';
  if (s === '3/4') return '75%';
  if (s === '1/5') return '20%';
  if (s === '2/5') return '40%';
  if (s === '3/5') return '60%';
  if (s === '4/5') return '80%';
  // Arbitrary value: `[100px]`, `[700px]`, `[50vh]`.
  if (s[0] === '[' && s[s.length - 1] === ']') {
    const inner = s.slice(1, -1);
    if (/^\d+(\.\d+)?px$/.test(inner)) return Number(inner.replace('px', ''));
    if (/^\d+(\.\d+)?%$/.test(inner)) return inner;
    return inner;
  }
  return parseSpacingValue(s);
}

const SIDE_LONG = {t: 'Top', r: 'Right', b: 'Bottom', l: 'Left'};

function dynamicLookup(cls) {
  const negative = cls[0] === '-';
  if (negative) cls = cls.slice(1);
  const sign = negative ? -1 : 1;
  let m;

  // p/m + optional side letter + number  (p-4, px-2, mt-1, mx-auto)
  m = cls.match(/^(p|m)([xytrbl]?)-(.+)$/);
  if (m) {
    const v = parseSpacingValue(m[3]);
    if (v === null) return null;
    const value = typeof v === 'number' ? v * sign : v;
    const root = m[1] === 'p' ? 'padding' : 'margin';
    if (m[2] === '') return {[root]: value};
    if (m[2] === 'x') return {[root + 'Horizontal']: value};
    if (m[2] === 'y') return {[root + 'Vertical']: value};
    return {[root + SIDE_LONG[m[2]]]: value};
  }

  // gap
  m = cls.match(/^gap(-[xy])?-(.+)$/);
  if (m) {
    const v = parseSpacingValue(m[2]);
    if (v === null) return null;
    if (m[1] === '-x') return {columnGap: v};
    if (m[1] === '-y') return {rowGap: v};
    return {gap: v};
  }

  // size: w-{n}, h-{n}, min-w-, min-h-, max-w-, max-h-
  m = cls.match(/^(min-w|min-h|max-w|max-h|w|h)-(.+)$/);
  if (m) {
    const v = parseDimensionValue(m[2]);
    if (v === null) return null;
    const propMap = {
      w: 'width',
      h: 'height',
      'min-w': 'minWidth',
      'min-h': 'minHeight',
      'max-w': 'maxWidth',
      'max-h': 'maxHeight',
    };
    return {[propMap[m[1]]]: v};
  }

  // bg-{color}
  m = cls.match(/^bg-(.+)$/);
  if (m) {
    if (COLORS[m[1]]) return {backgroundColor: COLORS[m[1]]};
    // bg-[#hex] arbitrary
    if (m[1][0] === '[' && m[1][m[1].length - 1] === ']') {
      return {backgroundColor: m[1].slice(1, -1)};
    }
  }

  // text-{color} (must come AFTER text-{size} via STATIC)
  m = cls.match(/^text-(.+)$/);
  if (m) {
    if (COLORS[m[1]]) return {color: COLORS[m[1]]};
    if (m[1][0] === '[' && m[1][m[1].length - 1] === ']') {
      return {color: m[1].slice(1, -1)};
    }
  }

  // border-{color} | border-{side}-{n}
  m = cls.match(/^border-([tlbr])-(\d+)$/);
  if (m) {
    return {['border' + SIDE_LONG[m[1]] + 'Width']: Number(m[2])};
  }
  m = cls.match(/^border-(.+)$/);
  if (m) {
    if (COLORS[m[1]]) return {borderColor: COLORS[m[1]]};
    if (m[1][0] === '[' && m[1][m[1].length - 1] === ']') {
      return {borderColor: m[1].slice(1, -1)};
    }
  }

  // opacity
  m = cls.match(/^opacity-(\d+)$/);
  if (m) return {opacity: Number(m[1]) / 100};

  // leading (line-height; tailwind multiplies by 0.25rem)
  m = cls.match(/^leading-(\d+)$/);
  if (m) return {lineHeight: Number(m[1]) * SPACING_UNIT};
  m = cls.match(/^leading-none$/);
  if (m) return {lineHeight: undefined};
  m = cls.match(/^leading-tight$/);
  if (m) return {lineHeight: undefined};

  // Position offsets
  m = cls.match(/^(top|right|bottom|left)-(.+)$/);
  if (m) {
    const v = parseSpacingValue(m[2]);
    if (v === null) return null;
    return {[m[1]]: typeof v === 'number' ? v * sign : v};
  }
  m = cls.match(/^inset-(.+)$/);
  if (m) {
    const v = parseSpacingValue(m[1]);
    if (v === null) return null;
    const value = typeof v === 'number' ? v * sign : v;
    return {top: value, right: value, bottom: value, left: value};
  }

  // z-index
  m = cls.match(/^z-(\d+)$/);
  if (m) return {zIndex: Number(m[1])};

  // Border radius numeric variants
  m = cls.match(/^rounded-(t|r|b|l|tl|tr|bl|br)$/);
  if (m) {
    const side = m[1];
    if (side === 't') return {borderTopLeftRadius: 4, borderTopRightRadius: 4};
    if (side === 'b') return {borderBottomLeftRadius: 4, borderBottomRightRadius: 4};
    if (side === 'l') return {borderTopLeftRadius: 4, borderBottomLeftRadius: 4};
    if (side === 'r') return {borderTopRightRadius: 4, borderBottomRightRadius: 4};
    const cornerMap = {
      tl: 'borderTopLeftRadius',
      tr: 'borderTopRightRadius',
      bl: 'borderBottomLeftRadius',
      br: 'borderBottomRightRadius',
    };
    return {[cornerMap[side]]: 4};
  }

  return null;
}

// Convert one class token (e.g. `flex-row`, `px-4`, `lg:bg-gray-100`)
// into a partial RN style object. Variant prefixes (`lg:`, `sm:`,
// `dark:`, `hover:`, `web:`, `native:`) are stripped — RN has no
// portable media-query / dark-mode pipeline at the runtime layer, so
// we treat the unprefixed class as the static value. `native:foo`
// applies (we ARE native); `web:foo` is dropped (we are NOT web).
function classToStyle(cls) {
  // Drop web-only prefixed classes entirely.
  if (cls.startsWith('web:')) return null;
  // Strip every other variant prefix; chained variants OK.
  while (true) {
    const colon = cls.indexOf(':');
    if (colon === -1) break;
    cls = cls.slice(colon + 1);
  }
  if (STATIC.hasOwnProperty(cls)) return STATIC[cls];
  return dynamicLookup(cls);
}

function parseClassNames(s) {
  if (typeof s !== 'string') return null;
  const out = {};
  let any = false;
  for (const cls of s.split(/\s+/)) {
    if (!cls) continue;
    const style = classToStyle(cls);
    if (style) {
      any = true;
      Object.assign(out, style);
    }
  }
  return any ? out : null;
}

// ────────────────────────────────────────────────────────────────
// React-facing API

function useCssElement(Component, props, mapping) {
  // mapping is `{className: "style"}` or
  // `{className: "style", contentContainerClassName: "contentContainerStyle"}`
  // We strip each className-style prop, parse its value, merge into the
  // declared target style prop (preserving any inline-style override).
  const newProps = {};
  for (const key in props) {
    if (mapping && mapping.hasOwnProperty(key)) continue;
    newProps[key] = props[key];
  }
  for (const cnKey in mapping) {
    const styleKey = mapping[cnKey];
    const cn = props[cnKey];
    if (!cn) continue;
    const parsed = parseClassNames(cn);
    if (!parsed) continue;
    const existing = newProps[styleKey];
    if (existing) {
      newProps[styleKey] = Array.isArray(existing) ? [parsed, ...existing] : [parsed, existing];
    } else {
      newProps[styleKey] = parsed;
    }
  }
  return React.createElement(Component, newProps);
}

function styled(Component, mapping) {
  const m = mapping || {className: 'style'};
  function Styled(props) {
    return useCssElement(Component, props, m);
  }
  return Styled;
}

function useNativeVariable(_name) {
  // No CSS-var runtime — return undefined; consumers fall back to
  // their default arg.
  return undefined;
}

const colorScheme = {
  current: 'light',
  set() {},
  get() {
    return 'light';
  },
};

function vars(_variables) {
  // CSS variables aren't tracked at runtime here. Return an empty
  // style object so `style={vars({...})}` is harmless.
  return {};
}

function VariableContextProvider(props) {
  return React.createElement(React.Fragment, null, props && props.children);
}

const StyleCollection = {
  // Metro-side style registry. The bundler-time pipeline writes
  // into this; we no-op since we generate styles inline.
  push() {},
  reset() {},
};

const api = {
  useCssElement,
  useNativeVariable,
  useUnstableNativeVariable: useNativeVariable,
  styled,
  colorScheme,
  vars,
  VariableContextProvider,
  StyleCollection,
};

module.exports = api;
module.exports.default = api;
