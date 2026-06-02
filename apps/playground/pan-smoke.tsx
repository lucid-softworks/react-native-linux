// PanResponder smoke test — verifies the migration from the legacy
// dispatchFabricPan* tag-registry path to the Fabric EventEmitter.
// Drag the blue square; the log fills in with grant/move/release
// callbacks the PanResponder shim threads through. If you see the
// shape `{dx, dy, vx, vy}` keep updating during the drag and a
// final Release entry on release, the migration is working.

import React, {useMemo, useRef, useState} from 'react';
import {PanResponder, StyleSheet, Text, View, Animated} from 'react-native';
import {renderFabric} from './runtime';

function App() {
  const [log, setLog] = useState<string[]>([]);
  const append = (line: string) =>
    setLog(prev => (prev.length > 60 ? [...prev.slice(-60), line] : [...prev, line]));

  const pan = useRef(new Animated.ValueXY()).current;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (_e, g) => {
          append(`grant   dx=${g.dx.toFixed(1)}  dy=${g.dy.toFixed(1)}`);
        },
        onPanResponderMove: (_e, g) => {
          pan.x.setValue(g.dx);
          pan.y.setValue(g.dy);
          append(
            `move    dx=${g.dx.toFixed(1)}  dy=${g.dy.toFixed(1)}  v=${g.vx.toFixed(2)}/${g.vy.toFixed(2)}`,
          );
        },
        onPanResponderRelease: (_e, g) => {
          append(`release dx=${g.dx.toFixed(1)}  dy=${g.dy.toFixed(1)}`);
          Animated.spring(pan, {toValue: {x: 0, y: 0}, useNativeDriver: false}).start();
        },
      }),
    [pan],
  );

  return (
    <View style={styles.root}>
      <Text style={styles.title}>PanResponder smoke</Text>
      <View style={styles.stage}>
        <Animated.View
          {...responder.panHandlers}
          style={[styles.thumb, {transform: [{translateX: pan.x}, {translateY: pan.y}]}]}>
          <Text style={styles.thumbLabel}>drag</Text>
        </Animated.View>
      </View>
      <View style={styles.logBox}>
        {log.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, padding: 16, backgroundColor: '#fafafa'},
  title: {fontSize: 18, fontWeight: '600', marginBottom: 12, color: '#222'},
  stage: {
    height: 240,
    backgroundColor: '#eef2f7',
    borderRadius: 8,
    marginBottom: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumb: {
    width: 90,
    height: 90,
    backgroundColor: '#3b6ec0',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbLabel: {color: '#fff', fontWeight: '600'},
  logBox: {flex: 1, backgroundColor: '#fff', borderRadius: 6, padding: 8},
  logLine: {fontFamily: 'monospace', fontSize: 12, color: '#222'},
});

renderFabric(<App />);
