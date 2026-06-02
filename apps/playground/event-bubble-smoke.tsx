// Bubble/capture/stopPropagation smoke test — exercises the
// Phase-3-follow-up to the Fabric EventEmitter pipeline. The
// dispatcher in `apps/playground/runtime/fabric.js` now runs every
// click through capture (root→target) then bubble (target→root),
// honoring `event.stopPropagation()`. This screen lets us watch the
// invocation order by tapping each box.
//
// Boxes (outer → inner):
//   outer  — onClick + onClickCapture
//     mid  — onClick + onClickCapture
//       inner — onClick (the leaf; click target)
//   bubble-stopper — separate box whose inner Pressable calls
//                    event.stopPropagation() in its onClick. The
//                    outer's onClick should NOT fire after.
//
// We render the running log as live text so smoke + manual runs
// can read the sequence without grepping the playground log.

import React, {useState, useCallback} from 'react';
import {View, Text, Pressable, ScrollView, StyleSheet} from 'react-native';
import {renderFabric} from './runtime';

type Line = {seq: number; text: string};

function App() {
  const [log, setLog] = useState<Line[]>([]);
  const append = useCallback((text: string) => {
    setLog(prev => [...prev.slice(-30), {seq: prev.length, text}]);
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Event bubble / capture / stopPropagation</Text>

      <View style={styles.row}>
        <View
          style={styles.outer}
          // @ts-expect-error — onClickCapture is not in RN's public Pressable
          // typing but the Fabric host config forwards it as a bubble-able
          // prop pair.
          onClick={() => append('outer onClick')}
          onClickCapture={() => append('outer onClickCapture')}>
          <View
            style={styles.mid}
            // @ts-expect-error — same as above.
            onClick={() => append('mid onClick')}
            onClickCapture={() => append('mid onClickCapture')}>
            <Pressable style={styles.inner} onPress={() => append('inner onPress')}>
              <Text style={styles.label}>tap me</Text>
            </Pressable>
          </View>
        </View>

        <View
          style={styles.stopperOuter}
          // @ts-expect-error — see above.
          onClick={() => append('stopper outer onClick (should NOT fire)')}>
          <Pressable
            style={styles.stopperInner}
            onPress={e => {
              append('stopper inner onPress + stopPropagation');
              (e as any)?.stopPropagation?.();
            }}>
            <Text style={styles.label}>stop here</Text>
          </Pressable>
        </View>
      </View>

      <Pressable style={styles.clear} onPress={() => setLog([])}>
        <Text style={styles.clearLabel}>clear</Text>
      </Pressable>

      <ScrollView style={styles.logScroll} contentContainerStyle={styles.logBody}>
        {log.map(line => (
          <Text key={line.seq} style={styles.logLine}>
            {line.seq.toString().padStart(2, '0')} · {line.text}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, padding: 16, backgroundColor: '#fafafa'},
  title: {fontSize: 18, fontWeight: '600', marginBottom: 12, color: '#222'},
  row: {flexDirection: 'row', gap: 16, marginBottom: 16},
  outer: {
    padding: 16,
    backgroundColor: '#c7ddff',
    borderRadius: 8,
    flex: 1,
  },
  mid: {
    padding: 16,
    backgroundColor: '#9bbdf2',
    borderRadius: 6,
  },
  inner: {
    padding: 16,
    backgroundColor: '#3b6ec0',
    borderRadius: 4,
    alignItems: 'center',
  },
  stopperOuter: {
    padding: 16,
    backgroundColor: '#ffd4d4',
    borderRadius: 8,
    flex: 1,
  },
  stopperInner: {
    padding: 16,
    backgroundColor: '#d05c5c',
    borderRadius: 4,
    alignItems: 'center',
  },
  label: {color: '#fff', fontWeight: '600'},
  clear: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#333',
    borderRadius: 4,
    marginBottom: 8,
  },
  clearLabel: {color: '#fff'},
  logScroll: {flex: 1, backgroundColor: '#fff', borderRadius: 6},
  logBody: {padding: 8},
  logLine: {fontFamily: 'monospace', fontSize: 12, color: '#222'},
});

renderFabric(<App />);
