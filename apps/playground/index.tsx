// react-native-linux playground. Imports come from 'react-native'
// the same way an iOS/Android app does.

import {useEffect, useRef, useState} from 'react';
import {
  StyleSheet,
  View, ScrollView, Image, Text, TextInput, Pressable, Button,
  FlatList, Modal,
  Animated, Easing,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {renderFabric} from './runtime';

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
  cardValue: {fontSize: 32, fontWeight: '700', color: palette.text},

  buttonRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},

  input:  {height: 36, paddingHorizontal: 10, fontSize: 14,
           color: palette.text, backgroundColor: palette.panelAlt,
           borderRadius: 8, borderWidth: 1, borderColor: palette.border},
  echo:   {fontSize: 13, color: palette.muted, fontStyle: 'italic',
           marginTop: 4},

  listPanel: {flex: 1, backgroundColor: palette.panel,
              borderRadius: 12, borderWidth: 1,
              borderColor: palette.border, padding: 4},
  listHeader: {fontSize: 13, fontWeight: '600', color: palette.subtle,
               padding: 8},
  listFooter: {fontSize: 12, color: palette.muted, padding: 10,
               fontStyle: 'italic'},
  row:    {padding: 10, borderRadius: 6, marginBottom: 4},
  rowEven: {backgroundColor: palette.bg},
  rowOdd:  {backgroundColor: palette.panelAlt},
  rowText: {fontSize: 14, color: palette.text},
  separator: {height: 1, backgroundColor: palette.border, marginVertical: 2},

  modalPanel: {width: 360, padding: 20, backgroundColor: palette.panel,
               borderRadius: 16, borderWidth: 1, borderColor: palette.border,
               gap: 12},
  modalTitle: {fontSize: 18, fontWeight: '700', color: palette.text},
  modalText:  {fontSize: 14, color: palette.subtle, lineHeight: 20},
});

interface Item { id: string; label: string; subtitle: string }

const data: Item[] = Array.from({length: 80}, (_, i) => ({
  id: `i${i}`,
  label: `item ${i}`,
  subtitle:
    i % 3 === 0 ? 'tap to set the counter' :
    i % 3 === 1 ? 'rendered via FlatList' :
                  'styled with StyleSheet.create',
}));

function App(): JSX.Element {
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);
  const [name, setName] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  // Restore the name from AsyncStorage on first mount, then persist
  // on every change. Survives full process restart. We use a
  // `loaded` flag to avoid the classic race where the on-mount
  // getItem resolves AFTER the user has typed and overwrites them.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('rnl.demo.name').then((v) => {
      if (v != null) setName(v);
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem('rnl.demo.name', name);
  }, [name, loaded]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Animated demo — a value that loops 0 → 1 → 0, driving an
  // indicator pip's opacity and horizontal slide.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {toValue: 1, duration: 1100,
                                easing: Easing.inOut}),
        Animated.timing(pulse, {toValue: 0, duration: 1100,
                                easing: Easing.inOut}),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);
  const slideX = pulse.interpolate({inputRange: [0, 1], outputRange: [0, 80]});

  return (
    <View style={styles.app}>
      <Text style={styles.title}>
        react-native-linux  •  Platform.OS = {Platform.OS}
      </Text>
      <Text style={styles.hint}>
        FlatList + Modal + View + Text + Image + ScrollView + TextInput.
      </Text>

      {/* TextInput + remote Image row */}
      <View style={{flexDirection: 'row', gap: 12, marginBottom: 12}}>
        <View style={[styles.card, {flex: 2}]}>
          <Text style={styles.cardLabel}>
            type your name — saved via AsyncStorage
          </Text>
          <TextInput style={styles.input}
                     placeholder="your name…"
                     value={name}
                     onChangeText={setName} />
          <Text style={styles.echo}>
            {name ? `hello, ${name}! (persists across restarts)` : '(state is empty)'}
          </Text>
        </View>
        <View style={[styles.card, {flex: 1, gap: 6}]}>
          <Text style={styles.cardLabel}>remote image (libsoup-3)</Text>
          <Image
            source={{uri: 'https://picsum.photos/240/120'}}
            resizeMode="cover"
            style={{width: 160, height: 80, alignSelf: 'center',
                    backgroundColor: palette.panelAlt, borderRadius: 6}} />
        </View>
      </View>

      <View style={styles.body}>
        {/* Left column — counter, buttons, modal trigger */}
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

          <Button title="open modal" onPress={() => setModalOpen(true)}
                  backgroundColor={palette.blue} />

          <View style={styles.card}>
            <Text style={styles.cardLabel}>useEffect ticker</Text>
            <Text style={[styles.cardValue, {color: palette.accent}]}>{tick}</Text>
          </View>

          {/* Animated pip — opacity + left both driven by `pulse`. */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Animated.loop · 1.1s in/out</Text>
            <View style={{height: 28, marginTop: 10, width: 120}}>
              <Animated.View style={{
                position: 'absolute',
                width: 40, height: 28, borderRadius: 14,
                backgroundColor: palette.accent,
                opacity: pulse, left: slideX,
              }} />
            </View>
          </View>

        </View>

        {/* Right column — FlatList */}
        <View style={styles.listPanel}>
          <FlatList
            data={data}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={
              <Text style={styles.listHeader}>
                FlatList  ·  {data.length} items  ·  separators
              </Text>
            }
            ListFooterComponent={
              <Text style={styles.listFooter}>
                — end of list —
              </Text>
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({item, index}) => (
              <Pressable
                style={[styles.row, index % 2 === 0 ? styles.rowEven : styles.rowOdd]}
                onPress={() => setCount(index)}>
                <Text style={styles.rowText}>
                  {item.label}  ·  {item.subtitle}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </View>

      {/* Modal */}
      <Modal visible={modalOpen} onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalPanel}>
          <Text style={styles.modalTitle}>Modal — overlay layer</Text>
          <Text style={styles.modalText}>
            Modal renders as an absolutely-positioned overlay inside the
            same window. Tap the backdrop or press the button below to
            dismiss.
          </Text>
          <Text style={styles.modalText}>
            counter is {count}; ticker is {tick}; name is {name || '(empty)'}.
          </Text>
          <Button title="dismiss" onPress={() => setModalOpen(false)}
                  backgroundColor={palette.green} />
        </View>
      </Modal>
    </View>
  );
}

renderFabric(<App />);
rnLinux.log('info', 'renderFabric(<App />) called');
