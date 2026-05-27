// Drop-in test of the unmodified Expo blank-template App component
// (`npx create-expo-app --template blank`). The only line that
// differs from a real Expo app is the `renderFabric(<App />)` call at
// the bottom — Expo's CLI provides its own entry that calls
// AppRegistry.registerComponent, which we route to the same place
// from our C++ host via `globalThis.RN$AppRegistry.runApplication`.
//
// Touches we made to support this:
//   * runtime/expo-status-bar.js — desktop has no system status bar
//     to configure, so this is a no-op shim that returns the same
//     module shape so imports resolve.
//   * runtime/vendor.js + bundle.mjs — wire `expo-status-bar` into
//     the vendor require-shim so it resolves at app-bundle load time.

import type * as React from 'react';
import {StatusBar} from 'expo-status-bar';
import {StyleSheet, Text, View} from 'react-native';
import {renderFabric} from './runtime';

function App(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text>Open up App.js to start working on your app!</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

renderFabric(<App />);
