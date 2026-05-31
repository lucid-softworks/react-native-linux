'use strict';

// @react-native-picker/picker shim. Renders a placeholder labeled
// "Picker" — real impl uses native pickers we don't have on Linux
// yet. Selected value comes through unchanged so callers that
// observe selectedValue see the prop.

const React = require('react');
const {View, Text} = require('react-native');

function Picker(props) {
  return React.createElement(
    View,
    {style: [{padding: 12, backgroundColor: '#f1f5f9', borderRadius: 6}, props.style]},
    React.createElement(
      Text,
      {style: {color: '#475569'}},
      'Picker (selected: ' +
        (props.selectedValue == null ? 'none' : String(props.selectedValue)) +
        ')',
    ),
  );
}

function PickerItem(_props) {
  // Items are declaration-only; Picker doesn't render them.
  return null;
}
Picker.Item = PickerItem;

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.Picker = Picker;
module.exports.default = Picker;
