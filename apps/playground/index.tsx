// react-native-linux playground — written the way you'd write any
// other RN app: StyleSheet.create + style={...} / style={[a, b]}.

import {useEffect, useState} from 'react';
import {
  renderFabric, StyleSheet,
  View, ScrollView, Text, Pressable, Button,
} from './runtime';

const palette = {
  bg:        '#0f172a',
  panel:     '#1e293b',
  panelAlt:  '#111827',
  border:    '#334155',
  text:      '#f8fafc',
  muted:     '#94a3b8',
  subtle:    '#cbd5e1',
  accent:    '#fde047',
  green:     '#22c55e',
  blue:      '#3b82f6',
  orange:    '#f97316',
  red:       '#ef4444',
};

const styles = StyleSheet.create({
  app:    {flex: 1, padding: 20, backgroundColor: palette.bg},
  title:  {fontSize: 24, fontWeight: '700', color: palette.text},
  hint:   {fontSize: 13, color: palette.muted, fontStyle: 'italic',
           marginBottom: 16},

  body:   {flexDirection: 'row', gap: 16, flex: 1},
  column: {flex: 1, gap: 12},

  card:   {padding: 14, backgroundColor: palette.panel,
           borderRadius: 12, borderWidth: 1, borderColor: palette.border},
  cardLabel: {fontSize: 13, fontWeight: '500', color: palette.muted},
  cardValue: {fontSize: 36, fontWeight: '700', color: palette.text},
  cardValueAccent: {fontSize: 36, fontWeight: '700', color: palette.accent},

  buttonRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},

  scrollPanel: {flex: 1, backgroundColor: palette.panel,
                borderRadius: 12, borderWidth: 1,
                borderColor: palette.border, padding: 4},
  scrollHeader: {fontSize: 13, fontWeight: '600', color: palette.subtle,
                 marginBottom: 4},
  scrollContent: {padding: 8, gap: 6},

  row:    {padding: 10, borderRadius: 6},
  rowEven: {backgroundColor: palette.bg},
  rowOdd:  {backgroundColor: palette.panelAlt},
  rowText: {fontSize: 14, color: palette.text},
});

function App(): JSX.Element {
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const items = Array.from({length: 40}, (_, i) => i);

  return (
    <View style={styles.app}>
      <Text style={styles.title}>
        react-native-linux  •  Fabric + Yoga + Pango
      </Text>
      <Text style={styles.hint}>
        Using style=&#123;styles.x&#125; / StyleSheet.create like a normal RN app.
      </Text>

      <View style={styles.body}>
        {/* Left column */}
        <View style={styles.column}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>counter</Text>
            <Text style={styles.cardValue}>{count}</Text>
          </View>

          <View style={styles.buttonRow}>
            <Button title="+1"    width={84} onPress={() => setCount((c) => c + 1)}
                    backgroundColor={palette.green} />
            <Button title="+10"   width={84} onPress={() => setCount((c) => c + 10)}
                    backgroundColor={palette.blue} />
            <Button title="−1"    width={84} onPress={() => setCount((c) => c - 1)}
                    backgroundColor={palette.orange} />
            <Button title="reset" width={84} onPress={() => setCount(0)}
                    backgroundColor={palette.red} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>useEffect ticker</Text>
            <Text style={styles.cardValueAccent}>{tick}</Text>
          </View>
        </View>

        {/* Right column — scrolling list */}
        <View style={styles.scrollPanel}>
          <ScrollView style={{flex: 1}}>
            <View style={styles.scrollContent}>
              <Text style={styles.scrollHeader}>
                scrolling list — 40 rows
              </Text>
              {items.map((i) => (
                <Pressable key={i}
                           style={[styles.row, i % 2 === 0 ? styles.rowEven : styles.rowOdd]}
                           onPress={() => setCount(i)}>
                  <Text style={styles.rowText}>
                    row {i}  ·  tap to set counter
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

renderFabric(<App />);
rnLinux.log('info', 'renderFabric(<App />) called');
