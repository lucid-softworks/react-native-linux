'use strict';

// Combined stub for the 3D / GPU stack: expo-gl + expo-three +
// expo-processing + three. All return tiny placeholder objects /
// constructors so apps that import them at module-eval time mount
// without crashing. Actual 3D scenes won't render — the GLView
// stays blank, since we don't ship a GL backend on Linux yet.

const React = require('react');
const {View} = require('react-native');

function GLView(props) {
  return React.createElement(View, {
    style: [{backgroundColor: '#0c0a09'}, props.style],
  });
}
GLView.takeSnapshotAsync = () => Promise.resolve(null);
GLView.createContextAsync = () => Promise.resolve(makeGLContext());

function makeGLContext() {
  // Looks like a minimal WebGL context — enough for libraries to
  // poke at without throwing at the first lookup.
  return {
    drawingBufferWidth: 0,
    drawingBufferHeight: 0,
    endFrameEXP: () => {},
    flush: () => {},
    getParameter: () => null,
    getExtension: () => null,
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    enable: () => {},
    disable: () => {},
    viewport: () => {},
    clearColor: () => {},
    clear: () => {},
  };
}

const expoGl = {GLView, createContextAsync: GLView.createContextAsync};

// expo-three: glue between expo-gl and three.js. We expose its
// `Renderer` constructor + the `THREE` re-export.
function noopCtor() {}
const THREE = {
  Scene: noopCtor,
  PerspectiveCamera: noopCtor,
  OrthographicCamera: noopCtor,
  WebGLRenderer: noopCtor,
  BoxGeometry: noopCtor,
  SphereGeometry: noopCtor,
  PlaneGeometry: noopCtor,
  CircleGeometry: noopCtor,
  CylinderGeometry: noopCtor,
  TorusGeometry: noopCtor,
  ConeGeometry: noopCtor,
  Mesh: noopCtor,
  Group: noopCtor,
  Object3D: noopCtor,
  Vector2: function (x, y) {
    this.x = x || 0;
    this.y = y || 0;
  },
  Vector3: function (x, y, z) {
    this.x = x || 0;
    this.y = y || 0;
    this.z = z || 0;
  },
  Color: function () {},
  MeshBasicMaterial: noopCtor,
  MeshStandardMaterial: noopCtor,
  MeshPhongMaterial: noopCtor,
  PointLight: noopCtor,
  DirectionalLight: noopCtor,
  AmbientLight: noopCtor,
  TextureLoader: function () {
    return {load: () => null, loadAsync: () => Promise.resolve(null)};
  },
  Clock: function () {
    return {getDelta: () => 0, getElapsedTime: () => 0};
  },
  REVISION: '0',
};

const expoThree = {
  Renderer: function () {
    return {render: () => {}, setSize: () => {}, dispose: () => {}};
  },
  loadAsync: () => Promise.resolve(null),
  loadTextureAsync: () => Promise.resolve(null),
  TextureLoader: THREE.TextureLoader,
  THREE,
};

// expo-processing: based on top of expo-gl + processing.js. We
// expose a single placeholder Sketch component.
function Sketch(props) {
  return React.createElement(View, {style: [{backgroundColor: '#0c0a09'}, props.style]});
}

function stamp(o) {
  Object.defineProperty(o, '__esModule', {value: true});
  return o;
}

module.exports = {
  expoGl: stamp(expoGl),
  expoThree: stamp(expoThree),
  expoProcessing: stamp({default: Sketch, Sketch, ProcessingView: Sketch}),
  three: stamp(Object.assign({default: THREE}, THREE)),
};
