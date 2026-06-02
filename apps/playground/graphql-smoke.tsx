// Reproduces the with-graphql failure pattern: import a hook from a
// stubbed package, call it with a config object, destructure as a
// tuple. Before the bundle.mjs hookStub fix this throws
// "iterator method is not callable".
//
// @ts-nocheck — `urql` is intentionally unresolved at type-time; the
// bundler's stub-unresolved-bare-imports plugin synthesises a runtime
// module, but there's no .d.ts for it.

import React from 'react';
import {Text, View, StyleSheet} from 'react-native';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — see header comment.
import {useQuery} from 'urql';
import {renderFabric} from './runtime';

function App() {
  const [{data, fetching, error}, refetch] = (useQuery as any)({query: 'demo'});
  return (
    <View style={styles.root}>
      <Text style={styles.title}>urql stub smoke</Text>
      <Text style={styles.row}>fetching = {String(fetching)}</Text>
      <Text style={styles.row}>error = {String(error)}</Text>
      <Text style={styles.row}>data = {String(data)}</Text>
      <Text style={styles.row}>refetch = {typeof refetch}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, padding: 24, backgroundColor: '#fafafa'},
  title: {fontSize: 18, fontWeight: '600', marginBottom: 12, color: '#222'},
  row: {fontSize: 14, color: '#222', marginBottom: 4, fontFamily: 'monospace'},
});

renderFabric(<App />);
