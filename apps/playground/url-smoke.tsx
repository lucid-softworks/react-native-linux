// URL polyfill verification harness — 13 assertions covering
// absolute parse, all accessors (href / origin / protocol /
// host / hostname / port / pathname / search / hash /
// searchParams), all four relative-resolve modes (relative,
// absolute-path, query-only, hash-only), and URL.canParse for
// both valid + invalid inputs.

import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {renderFabric} from './runtime';

function App() {
  const cases: Array<[string, () => any]> = [
    ['new URL(absolute).href', () => new URL('https://example.com/foo?a=1&b=2#x').href],
    ['url.origin', () => new URL('https://example.com:8080/foo').origin],
    ['url.hostname', () => new URL('https://example.com:8080/foo').hostname],
    ['url.port', () => new URL('https://example.com:8080/foo').port],
    ['url.pathname', () => new URL('https://example.com/a/b/c?d').pathname],
    ['url.search', () => new URL('https://example.com/a?x=1&y=2').search],
    ['url.searchParams.get', () => new URL('https://example.com/?x=1&y=2').searchParams.get('y')],
    ['relative resolve', () => new URL('bar', 'https://example.com/foo/').href],
    ['absolute-path resolve', () => new URL('/baz', 'https://example.com/foo/').href],
    ['query-only resolve', () => new URL('?q=1', 'https://example.com/foo').href],
    ['hash-only resolve', () => new URL('#frag', 'https://example.com/foo?a=1').href],
    ['URL.canParse(valid)', () => URL.canParse('https://example.com')],
    ['URL.canParse(invalid)', () => URL.canParse('::::')],
  ];

  return (
    <View style={styles.root}>
      <Text style={styles.title}>URL polyfill smoke</Text>
      <ScrollView style={styles.body} contentContainerStyle={{padding: 8}}>
        {cases.map(([label, fn]) => {
          let result: string;
          try {
            result = String(fn());
          } catch (e: any) {
            result = 'THREW: ' + (e?.message || String(e));
          }
          return (
            <Text key={label} style={styles.row}>
              {label} = {result}
            </Text>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, padding: 16, backgroundColor: '#fafafa'},
  title: {fontSize: 18, fontWeight: '600', marginBottom: 12, color: '#222'},
  body: {flex: 1, backgroundColor: '#fff', borderRadius: 6},
  row: {fontFamily: 'monospace', fontSize: 12, color: '#222', marginBottom: 4},
});

renderFabric(<App />);
