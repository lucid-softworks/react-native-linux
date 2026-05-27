'use strict';

// Shim for `expo-symbols`. The real module renders SF Symbols on iOS
// (and a fallback raster on Android). GTK doesn't ship SF Symbols, so
// we render the symbol's name as text — visually obvious as a
// placeholder but doesn't break layout. Apps that care can pass a
// `fallback` prop and we'll honour it.

const React = require('react');
const {Text} = require('react-native');

// Each entry maps an SF Symbol name to a single Unicode glyph. Keep
// entries to ONE character — the wrapping <View> sizes itself to a
// `size × size` square, so anything wider (raw "message.fill" text,
// multi-char ascii substitutes) overflows and breaks the surrounding
// layout. Bias toward Unicode geometric / box-drawing / emoji glyphs
// that fit a single-character cell at the wrapper's font size.
const GLYPH = {
  'chevron.left': '‹',
  'chevron.right': '›',
  'chevron.up': '˄',
  'chevron.down': '˅',
  'arrow.left': '←',
  'arrow.right': '→',
  'arrow.up': '↑',
  'arrow.down': '↓',
  'arrow.2.squarepath': '↻',
  'arrow.triangle.2.circlepath': '↻',
  'arrow.up.circle.fill': '↑',
  'arrow.up.right.square': '↗',
  'arrowshape.turn.up.left': '↩',
  house: '⌂',
  'house.fill': '⌂',
  gear: '⚙',
  gearshape: '⚙',
  'gearshape.fill': '⚙',
  magnifyingglass: '⌕',
  plus: '+',
  'plus.circle': '⊕',
  'plus.circle.fill': '⊕',
  minus: '−',
  'minus.circle': '⊖',
  'minus.circle.fill': '⊖',
  'text.badge.minus': '−',
  xmark: '✕',
  'xmark.circle.fill': '⊗',
  checkmark: '✓',
  'checkmark.circle.fill': '✓',
  'checkmark.seal': '✓',
  'checkmark.seal.fill': '✓',
  star: '☆',
  'star.fill': '★',
  heart: '♡',
  'heart.fill': '♥',
  'heart.circle.fill': '♥',
  'info.circle': 'ⓘ',
  'info.circle.fill': 'ⓘ',
  info: 'ⓘ',
  'questionmark.circle': '?',
  person: '◐',
  'person.fill': '◑',
  'person.2.fill': '◑',
  'person.crop.circle': '◑',
  'person.crop.circle.badge.checkmark': '◑',
  'person.crop.circle.badge.xmark': '◑',
  'person.badge.plus': '◑',
  envelope: '✉',
  'envelope.fill': '✉',
  bell: '🔔',
  'bell.fill': '🔔',
  'bell.badge': '🔔',
  'bell.badge.fill': '🔔',
  'bell.slash': '🔔',
  paperplane: '➤',
  'paperplane.fill': '➤',
  bookmark: '🔖',
  'bookmark.fill': '🔖',
  message: '💬',
  'message.fill': '💬',
  'bubble.left': '💬',
  'text.bubble': '💬',
  'text.bubble.fill': '💬',
  'bubble.left.and.bubble.right': '💬',
  'quote.bubble': '“',
  'quote.bubble.fill': '“',
  'shield.fill': '🛡',
  shield: '🛡',
  'lock.fill': '🔒',
  'lock.shield.fill': '🔒',
  'key.fill': '🔑',
  'eye.fill': '👁',
  'eye.slash': '👁',
  'eye.slash.fill': '👁',
  'speaker.slash': '🔇',
  'speaker.slash.fill': '🔇',
  pin: '📌',
  'pin.fill': '📌',
  'pin.slash': '📌',
  ellipsis: '⋯',
  'ellipsis.circle.fill': '⋯',
  trash: '🗑',
  'trash.fill': '🗑',
  pencil: '✎',
  'square.and.pencil': '✎',
  'square.and.arrow.up': '↗',
  'square.grid.2x2': '⊞',
  link: '🔗',
  globe: '🌐',
  'server.rack': '🖥',
  'brain.head.profile': '🧠',
  'hammer.fill': '⚖',
  'waveform.path': '〰',
  'paintbrush.fill': '🖌',
  'paintpalette.fill': '🎨',
  'figure.stand': '♿',
  'figure.wave.circle': '♿',
  'hand.raised.fill': '✋',
  'hand.thumbsup': '👍',
  'hand.thumbsdown': '👎',
  flame: '🔥',
  'fork.knife': '🍴',
  'face.smiling': '☺',
  calendar: '📅',
  clock: '🕒',
  'clock.fill': '🕒',
  speedometer: '⏱',
  'rectangle.stack.fill': '⊟',
  'rectangle.connected.to.line.below': '⊟',
  'play.fill': '▶',
  'play.circle.fill': '▶',
  'doc.text': '📄',
  'doc.text.fill': '📄',
  'doc.on.doc': '📋',
  doc: '📄',
  'list.bullet': '☰',
  'line.3.horizontal.decrease.circle': '☰',
  at: '@',
  tag: '⊕',
  cpu: '▦',
  camera: '📷',
  photo: '🖼',
  'photo.on.rectangle': '🖼',
  'photo.on.rectangle.angled': '🖼',
  video: '📹',
  sparkles: '✨',
  gif: '🎞',
  circle: '○',
  'circle.lefthalf.filled': '◐',
  'moon.zzz.fill': '☾',
  'character.book.closed': '📖',
  'exclamationmark.triangle': '⚠',
  'exclamationmark.triangle.fill': '⚠',
  'textformat.size': 'A',
  'textformat.size.larger': 'A',
  'number.circle': '#',
  'number.circle.fill': '#',
  // The literal SF Symbol name reads `chevron.left.forwardslash.chevron.right`
  // — too wide as text. Pick the single-char "⟨" so the wrapper square
  // still gets a glyph it can centre without horizontal overflow.
  'chevron.left.forwardslash.chevron.right': '⟨',
  arrow: '→',
  code: '⟨',
};

