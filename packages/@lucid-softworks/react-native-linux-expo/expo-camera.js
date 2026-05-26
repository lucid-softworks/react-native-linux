'use strict';

// Shim for `expo-camera`. Two surfaces:
//   * `CameraView` — Fabric host component (`camera` host type)
//     backed by a GtkPicture + GStreamer appsink pipeline. See
//     vnext/src/views/CameraComponentView.cpp.
//   * imperative API (`takePictureAsync`, permission requests, etc.)
//     wraps `rnLinux.cameraSnap` / `rnLinux.cameraHasDevice`. The
//     snap pipeline runs separately from the live preview so calls
//     don't disturb mounted CameraViews.
//
// Source resolution happens in C++: `v4l2src device=/dev/video0` if
// one exists, `videotestsrc pattern=ball` otherwise. Dev VMs see the
// test pattern; the API surface is identical.

const React = require('react');

const _hasNative = typeof rnLinux !== 'undefined' && typeof rnLinux.cameraSnap === 'function';

// Standard expo-camera enums. Numeric values match upstream for
// `switch (Camera.Type) { case Camera.Type.front: … }` portability.
const CameraType = {
  front: 'front',
  back: 'back',
};
const FlashMode = {off: 'off', on: 'on', auto: 'auto', torch: 'torch'};
const VideoStabilization = {off: 'off', standard: 'standard', cinematic: 'cinematic', auto: 'auto'};
const FocusMode = {on: 'on', off: 'off'};

const PermissionStatus = {
  GRANTED: 'granted',
  UNDETERMINED: 'undetermined',
  DENIED: 'denied',
};

function _granted() {
  return {
    status: PermissionStatus.GRANTED,
    granted: true,
    canAskAgain: true,
    expires: 'never',
  };
}

async function getCameraPermissionsAsync() {
  return _granted();
}
async function requestCameraPermissionsAsync() {
  return _granted();
}
async function getMicrophonePermissionsAsync() {
  return _granted();
}
async function requestMicrophonePermissionsAsync() {
  return _granted();
}

// ─── CameraView (Fabric host component) ───────────────────────────
// The playground's reconciler maps lowercase `'camera'` JSX elements
// to the C++ CameraComponentView via fabricHostConfig.js. Native
// props we accept today: none flow through (facing/flash/etc. are
// stored in the shadow node but the pipeline doesn't react to them
// yet).
const CameraView = React.forwardRef(function CameraView(props, ref) {
  // ref-forwarding for takePictureAsync(): expo's API lets you call
  // it on a CameraView ref. Our snap binding is global (not tied to
  // a specific view) so we attach takePictureAsync to the ref object
  // directly. Real expo would route it through the view's instance
  // handle; for the single-pipeline case this is equivalent.
  const innerRef = React.useRef(null);
  React.useImperativeHandle(ref, () => {
    const obj = {
      takePictureAsync,
      pausePreview() {},
      resumePreview() {},
    };
    Object.defineProperty(obj, 'current', {get: () => innerRef.current});
    return obj;
  });
  return React.createElement('camera', {...props, ref: innerRef});
});

// Backwards-compat alias — upstream renamed `Camera` → `CameraView`
// at expo-camera v14; many tutorials and codebases still reach for
// the old name.
const Camera = CameraView;

// ─── takePictureAsync ─────────────────────────────────────────────
// expo-camera's signature is `(options) => Promise<{uri, width,
// height, base64?, exif?}>`. We honor uri/width/height. base64 /
// exif are TODO — pngenc gives us a PNG file and width/height we
// already know; reading the file back and base64-encoding would
// double the cost of every snap.

async function takePictureAsync(_options) {
  if (!_hasNative) {
    throw new Error('expo-camera: native rnLinux.camera* not bound');
  }
  return new Promise((resolve, reject) => {
    rnLinux.cameraSnap(
      result => resolve({uri: result.uri, width: result.width, height: result.height}),
      msg => reject(new Error(msg)),
    );
  });
}

async function getAvailableCameraTypesAsync() {
  return _hasNative ? ['back'] : [];
}

async function isAvailableAsync() {
  return _hasNative;
}

// Video recording is unimplemented; expose the API so callers don't
// crash. A real recording pipeline (gstreamer mkvmux/x264enc) is a
// separate piece of work.
async function recordAsync() {
  throw new Error('expo-camera: recordAsync not implemented on Linux');
}
function stopRecording() {}

// expo-camera ships scan-bar code / face-detect helpers; stubbed so
// import-time access doesn't throw.
async function getAvailableVideoStabilizationModesAsync() {
  return [];
}
async function getAvailablePictureSizesAsync(_ratio) {
  return ['640x480'];
}

const api = {
  CameraView,
  Camera,
  CameraType,
  FlashMode,
  VideoStabilization,
  FocusMode,
  PermissionStatus,
  getCameraPermissionsAsync,
  requestCameraPermissionsAsync,
  getMicrophonePermissionsAsync,
  requestMicrophonePermissionsAsync,
  takePictureAsync,
  getAvailableCameraTypesAsync,
  isAvailableAsync,
  recordAsync,
  stopRecording,
  getAvailableVideoStabilizationModesAsync,
  getAvailablePictureSizesAsync,
};

module.exports = api;
module.exports.default = api;
