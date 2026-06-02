// Touch-event smoke test — verifies that GtkEventControllerLegacy in
// ViewComponentView synthesizes the RN touch lifecycle (onTouchStart
// → onTouchMove* → onTouchEnd) with valid payloads. A press inside
// the blue stage fills the log with the sequence; release ends it.

import React, {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {renderFabric} from './runtime';

function App() {
  const [log, setLog] = useState<string[]>([]);
  const append = (line: string) =>
    setLog(prev => (prev.length > 60 ? [...prev.slice(-60), line] : [...prev, line]));

  const summarize = (kind: string) => (e: any) => {
    const t = e?.nativeEvent?.changedTouches?.[0] ?? e?.nativeEvent;
    if (!t) {
      append(`${kind} (no nativeEvent)`);
      return;
    }
    append(
      `${kind.padEnd(11)} x=${t.pageX?.toFixed?.(0) ?? '?'} y=${t.pageY?.toFixed?.(0) ?? '?'} id=${t.identifier ?? '?'} tg=${t.target ?? '?'}`,
    );
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Touch lifecycle smoke</Text>
      <View
        style={styles.stage}
        onTouchStart={summarize('touchStart')}
        onTouchMove={summarize('touchMove')}
        onTouchEnd={summarize('touchEnd')}
        onTouchCancel={summarize('touchCancel')}>
        <Text style={styles.stageLabel}>press / drag / release here</Text>
      </View>
      <ScrollView style={styles.logBox} contentContainerStyle={styles.logBody}>
        {log.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, padding: 16, backgroundColor: '#fafafa'},
  title: {fontSize: 18, fontWeight: '600', marginBottom: 12, color: '#222'},
  stage: {
    height: 200,
    backgroundColor: '#d6e6fc',
    borderRadius: 8,
    marginBottom: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stageLabel: {color: '#3b6ec0', fontWeight: '600'},
  logBox: {flex: 1, backgroundColor: '#fff', borderRadius: 6},
  logBody: {padding: 8},
  logLine: {fontFamily: 'monospace', fontSize: 12, color: '#222'},
});

renderFabric(<App />);
