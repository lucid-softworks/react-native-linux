import React, {useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableHighlight,
  TouchableWithoutFeedback,
  StyleSheet,
} from 'react-native';
import {renderFabric} from './runtime';

function App() {
  const [tap, setTap] = useState({o: 0, h: 0, wf: 0});
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Touchable* shims</Text>
      <TouchableOpacity style={styles.btn} onPress={() => setTap(s => ({...s, o: s.o + 1}))}>
        <Text style={styles.label}>TouchableOpacity — {tap.o}</Text>
      </TouchableOpacity>
      <TouchableHighlight
        style={styles.btn}
        underlayColor="#f59e0b"
        onPress={() => setTap(s => ({...s, h: s.h + 1}))}>
        <Text style={styles.label}>TouchableHighlight — {tap.h}</Text>
      </TouchableHighlight>
      <TouchableWithoutFeedback onPress={() => setTap(s => ({...s, wf: s.wf + 1}))}>
        <View style={styles.btn}>
          <Text style={styles.label}>TouchableWithoutFeedback — {tap.wf}</Text>
        </View>
      </TouchableWithoutFeedback>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, padding: 24, backgroundColor: '#fafafa'},
  title: {fontSize: 18, fontWeight: '600', marginBottom: 16, color: '#222'},
  btn: {
    backgroundColor: '#3b6ec0',
    padding: 18,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  label: {color: '#fff', fontWeight: '600'},
});

renderFabric(<App />);
