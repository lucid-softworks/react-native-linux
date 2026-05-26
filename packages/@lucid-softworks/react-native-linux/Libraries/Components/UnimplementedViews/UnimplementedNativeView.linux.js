'use strict';

// Renders a visible placeholder for components that aren't ported to Linux
// yet. Mirrors react-native/Libraries/Components/UnimplementedViews/
// UnimplementedView.js, but with a Linux-flavored hint so app developers
// know which path to follow when they hit one.

const React = require('react');
const View = require('react-native/Libraries/Components/View/View').default;
const Text = require('react-native/Libraries/Text/Text').default;
const StyleSheet = require('react-native/Libraries/StyleSheet/StyleSheet').default;

const styles = StyleSheet.create({
  unimplementedView: {
    alignSelf: 'flex-start',
    borderColor: '#cc4444',
    borderWidth: 1,
    padding: 8,
    backgroundColor: '#ffe5e5',
  },
  text: {
    color: '#cc0000',
    fontSize: 12,
  },
});

function UnimplementedNativeView(props) {
  const name = props.name || 'this component';
  return React.createElement(
    View,
    {style: [styles.unimplementedView, props.style]},
    React.createElement(
      Text,
      {style: styles.text},
      `${name} is not yet implemented on Linux.\nSee docs/component-support.md.`,
    ),
  );
}

module.exports = UnimplementedNativeView;
module.exports.default = UnimplementedNativeView;
