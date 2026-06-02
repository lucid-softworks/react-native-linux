// LogBox MVP smoke — three buttons exercise the wiring:
//   - "console.error" pushes a warn-level entry via the patched
//     console.error → __rnLinuxLogBox.add path.
//   - "ErrorUtils.reportError" reports a non-fatal via RN's standard
//     surface; the shim's _globalErrorHandler forwards to LogBox.
//   - "throw async" defers a throw via setTimeout(0) — the shim's
//     setTimeout-wrapping catches it and reports through ErrorUtils,
//     so it shows up in LogBox without taking the surface down.

import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {renderFabric} from './runtime';

function App() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>LogBox smoke</Text>
      <Text style={styles.help}>Tap to push entries. Tap the red bar to expand the panel.</Text>
      <View style={styles.row}>
        <Pressable
          style={styles.btn}
          onPress={() => console.error('console.error: a warning string')}>
          <Text style={styles.label}>console.error</Text>
        </Pressable>
        <Pressable
          style={styles.btn}
          onPress={() =>
            (globalThis as any).ErrorUtils.reportError(new Error('reportError: synthetic error'))
          }>
          <Text style={styles.label}>ErrorUtils.reportError</Text>
        </Pressable>
        <Pressable
          style={styles.btn}
          onPress={() =>
            setTimeout(() => {
              throw new Error('async throw: setTimeout body');
            }, 0)
          }>
          <Text style={styles.label}>throw async</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, padding: 16, backgroundColor: '#fafafa'},
  title: {fontSize: 18, fontWeight: '600', marginBottom: 4, color: '#222'},
  help: {color: '#475569', marginBottom: 16},
  row: {flexDirection: 'column', gap: 8},
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#3b6ec0',
    borderRadius: 6,
    alignItems: 'center',
  },
  label: {color: '#fff', fontWeight: '600'},
});

renderFabric(<App />);
