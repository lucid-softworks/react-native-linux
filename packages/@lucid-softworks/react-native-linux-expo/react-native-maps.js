'use strict';

const {makePlaceholder} = require('./placeholder-components');

const MapView = makePlaceholder('MapView (react-native-maps)', '#dbeafe');
const Marker = makePlaceholder('Marker');
const Polygon = makePlaceholder('Polygon');
const Polyline = makePlaceholder('Polyline');
const Circle = makePlaceholder('Circle');
const Callout = makePlaceholder('Callout');
const Overlay = makePlaceholder('Overlay');
const Heatmap = makePlaceholder('Heatmap');

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.default = MapView;
module.exports.MapView = MapView;
module.exports.Marker = Marker;
module.exports.Polygon = Polygon;
module.exports.Polyline = Polyline;
module.exports.Circle = Circle;
module.exports.Callout = Callout;
module.exports.Overlay = Overlay;
module.exports.Heatmap = Heatmap;
module.exports.PROVIDER_DEFAULT = 'default';
module.exports.PROVIDER_GOOGLE = 'google';
