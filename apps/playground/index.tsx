// Default entry: an Expo-shaped Tabs UI. Each tab demonstrates a slice
// of the platform — the rich playground from ./App is the "Demo" tab.
// All other demos live in their own files (expo-blank.tsx,
// expo-modules-test.tsx, expo-router-tabs.tsx, expo-tabs.tsx) and can
// be run in isolation via `RN_ENTRY=<file> node bundle.mjs`.
//
// All imports come through the umbrella @lucid-softworks/react-native-linux-expo
// shim package, resolved by the esbuild alias (vendor) or Metro's
// resolveRequest (template). End-user apps see the same surface.

import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Appearance,
  Clipboard,
  Dimensions,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import {registerRootComponent} from 'expo';
import {SymbolView} from 'expo-symbols';
import {Tabs, Link, router, useLocalSearchParams} from 'expo-router';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import RichDemo from './App';

const C = {
  bg: '#0f1115',
  surface: '#161922',
  border: '#262a35',
  text: '#f5f7fa',
  muted: '#9aa3b2',
  active: '#3b82f6',
  accent: '#10b981',
  warn: '#f59e0b',
};

const DemoIcon = ({color, size}: {color: string; size: number}) => (
  <SymbolView name="house.fill" size={size} tintColor={color} />
);
const BlankIcon = ({color, size}: {color: string; size: number}) => (
  <SymbolView name="doc" size={size} tintColor={color} />
);
const ModulesIcon = ({color, size}: {color: string; size: number}) => (
  <SymbolView name="gearshape.fill" size={size} tintColor={color} />
);
const RouterIcon = ({color, size}: {color: string; size: number}) => (
  <SymbolView name="paperplane.fill" size={size} tintColor={color} />
);

export default function App(): JSX.Element {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.app}>
        <Tabs screenOptions={{tabBarActiveTintColor: C.active}}>
          <Tabs.Screen
            name="index"
            component={RichDemo}
            options={{title: 'Demo', tabBarIcon: DemoIcon, headerShown: false}}
          />
          <Tabs.Screen
            name="blank"
            component={BlankScreen}
            options={{title: 'Blank', tabBarIcon: BlankIcon}}
          />
          <Tabs.Screen
            name="modules"
            component={ModulesScreen}
            options={{title: 'Modules', tabBarIcon: ModulesIcon}}
          />
          <Tabs.Screen
            name="router"
            component={RouterScreen}
            options={{title: 'Router', tabBarIcon: RouterIcon}}
          />
        </Tabs>
        <StatusBar style="light" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// Mirror of expo-blank.tsx's body — the literal `create-expo-app
// --template blank` content. The point is "an unmodified Expo blank
// app renders here."
function BlankScreen(): JSX.Element {
  return (
    <View style={styles.blankWrap}>
      <Text style={styles.blankText}>Open up App.js to start working on your app!</Text>
    </View>
  );
}

type HostRef = {
  measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void;
  measure: (
    cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void,
  ) => void;
  focus: () => void;
  blur: () => void;
};

function ModulesScreen(): JSX.Element {
  const measuredRef = useRef<HostRef | null>(null);
  const [measured, setMeasured] = useState<string>('—');
  useEffect(() => {
    // setTimeout under our shim runs as a microtask drain — by then the
    // tab body has rendered AND GTK has run a layout pass on tab-switch.
    const id = setTimeout(() => {
      measuredRef.current?.measureInWindow((x, y, w, h) => {
        setMeasured(`x=${x.toFixed(0)} y=${y.toFixed(0)} w=${w.toFixed(0)} h=${h.toFixed(0)}`);
      });
    }, 0);
    return () => clearTimeout(id);
  }, []);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.modulesContent}>
      <Text style={styles.h1}>Module shims</Text>
      <Text style={styles.p}>
        Every Expo-ecosystem module the app imports is resolved through
        @lucid-softworks/react-native-linux-expo. Below: a couple of imports actually resolved and
        used.
      </Text>

      <Row k="Constants.deviceName" v={String(Constants.deviceName ?? '—')} />
      <Row
        k="Constants.platform.linux.userAgent"
        v={String(Constants.platform?.linux?.userAgent ?? '—')}
      />
      <Row k="expo-symbols" v={'★ ⌂ → ⌕ ⚙'} />

      <Text style={styles.h1}>Platform APIs</Text>
      <DimensionsRow />
      <Row k="Appearance.getColorScheme()" v={Appearance.getColorScheme() ?? '—'} />
      <View style={[styles.row, {flexDirection: 'row', alignItems: 'center', gap: 10}]}>
        <Pressable
          style={styles.linkBtn}
          onPress={() => {
            Linking.openURL('https://reactnative.dev').catch(() => {});
          }}>
          <Text style={styles.linkBtnText}>Linking.openURL → reactnative.dev</Text>
        </Pressable>
      </View>
      <ClipboardDemo />

      <Text style={styles.h1}>Refs &amp; measure</Text>
      <View ref={measuredRef as React.Ref<View>} style={styles.row}>
        <Text style={styles.rowKey}>measureInWindow(this row)</Text>
        <Text style={styles.rowVal}>{measured}</Text>
      </View>

      <Text style={styles.h1}>Switch</Text>
      <SwitchDemo />
      <SwitchDemo initial disabled label="disabled (initially on)" />

      <Text style={styles.h1}>ActivityIndicator</Text>
      <View style={[styles.row, {flexDirection: 'row', alignItems: 'center', gap: 12}]}>
        <ActivityIndicator />
        <Text style={styles.rowVal}>animating (default)</Text>
      </View>
      <View style={[styles.row, {flexDirection: 'row', alignItems: 'center', gap: 12}]}>
        <ActivityIndicator animating={false} hidesWhenStopped={false} />
        <Text style={styles.rowVal}>animating=false hidesWhenStopped=false</Text>
      </View>

      <Text style={styles.h1}>Mixed-style Text</Text>
      <View style={styles.row}>
        <Text style={styles.rowKey}>nested Text with per-fragment style</Text>
        <Text style={styles.rowVal}>
          plain <Text style={{color: '#ef4444', fontWeight: '700'}}>red bold</Text>{' '}
          <Text style={{color: '#10b981', fontStyle: 'italic'}}>green italic</Text>{' '}
          <Text style={{fontSize: 22}}>big</Text> tail
        </Text>
      </View>

      <Text style={styles.h1}>Text overflow</Text>
      <View style={styles.row}>
        <Text style={styles.rowKey}>numberOfLines=1 ellipsizeMode=tail</Text>
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.rowVal}>
          This is a very long single-line string that the Paragraph should truncate with an ellipsis
          at the tail because the row width is bounded.
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowKey}>numberOfLines=2 ellipsizeMode=tail</Text>
        <Text numberOfLines={2} ellipsizeMode="tail" style={styles.rowVal}>
          Lines beyond the second should disappear behind an ellipsis. This paragraph is
          intentionally long to spill across the 2-line limit and give the Paragraph something
          visible to clip — multiple sentences, various word lengths, just to make the wrap behavior
          unambiguous.
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowKey}>numberOfLines=1 ellipsizeMode=middle</Text>
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.rowVal}>
          /home/luna/projects/react-native-linux/apps/playground/linux/build/assets/index.linux.bundle
        </Text>
      </View>
    </ScrollView>
  );
}

