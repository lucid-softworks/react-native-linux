// react-native-linux playground — write it like any other RN app.

import {useEffect, useState} from 'react';
import {
  renderFabric, StyleSheet,
  View, ScrollView, Image, Text, TextInput, Pressable, Button,
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

  buttonRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},

  // Image gallery
  galleryCard: {padding: 12, backgroundColor: palette.panel,
                borderRadius: 12, borderWidth: 1, borderColor: palette.border,
                gap: 10},
  galleryHeader: {fontSize: 13, fontWeight: '600', color: palette.subtle},
  galleryRow: {flexDirection: 'row', gap: 10},
  thumb: {width: 100, height: 70, borderRadius: 8, backgroundColor: palette.panelAlt},
  hero:  {width: '100%' as any, height: 160, borderRadius: 10,
          backgroundColor: palette.panelAlt},

  input: {height: 36, paddingHorizontal: 10, fontSize: 14,
          color: palette.text, backgroundColor: palette.panelAlt,
          borderRadius: 8, borderWidth: 1, borderColor: palette.border},
  echo:  {fontSize: 13, color: palette.muted, fontStyle: 'italic',
          marginTop: 4},

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

const wallpapers = [
  'file:///usr/share/backgrounds/xfce/xfce-blue.jpg',
  'file:///usr/share/backgrounds/xfce/xfce-teal.jpg',
  'file:///usr/share/backgrounds/xfce/xfce-stripes.png',
  'file:///usr/share/backgrounds/xfce/xfce-verticals.png',
];

function App(): JSX.Element {
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);
  const [hero, setHero] = useState(0);
  const [name, setName] = useState('');

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const items = Array.from({length: 40}, (_, i) => i);

  return (
    <View style={styles.app}>
      <Text style={styles.title}>
        react-native-linux  •  View / Text / Image / ScrollView
      </Text>
      <Text style={styles.hint}>
        StyleSheet.create + style props + Yoga flex + Pango text + GTK images.
      </Text>

      {/* TextInput row — typing reaches setState via onChangeText */}
      <View style={[styles.card, {marginBottom: 12}]}>
        <Text style={styles.cardLabel}>type your name — typing fires onChangeText</Text>
        <TextInput style={styles.input}
                   placeholder="your name…"
                   value={name}
                   onChangeText={setName} />
        <Text style={styles.echo}>
          {name ? `hello, ${name}!` : '(state is empty)'}
        </Text>
      </View>

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

          {/* Image gallery: hero + thumbnails */}
          <View style={styles.galleryCard}>
            <Text style={styles.galleryHeader}>
              &lt;Image&gt; · GdkTexture · tap a thumb
            </Text>
            <Image source={{uri: wallpapers[hero]}}
                   resizeMode="cover" style={styles.hero} />
            <View style={styles.galleryRow}>
              {wallpapers.map((uri, i) => (
                <Pressable key={uri} onPress={() => setHero(i)}>
                  <Image source={{uri}} resizeMode="cover" style={styles.thumb} />
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>useEffect ticker</Text>
            <Text style={[styles.cardValue, {color: palette.accent}]}>{tick}</Text>
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
