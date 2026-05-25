// Entry point for the react-native-linux playground, written exactly
// as `npx create-expo-app` generates: import the App, hand it to
// Expo's `registerRootComponent`. Our `expo` runtime shim
// (runtime/expo.js) routes that into the same `renderFabric` call
// the lower layers use; on iOS/Android it'd go through Expo's
// AppRegistry wrapper instead.
//
// To run an alternate entry without overwriting this file:
//   RN_ENTRY=expo-blank.tsx node bundle.mjs

import {registerRootComponent} from 'expo';
import App from './App';

registerRootComponent(App);
