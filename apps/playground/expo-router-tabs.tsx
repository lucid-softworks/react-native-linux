// Tabs demo using the actual expo-router API (Tabs, Tabs.Screen,
// Link, useRouter, useLocalSearchParams, etc.) — backed by our
// minimal runtime/expo-router.js shim.
//
// What's different from a real expo-router app: each <Tabs.Screen>
// passes `component={…}` explicitly because we don't have a build-time
// file-system route discovery plugin. Otherwise the surface reads the
// same.
//
// Run with:
//   RN_ENTRY=expo-router-tabs.tsx node bundle.mjs

import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import {registerRootComponent} from 'expo';
import {SymbolView} from 'expo-symbols';
import {Tabs, Link, useLocalSearchParams, router} from 'expo-router';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';

const C = {
  bg: '#fff',
  surface: '#f6f7f9',
  border: '#e4e6eb',
  text: '#0f172a',
  muted: '#64748b',
  active: '#2563eb',
  accent: '#10b981',
  warn: '#f59e0b',
};

// tabBarIcon factories live at module scope so the lint rule
// `react/no-unstable-nested-components` doesn't flag them and so
// React doesn't get a fresh component identity each render.
const HouseIcon = ({color, size}: {color: string; size: number}) => (
  <SymbolView name="house.fill" size={size} tintColor={color} />
);
const SearchIcon = ({color, size}: {color: string; size: number}) => (
  <SymbolView name="magnifyingglass" size={size} tintColor={color} />
);
const GearIcon = ({color, size}: {color: string; size: number}) => (
  <SymbolView name="gearshape.fill" size={size} tintColor={color} />
);

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.app}>
        <Tabs screenOptions={{tabBarActiveTintColor: C.active}}>
          <Tabs.Screen
            name="index"
            component={HomeScreen}
            options={{title: 'Home', tabBarIcon: HouseIcon}}
          />
          <Tabs.Screen
            name="explore"
            component={ExploreScreen}
            options={{title: 'Explore', tabBarIcon: SearchIcon}}
          />
          <Tabs.Screen
            name="settings"
            component={SettingsScreen}
            options={{title: 'Settings', tabBarIcon: GearIcon}}
          />
        </Tabs>
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function HomeScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>Welcome home</Text>
      <Text style={styles.p}>
        This tab demo is wired through our runtime/expo-router.js shim. Routes are managed by a
        context with {`{pathname, params, navigate, back}`}; tapping a tab calls navigate.
      </Text>
      <View style={styles.btnRow}>
        <Link href="/explore?from=home" style={styles.linkBtn}>
          Open Explore via Link
        </Link>
        <Pressable
          style={styles.linkBtn}
          onPress={() => router.push('/settings?source=imperative')}>
          <Text style={styles.linkBtnText}>router.push imperative</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ExploreScreen() {
  const params = useLocalSearchParams() as {from?: string};
  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>Explore</Text>
      <Text style={styles.p}>
        useLocalSearchParams returns the parsed query string from whichever Link or router.push got
        us here. Try opening this tab from the Home tab's Link to see params.from populate.
      </Text>
      <View style={styles.paramBox}>
        <Text style={styles.paramKey}>params.from</Text>
        <Text style={styles.paramVal}>{params.from ?? '— (none — opened via tab bar)'}</Text>
      </View>
    </View>
  );
}

function SettingsScreen() {
  const params = useLocalSearchParams() as {source?: string};
  const [count, setCount] = useState(0);
  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>Settings</Text>
      <View style={styles.paramBox}>
        <Text style={styles.paramKey}>params.source</Text>
        <Text style={styles.paramVal}>{params.source ?? '— (opened via tab bar)'}</Text>
      </View>
      <Pressable style={styles.btn} onPress={() => setCount(c => c + 1)}>
        <Text style={styles.btnText}>State count: {count}</Text>
      </Pressable>
      <Text style={styles.note}>
        Per-tab state is preserved across tab switches because each Tabs.Screen&apos;s component
        instance stays mounted (the shim renders the active screen via React.createElement(comp);
        React keeps the fiber alive as long as the JSX identity matches).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  app: {flex: 1, backgroundColor: C.bg},
  screen: {flex: 1, padding: 24, gap: 16},
  btnRow: {flexDirection: 'row', gap: 10},
  h1: {fontSize: 32, fontWeight: '700', color: C.text},
  p: {fontSize: 14, lineHeight: 20, color: C.muted},
  note: {fontSize: 12, color: C.muted, fontStyle: 'italic'},

  linkBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: C.active,
  },
  linkBtnText: {color: '#fff', fontWeight: '600', fontSize: 13},

  btn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: C.accent,
  },
  btnText: {color: '#fff', fontWeight: '600', fontSize: 14},

  paramBox: {
    backgroundColor: C.surface,
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 4,
    borderLeftColor: C.warn,
    gap: 4,
  },
  paramKey: {fontSize: 11, fontWeight: '600', color: C.muted},
  paramVal: {fontSize: 14, fontWeight: '500', color: C.text, fontFamily: 'monospace'},
});

registerRootComponent(App);
