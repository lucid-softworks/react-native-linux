'use strict';

// Platform-specific override — Metro picks this up over react-native's
// Libraries/Text/Text.js on Linux. The JS surface is unchanged: app code
// imports {Text} from 'react-native' and gets RN's stock implementation
// driven by our ParagraphComponentView on the native side.

const Text = require('react-native/Libraries/Text/Text').default;

module.exports = Text;
module.exports.default = Text;
