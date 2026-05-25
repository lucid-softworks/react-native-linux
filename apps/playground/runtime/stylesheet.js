'use strict';

// React-Native-shaped StyleSheet helper. Apps write:
//
//   const styles = StyleSheet.create({
//     card: {padding: 16, backgroundColor: '#fff', borderRadius: 12},
//   });
//
//   <View style={styles.card} />
//   <View style={[styles.card, isActive && styles.active]} />
//
// On real RN, `create` validates the styles and may freeze them or
// assign numeric IDs; we just pass through. `flatten` walks a
// (possibly nested, possibly conditional) array into one merged
// object — same precedence the Fabric host config uses internally.
//
// Returning the original object reference from `create` lets users
// rely on referential equality across renders (good for ===
// memoization).

function flattenInto(out, style) {
  if (style == null || style === false) return;
  if (Array.isArray(style)) {
    for (const s of style) flattenInto(out, s);
    return;
  }
  if (typeof style !== 'object') return;
  for (const k in style) out[k] = style[k];
}

function flatten(style) {
  const out = {};
  flattenInto(out, style);
  return out;
}

function compose(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return [a, b];
}

function create(styles) {
  // No-op at runtime — the value-add is the TypeScript inference on
  // the consumer side. We could freeze() each value to enforce
  // immutability but RN doesn't bother either.
  return styles;
}

// `hairlineWidth` is the smallest visible line on the display.
// On RN this maps to 1 device pixel; for us 1 logical pixel is
// close enough until we wire scale-aware constants.
const hairlineWidth = 1;
const absoluteFill = Object.freeze({
  position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
});
const absoluteFillObject = absoluteFill;

module.exports = {create, flatten, compose, hairlineWidth,
                  absoluteFill, absoluteFillObject};
