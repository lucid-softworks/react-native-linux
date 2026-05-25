'use strict';

// Shim for `expo-symbols`. The real module renders SF Symbols on iOS
// (and a fallback raster on Android). GTK doesn't ship SF Symbols, so
// we render the symbol's name as text — visually obvious as a
// placeholder but doesn't break layout. Apps that care can pass a
// `fallback` prop and we'll honour it.
//
// Usage in the wild:
//   <SymbolView name={{ios: 'chevron.right', android: 'arrow', web: 'arrow'}} />
//   <SymbolView name="chevron.right" />
//   <SymbolView name="x" size={28} tintColor="red" />

const React = require('react');
const {Text} = require('./components');

// Some common SF Symbols → a unicode glyph that reads similarly. Way
// shorter than the real catalog; falls back to the symbol name for
// anything we don't have.
const GLYPH = {
  'chevron.left': '‹',
  'chevron.right': '›',
  'chevron.up': '˄',
  'chevron.down': '˅',
  'chevron.left.forwardslash.chevron.right': '⟨/⟩',
  'arrow.left': '←',
  'arrow.right': '→',
  'arrow.up': '↑',
  'arrow.down': '↓',
  house: '⌂',
  'house.fill': '⌂',
  gear: '⚙',
  gearshape: '⚙',
  'gearshape.fill': '⚙',
  magnifyingglass: '⌕',
  plus: '+',
  minus: '−',
  xmark: '✕',
  checkmark: '✓',
  star: '☆',
  'star.fill': '★',
  heart: '♡',
  'heart.fill': '♥',
  'info.circle': 'ⓘ',
  info: 'ⓘ',
  'questionmark.circle': '?',
  person: '◐',
  'person.fill': '◑',
  envelope: '✉',
  bell: '🔔',
  paperplane: '➤',
  'paperplane.fill': '➤',
  code: '⟨/⟩',
  arrow: '→',
  doc: '📄',
};

function resolveGlyph(nameProp) {
  if (typeof nameProp === 'string') {
    return GLYPH[nameProp] ?? nameProp;
  }
  if (nameProp && typeof nameProp === 'object') {
    // Per-platform name object: {ios, android, web}. Pick whichever
    // matches our Platform.OS, or fall back through the list.
    const key = nameProp.ios ?? nameProp.android ?? nameProp.web;
    return key ? (GLYPH[key] ?? key) : '◻';
  }
  return '◻';
}

function SymbolView(props) {
  const {name, size = 24, tintColor, fallback, style} = props;
  if (fallback) {
    return React.createElement(React.Fragment, null, fallback);
  }
  const glyph = resolveGlyph(name);
  const inlineStyle = {fontSize: size, color: tintColor, lineHeight: size};
  return React.createElement(Text, {style: [inlineStyle, style]}, glyph);
}

module.exports = {
  SymbolView,
  // Some apps also import SFSymbol/SymbolEffect. Stub out so imports
  // don't crash; real behavior is platform-specific anyway.
  SFSymbol: SymbolView,
  SymbolEffect: {},
};