function RouterScreen(): JSX.Element {
  const params = useLocalSearchParams() as {via?: string};
  const [count, setCount] = useState(0);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.modulesContent}>
      <Text style={styles.h1}>Router</Text>
      <Text style={styles.p}>
        Routing comes from the expo-router shim. router.push / Link / useLocalSearchParams all flow
        through the same RouterContext.
      </Text>

      <Row k="params.via" v={params.via ?? '—'} />

      <View style={styles.btnRow}>
        <Link href="/router?via=link" style={styles.linkBtn}>
          via Link
        </Link>
        <Pressable style={styles.linkBtn} onPress={() => router.push('/router?via=imperative')}>
          <Text style={styles.linkBtnText}>via router.push</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => setCount(c => c + 1)}>
          <Text style={styles.btnText}>local count {count}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function DimensionsRow() {
  const w = Dimensions.get('window');
  return <Row k="Dimensions.get('window')" v={`${w.width}×${w.height} @${w.scale}x`} />;
}

function ClipboardDemo() {
  const [last, setLast] = useState('—');
  return (
    <View style={[styles.row, {flexDirection: 'row', alignItems: 'center', gap: 10}]}>
      <Pressable
        style={styles.linkBtn}
        onPress={() => {
          const s = `from rn-linux at ${new Date().toISOString()}`;
          Clipboard.setString(s);
          setLast('set: ' + s);
        }}>
        <Text style={styles.linkBtnText}>Clipboard.setString</Text>
      </Pressable>
      <Pressable
        style={styles.btn}
        onPress={() => {
          Clipboard.getString().then(s => setLast('got: ' + (s || '∅')));
        }}>
        <Text style={styles.btnText}>getString</Text>
      </Pressable>
      <Text style={styles.rowVal}>{last}</Text>
    </View>
  );
}

function SwitchDemo({
  initial = false,
  disabled = false,
  label = 'tap to toggle',
}: {
  initial?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const [v, setV] = useState(initial);
  return (
    <View style={[styles.row, {flexDirection: 'row', alignItems: 'center', gap: 12}]}>
      <Switch value={v} onValueChange={setV} disabled={disabled} />
      <Text style={styles.rowVal}>
        {label}: {String(v)}
      </Text>
    </View>
  );
}

function Row({k, v}: {k: string; v: string}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowKey}>{k}</Text>
      <Text style={styles.rowVal}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  app: {flex: 1, backgroundColor: C.bg},
  screen: {flex: 1, backgroundColor: C.bg},

  blankWrap: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff'},
  blankText: {fontSize: 14, color: '#0f172a'},

  modulesContent: {padding: 20, gap: 14},

  h1: {fontSize: 24, fontWeight: '700', color: C.text},
  p: {fontSize: 13, lineHeight: 19, color: C.muted},

  row: {
    backgroundColor: C.surface,
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: C.warn,
    gap: 4,
  },
  rowKey: {fontSize: 11, fontWeight: '600', color: C.muted, fontFamily: 'monospace'},
  rowVal: {fontSize: 14, fontWeight: '500', color: C.text, fontFamily: 'monospace'},

  btnRow: {flexDirection: 'row', gap: 10, flexWrap: 'wrap'},
  linkBtn: {paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: C.active},
  linkBtnText: {color: '#fff', fontWeight: '600', fontSize: 13},
  btn: {paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: C.accent},
  btnText: {color: '#fff', fontWeight: '600', fontSize: 13},
});

registerRootComponent(App);
