'use strict';

// Shared "placeholder component" library for native modules we don't
// have on Linux yet. Each exported factory returns a React component
// that renders a labeled View at the requested size so layout math
// survives the import. Real implementations would back these via
// GTK4 widgets (WebKit2 for WebView, libpoppler for pdf, libchamplain
// for maps, …) — meaningful work each, but for smoke coverage the
// placeholder is enough.

const React = require('react');
const {View, Text} = require('react-native');

function makePlaceholder(name, defaultBg) {
  return function Placeholder(props) {
    const {style, children} = props;
    return React.createElement(
      View,
      {
        style: [
          {
            backgroundColor: defaultBg || '#e2e8f0',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          },
          style,
        ],
      },
      React.createElement(Text, {style: {color: '#64748b', fontSize: 12}}, name + ' placeholder'),
      children,
    );
  };
}

module.exports = {makePlaceholder};
