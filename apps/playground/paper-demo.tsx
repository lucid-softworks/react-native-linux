// Real-app harness — drop react-native-paper into the playground and
// see what breaks. Paper is the canonical Material Design RN library;
// it exercises real third-party code paths (Animated, theme context,
// Portal, custom hooks, common RN imports) without us writing the
// components ourselves.
//
// Run via:  RN_ENTRY=paper-demo.tsx node bundle.mjs && ./scripts/vm/run-playground.sh
//
// Findings get filed in docs/realworld-paper.md as a gap list.

import {useState} from 'react';
import {SafeAreaView, ScrollView, StyleSheet, View} from 'react-native';
import {Button, Card, PaperProvider, Switch, Text, TextInput, Snackbar} from 'react-native-paper';
import {registerRootComponent} from 'expo';

function PaperDemo() {
  const [name, setName] = useState('');
  const [switchOn, setSwitchOn] = useState(false);
  const [snackVisible, setSnackVisible] = useState(false);

  return (
    <PaperProvider>
      <SafeAreaView style={styles.app}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text variant="headlineLarge">react-native-paper · linux</Text>
          <Text variant="bodyMedium" style={styles.hint}>
            Drop-in test of a real RN UI library on react-native-linux. Anything broken below is a
            production-ready gap to file.
          </Text>

          <Card style={styles.card}>
            <Card.Title title="Buttons" subtitle="contained / outlined / text variants" />
            <Card.Content style={styles.row}>
              <Button mode="contained" onPress={() => setSnackVisible(true)}>
                contained
              </Button>
              <Button mode="outlined" onPress={() => setSnackVisible(true)}>
                outlined
              </Button>
              <Button mode="text" onPress={() => setSnackVisible(true)}>
                text
              </Button>
            </Card.Content>
          </Card>

          <Card style={styles.card}>
            <Card.Title title="TextInput" />
            <Card.Content>
              <TextInput
                mode="outlined"
                label="Your name"
                value={name}
                onChangeText={setName}
                placeholder="e.g. Luna"
              />
              <Text variant="bodySmall" style={styles.echo}>
                hello {name || '(empty)'}!
              </Text>
            </Card.Content>
          </Card>

          <Card style={styles.card}>
            <Card.Title title="Switch" />
            <Card.Content style={styles.row}>
              <Switch value={switchOn} onValueChange={setSwitchOn} />
              <Text>{switchOn ? 'on' : 'off'}</Text>
            </Card.Content>
          </Card>

          <View style={styles.spacer} />
        </ScrollView>

        <Snackbar
          visible={snackVisible}
          onDismiss={() => setSnackVisible(false)}
          duration={1500}
          action={{label: 'OK', onPress: () => setSnackVisible(false)}}>
          button tapped
        </Snackbar>
      </SafeAreaView>
    </PaperProvider>
  );
}

const styles = StyleSheet.create({
  app: {flex: 1, backgroundColor: '#fafafa'},
  scroll: {padding: 16, gap: 12},
  hint: {color: '#666'},
  card: {marginVertical: 4},
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap'},
  echo: {marginTop: 8, color: '#444'},
  spacer: {height: 24},
});

registerRootComponent(PaperDemo);
