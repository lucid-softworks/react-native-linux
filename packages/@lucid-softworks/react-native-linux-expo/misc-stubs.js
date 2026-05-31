'use strict';

// Catch-all for small one-example stubs. Each section is a separate
// export the bundle banner routes by id. The pattern: just enough
// surface to satisfy the import + boot path so the smoke gate sees
// "JSX commit done" — actual functionality stays out of scope.

const React = require('react');
const {View} = require('react-native');

// ─── @magic-sdk/react-native ─────────────────────────────────────────
function Magic(_apiKey, _opts) {
  this.user = {
    isLoggedIn: () => Promise.resolve(false),
    getInfo: () => Promise.resolve(null),
    getIdToken: () => Promise.resolve(null),
  };
  this.auth = {
    loginWithEmailOTP: () => Promise.resolve(null),
    loginWithSMS: () => Promise.resolve(null),
    logout: () => Promise.resolve(),
  };
  this.Relayer = () => null;
  this.rpcProvider = {request: () => Promise.reject(new Error('magic-sdk not available on Linux'))};
}

const magicSdk = {Magic, default: Magic};

// ─── @react-three/fiber ─────────────────────────────────────────────
function Canvas(props) {
  return React.createElement(View, {style: props.style || {flex: 1, backgroundColor: '#0c0a09'}});
}
function useFrame(_cb) {}
function useThree() {
  return {
    camera: {position: {x: 0, y: 0, z: 0}, lookAt: () => {}},
    scene: {},
    gl: {},
    size: {width: 0, height: 0},
    viewport: {width: 0, height: 0, factor: 1},
  };
}
function useLoader() {
  return null;
}
const reactThreeFiber = {Canvas, useFrame, useThree, useLoader, default: Canvas};

// ─── react-native-get-random-values ──────────────────────────────────
// Polyfills globalThis.crypto.getRandomValues. We already polyfill
// that in shims.js, so importing this is a no-op side effect.
const reactNativeGetRandomValues = {};

// ─── @supabase/supabase-js ──────────────────────────────────────────
function createClient(_url, _key, _opts) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({data: [], error: null}),
        single: () => Promise.resolve({data: null, error: null}),
        order: () => Promise.resolve({data: [], error: null}),
      }),
      insert: () => Promise.resolve({data: null, error: null}),
      update: () => ({eq: () => Promise.resolve({data: null, error: null})}),
      delete: () => ({eq: () => Promise.resolve({data: null, error: null})}),
      upsert: () => Promise.resolve({data: null, error: null}),
    }),
    auth: {
      getUser: () => Promise.resolve({data: {user: null}, error: null}),
      getSession: () => Promise.resolve({data: {session: null}, error: null}),
      signIn: () => Promise.resolve({data: null, error: null}),
      signInWithPassword: () => Promise.resolve({data: null, error: null}),
      signUp: () => Promise.resolve({data: null, error: null}),
      signOut: () => Promise.resolve({error: null}),
      onAuthStateChange: () => ({data: {subscription: {unsubscribe: () => {}}}}),
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({data: null, error: null}),
        download: () => Promise.resolve({data: null, error: null}),
        getPublicUrl: () => ({data: {publicUrl: ''}}),
      }),
    },
    realtime: {
      channel: () => ({
        on: () => ({subscribe: () => {}}),
        unsubscribe: () => Promise.resolve(),
      }),
    },
  };
}
const supabase = {createClient, default: {createClient}};

// ─── @aws-amplify/* family ──────────────────────────────────────────
const Amplify = {configure: () => {}, getConfig: () => ({})};
const ampAuth = {
  getCurrentUser: () => Promise.reject(new Error('aws-amplify not available on Linux')),
  signIn: () => Promise.reject(new Error('aws-amplify not available on Linux')),
  signOut: () => Promise.resolve(),
  signUp: () => Promise.reject(new Error('aws-amplify not available on Linux')),
  fetchAuthSession: () => Promise.resolve({tokens: null, credentials: null}),
};
const ampCore = {Amplify, default: Amplify, Hub: {listen: () => () => {}, dispatch: () => {}}};
const ampStorage = {
  uploadData: () => ({result: Promise.reject(new Error('aws-amplify storage not available'))}),
  downloadData: () => ({result: Promise.reject(new Error('aws-amplify storage not available'))}),
  getUrl: () => Promise.resolve({url: ''}),
  list: () => Promise.resolve({items: []}),
  remove: () => Promise.resolve(),
};

// ─── @tensorflow/tfjs + react-native variants ───────────────────────
const tfTensor = function () {};
const tfjs = {
  ready: () => Promise.resolve(),
  loadLayersModel: () => Promise.reject(new Error('tfjs not available on Linux')),
  loadGraphModel: () => Promise.reject(new Error('tfjs not available on Linux')),
  tensor: function () {
    return new tfTensor();
  },
  scalar: function () {
    return new tfTensor();
  },
  setBackend: () => Promise.resolve(),
  getBackend: () => 'cpu',
  Tensor: tfTensor,
};
const tfjsReactNative = {
  bundleResourceIO: () => null,
  cameraWithTensors: () => null,
  decodeJpeg: () => null,
  fetch: globalThis.fetch || (() => Promise.reject(new Error('fetch not available'))),
};
const mobilenet = {
  load: () => Promise.reject(new Error('mobilenet not available on Linux')),
};

function stamp(o) {
  Object.defineProperty(o, '__esModule', {value: true});
  return o;
}

module.exports = {
  magicSdk: stamp(magicSdk),
  reactThreeFiber: stamp(reactThreeFiber),
  reactNativeGetRandomValues: stamp(reactNativeGetRandomValues),
  supabase: stamp(supabase),
  amplify: stamp({Amplify, default: Amplify}),
  ampAuth: stamp(ampAuth),
  ampCore: stamp(ampCore),
  ampStorage: stamp(ampStorage),
  tfjs: stamp(tfjs),
  tfjsReactNative: stamp(tfjsReactNative),
  mobilenet: stamp(mobilenet),
};
