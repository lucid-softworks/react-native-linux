'use strict';

// react-native-svg shim — render SVG primitives as labeled View
// placeholders. Real impl uses a custom Fabric component backed by
// libsvg / Cairo; for smoke we just want the imports to resolve and
// the tree to mount.

const React = require('react');
const {View} = require('react-native');

function makeShape(name) {
  return function Shape(props) {
    return React.createElement(View, {
      style: props.style || {width: props.width || 0, height: props.height || 0},
    });
  };
}

const Svg = makeShape('Svg');
const Circle = makeShape('Circle');
const Rect = makeShape('Rect');
const Path = makeShape('Path');
const Line = makeShape('Line');
const Polyline = makeShape('Polyline');
const Polygon = makeShape('Polygon');
const Ellipse = makeShape('Ellipse');
const G = makeShape('G');
const Text = makeShape('Text');
const TSpan = makeShape('TSpan');
const TextPath = makeShape('TextPath');
const Defs = makeShape('Defs');
const Use = makeShape('Use');
const Symbol = makeShape('Symbol');
const ClipPath = makeShape('ClipPath');
const LinearGradient = makeShape('LinearGradient');
const RadialGradient = makeShape('RadialGradient');
const Stop = makeShape('Stop');
const Mask = makeShape('Mask');
const Pattern = makeShape('Pattern');
const Image = makeShape('Image');
const ForeignObject = makeShape('ForeignObject');

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.default = Svg;
module.exports.Svg = Svg;
module.exports.Circle = Circle;
module.exports.Rect = Rect;
module.exports.Path = Path;
module.exports.Line = Line;
module.exports.Polyline = Polyline;
module.exports.Polygon = Polygon;
module.exports.Ellipse = Ellipse;
module.exports.G = G;
module.exports.Text = Text;
module.exports.TSpan = TSpan;
module.exports.TextPath = TextPath;
module.exports.Defs = Defs;
module.exports.Use = Use;
module.exports.Symbol = Symbol;
module.exports.ClipPath = ClipPath;
module.exports.LinearGradient = LinearGradient;
module.exports.RadialGradient = RadialGradient;
module.exports.Stop = Stop;
module.exports.Mask = Mask;
module.exports.Pattern = Pattern;
module.exports.Image = Image;
module.exports.ForeignObject = ForeignObject;
