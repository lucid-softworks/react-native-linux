'use strict';

const {makePlaceholder} = require('./placeholder-components');

const RTCView = makePlaceholder('RTCView', '#fce7f3');

function notReady() {
  throw new Error('react-native-webrtc not available on Linux yet');
}

function makeConnection() {
  return {
    addTrack: () => {},
    addStream: () => {},
    removeTrack: () => {},
    close: () => {},
    createOffer: () => Promise.reject(new Error('webrtc not available')),
    createAnswer: () => Promise.reject(new Error('webrtc not available')),
    setLocalDescription: () => Promise.resolve(),
    setRemoteDescription: () => Promise.resolve(),
    addIceCandidate: () => Promise.resolve(),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.default = {};
module.exports.RTCView = RTCView;
module.exports.RTCPeerConnection = makeConnection;
module.exports.RTCIceCandidate = function () {};
module.exports.RTCSessionDescription = function () {};
module.exports.MediaStream = function () {
  return {addTrack: () => {}, getTracks: () => []};
};
module.exports.MediaStreamTrack = function () {};
module.exports.mediaDevices = {
  getUserMedia: () => Promise.reject(new Error('webrtc not available')),
  enumerateDevices: () => Promise.resolve([]),
  getDisplayMedia: () => Promise.reject(new Error('webrtc not available')),
};
module.exports.registerGlobals = function () {};
