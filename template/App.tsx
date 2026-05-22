import React from 'react';
import {Platform, StyleSheet, Text, View} from 'react-native';

export default function App(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Hello from React Native on Linux 🐧</Text>
      <Text style={styles.body}>
        Platform.OS = {Platform.OS} (rendered via GTK4 + Fabric + Hermes)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1f1f23',
    padding: 24,
  },
  heading: {
    color: '#f5f5f5',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 8,
  },
  body: {
    color: '#a0a0a8',
    fontSize: 14,
  },
});