// Generic placeholder used when the requested SF Symbol isn't in our
// map. Square-box outline — single character so it stays inside the
// `size × size` wrapper instead of overflowing as the raw symbol name
// would. Falling back to the raw name (the previous behaviour) blew the
// surrounding flex layout apart whenever akari rendered a not-yet-mapped
// icon — the name "message.fill" at fontSize 20 is ~80px wide, while
// the wrapper is only 20×20.
const UNKNOWN_GLYPH = '□';

function resolveGlyph(nameProp) {
  if (typeof nameProp === 'string') {
    return GLYPH[nameProp] ?? UNKNOWN_GLYPH;
  }
  if (nameProp && typeof nameProp === 'object') {
    const key = nameProp.ios ?? nameProp.android ?? nameProp.web;
    return key ? (GLYPH[key] ?? UNKNOWN_GLYPH) : UNKNOWN_GLYPH;
  }
  return UNKNOWN_GLYPH;
}

// Walk a (possibly nested) style array and grab the first numeric
// width — RN's flatten is in vendor, but inlining the walk avoids the
// require/cycle. The real expo-symbols / SF Symbols sizes the glyph
// from the `style.width` (which Apple's SymbolView treats as the
// symbol's box size); akari's IconSymbol.ios.tsx wraps the call with
// `style={[{ width: size, height: size }, style]}` and never passes
// `size` to SymbolView directly, so reading the prop would always
// fall back to 24 and oversize icons against their wrapper.
function pickStyleSize(style, fallback) {
  if (!style) return fallback;
  if (Array.isArray(style)) {
    for (let i = 0; i < style.length; i++) {
      const v = pickStyleSize(style[i], undefined);
      if (typeof v === 'number') return v;
    }
    return fallback;
  }
  if (typeof style.width === 'number') return style.width;
  return fallback;
}

function SymbolView(props) {
  const {name, size, tintColor, fallback, style} = props;
  if (fallback) {
    return React.createElement(React.Fragment, null, fallback);
  }
  // size prop wins, then style.width, then 24.
  const resolvedSize = typeof size === 'number' ? size : pickStyleSize(style, 24);
  const glyph = resolveGlyph(name);
  const inlineStyle = {
    fontSize: resolvedSize,
    color: tintColor,
    lineHeight: resolvedSize,
    textAlign: 'center',
  };
  return React.createElement(Text, {style: [inlineStyle, style]}, glyph);
}

module.exports = {
  SymbolView,
  SFSymbol: SymbolView,
  SymbolEffect: {},
};
