'use strict';

// `@expo/vector-icons` ships ~20 icon-font sub-modules
// (FontAwesome, MaterialIcons, Ionicons, Feather, …) each of which
// is imported individually:
//
//   import FontAwesome from '@expo/vector-icons/FontAwesome';
//   <FontAwesome name="user" size={24} color="#000" />
//
// Real implementation: each font module renders a <Text> with the
// font family set to its icon font and the character that matches
// `name`. We don't ship the .ttf files on desktop yet, so the shim
// renders a placeholder Text that preserves layout (size+color)
// without the glyph. Apps that depend on icon LAYOUT for spacing
// keep their flex math; the visual is just a square.
//
// Same factory powers every sub-path — bundle.mjs banner routes
// `@expo/vector-icons/<Font>` to this single export, which uses a
// Proxy so any access like `vectorIcons.FontAwesome` returns the
// shared component.

const React = require('react');
const {Text} = require('react-native');

function makeIcon(fontName) {
  return function IconPlaceholder(props) {
    const size = props.size != null ? props.size : 16;
    return React.createElement(
      Text,
      {
        style: [
          {
            width: size,
            height: size,
            fontSize: size,
            lineHeight: size,
            color: props.color || '#94a3b8',
            textAlign: 'center',
          },
          props.style,
        ],
      },
      // U+25A1 WHITE SQUARE — universal "missing glyph" tofu, works
      // even when the actual icon font isn't loaded.
      String.fromCharCode(0x25a1),
    );
  };
}

// Exporting both `default` (for `import FontAwesome from '...'`) and
// the named binding. Real Expo's per-font module ships
// `module.exports = IconComponent` (it IS the default export), so
// `default` is the canonical access path.
function buildModuleForFont(name) {
  const icon = makeIcon(name);
  icon.default = icon;
  icon.Button = function IconButton(props) {
    return React.createElement(icon, props, props.children);
  };
  return icon;
}

// The same module gets used for every sub-path by name — the bundle
// banner passes the requested font name through so the placeholder
// can stamp it as a debug aid (and Button-component variants share
// the per-font surface).
module.exports = {
  forFont: buildModuleForFont,
  // Index shim for `import { FontAwesome } from '@expo/vector-icons'`.
  FontAwesome: buildModuleForFont('FontAwesome'),
  FontAwesome5: buildModuleForFont('FontAwesome5'),
  FontAwesome6: buildModuleForFont('FontAwesome6'),
  MaterialIcons: buildModuleForFont('MaterialIcons'),
  MaterialCommunityIcons: buildModuleForFont('MaterialCommunityIcons'),
  Ionicons: buildModuleForFont('Ionicons'),
  Feather: buildModuleForFont('Feather'),
  AntDesign: buildModuleForFont('AntDesign'),
  Entypo: buildModuleForFont('Entypo'),
  EvilIcons: buildModuleForFont('EvilIcons'),
  Foundation: buildModuleForFont('Foundation'),
  Octicons: buildModuleForFont('Octicons'),
  SimpleLineIcons: buildModuleForFont('SimpleLineIcons'),
  Zocial: buildModuleForFont('Zocial'),
  Fontisto: buildModuleForFont('Fontisto'),
  default: undefined,
};
