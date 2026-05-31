'use strict';

// expo-av shim. Real impl wraps GStreamer / MediaPlayer for Video +
// Sound playback. For smoke purposes we render a placeholder View
// at the requested dimensions so layout math survives the import.
// Audio (Sound.createAsync, etc.) returns a no-op handle.

const React = require('react');
const {View, Text} = require('react-native');

function Video(props) {
  const {style} = props;
  return React.createElement(
    View,
    {style: [{backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center'}, style]},
    React.createElement(
      Text,
      {style: {color: '#94a3b8', fontSize: 12}},
      'video placeholder (expo-av not wired on Linux)',
    ),
  );
}
Video.RESIZE_MODE_CONTAIN = 'contain';
Video.RESIZE_MODE_COVER = 'cover';
Video.RESIZE_MODE_STRETCH = 'stretch';

const Audio = {
  Sound: {
    createAsync: () => Promise.resolve({sound: makeSound(), status: {}}),
  },
  setAudioModeAsync: () => Promise.resolve(),
  setIsEnabledAsync: () => Promise.resolve(),
  INTERRUPTION_MODE_IOS_DUCK_OTHERS: 0,
  INTERRUPTION_MODE_IOS_DO_NOT_MIX: 1,
  INTERRUPTION_MODE_IOS_MIX_WITH_OTHERS: 2,
  INTERRUPTION_MODE_ANDROID_DUCK_OTHERS: 0,
  INTERRUPTION_MODE_ANDROID_DO_NOT_MIX: 1,
};

function makeSound() {
  return {
    loadAsync: () => Promise.resolve(),
    unloadAsync: () => Promise.resolve(),
    playAsync: () => Promise.resolve(),
    pauseAsync: () => Promise.resolve(),
    stopAsync: () => Promise.resolve(),
    replayAsync: () => Promise.resolve(),
    setVolumeAsync: () => Promise.resolve(),
    setIsLoopingAsync: () => Promise.resolve(),
    setStatusAsync: () => Promise.resolve(),
    setOnPlaybackStatusUpdate: () => {},
    getStatusAsync: () => Promise.resolve({isLoaded: false}),
  };
}

const ResizeMode = {CONTAIN: 'contain', COVER: 'cover', STRETCH: 'stretch'};
const InterruptionModeIOS = {DuckOthers: 'duckOthers', DoNotMix: 'doNotMix', MixWithOthers: 'mix'};
const InterruptionModeAndroid = {DuckOthers: 'duckOthers', DoNotMix: 'doNotMix'};

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.Video = Video;
module.exports.Audio = Audio;
module.exports.ResizeMode = ResizeMode;
module.exports.InterruptionModeIOS = InterruptionModeIOS;
module.exports.InterruptionModeAndroid = InterruptionModeAndroid;
