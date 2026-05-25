// Smoke-test for the small Expo-module shims. Each row imports + uses
// one of the modules; if every row shows a value, every shim is wired
// correctly (vendor.js + bundle.mjs require-shim + module behaviour).
//
// Run with:
//   RN_ENTRY=expo-modules-test.tsx node bundle.mjs

import {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import {registerRootComponent} from 'expo';
import {useFonts} from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import {SymbolView} from 'expo-symbols';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import {SafeAreaProvider, SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';

export default function App(): JSX.Element {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.app}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.h1}>Expo module shim smoke-test</Text>
          <Text style={styles.muted}>
            Each row imports + uses one of the shimmed Expo modules. If you can read this and the
            rows below render real values, every shim is wired correctly.
          </Text>

          <FontRow />
          <SafeAreaRow />
          <ConstantsRow />
          <LinkingRow />
          <SymbolsRow />
          <SplashScreenRow />
          <WebBrowserRow />
        </ScrollView>
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Row({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowBody}>{children}</View>
    </View>
  );
}

function FontRow() {
  const [loaded, error] = useFonts({SpaceMono: 'fake://SpaceMono.ttf'});
  return (
    <Row label="useFonts">
      <Text style={styles.value}>
        loaded={String(loaded)} error={error ? String(error) : 'null'}
      </Text>
    </Row>
  );
}

function SafeAreaRow() {
  const insets = useSafeAreaInsets();
  return (
    <Row label="useSafeAreaInsets">
      <Text style={styles.value}>
        top={insets.top} right={insets.right} bottom={insets.bottom} left={insets.left}
      </Text>
    </Row>
  );
}

function ConstantsRow() {
  return (
    <Row label="Constants (default + named)">
      <Text style={styles.value}>deviceName={Constants.deviceName}</Text>
      <Text style={styles.value}>
        platform.linux.model={Constants.platform?.linux?.model ?? '—'}
      </Text>
      <Text style={styles.value}>sessionId={Constants.sessionId}</Text>
    </Row>
  );
}

function LinkingRow() {
  const url = Linking.createURL('/home?tab=explore', {scheme: 'rnl-test'});
  const parsed = Linking.parse('rnl-test://home?tab=explore&page=2');
  return (
    <Row label="Linking">
      <Text style={styles.value}>createURL → {url}</Text>
      <Text style={styles.value}>
        parse.path={parsed.path} parse.queryParams.tab={parsed.queryParams.tab}
      </Text>
    </Row>
  );
}

function SymbolsRow() {
  return (
    <Row label="SymbolView (known + unknown name)">
      <View style={{flexDirection: 'row', gap: 12, alignItems: 'center'}}>
        <SymbolView name="house.fill" size={24} tintColor="#2563eb" />
        <SymbolView name="chevron.right" size={24} tintColor="#10b981" />
        <SymbolView name="star.fill" size={24} tintColor="#f59e0b" />
        <SymbolView name="info.circle" size={24} tintColor="#64748b" />
        <SymbolView name="unknown.symbol.name" size={20} tintColor="#9ca3af" />
      </View>
    </Row>
  );
}

function SplashScreenRow() {
  const [phase, setPhase] = useState('idle');
  useEffect(() => {
    SplashScreen.preventAutoHideAsync().then(() => {
      setPhase('prevented');
      SplashScreen.hideAsync().then(() => setPhase('hidden'));
    });
  }, []);
  return (
    <Row label="SplashScreen">
      <Text style={styles.value}>prevent→hide phase: {phase}</Text>
    </Row>
  );
}

function WebBrowserRow() {
  return (
    <Row label="WebBrowser.openBrowserAsync">
      <Pressable
        style={styles.btn}
        onPress={() => {
          WebBrowser.openBrowserAsync('https://expo.dev/');
        }}>
        <Text style={styles.btnText}>Open expo.dev</Text>
      </Pressable>
    </Row>
  );
}

const styles = StyleSheet.create({
  app: {flex: 1, backgroundColor: '#0f172a'},
  scroll: {padding: 20, gap: 12},
  h1: {fontSize: 22, fontWeight: '700', color: '#f8fafc', marginBottom: 4},
  muted: {fontSize: 13, color: '#94a3b8', marginBottom: 8},
  row: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  rowLabel: {fontSize: 13, fontWeight: '600', color: '#cbd5e1', marginBottom: 6},
  rowBody: {gap: 4},
  value: {color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace'},
  btn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#2563eb',
    borderRadius: 6,
  },
  btnText: {color: '#fff', fontWeight: '600', fontSize: 13},
});

registerRootComponent(App);
