// Tab-navigator demo, written in the shape an Expo app would write
// it — `export default function App` + `<StatusBar />` + a Tabs
// component that wraps screens. The actual Expo `tabs` template uses
// expo-router for file-based routing (app/(tabs)/_layout.tsx, etc.)
// plus react-native-screens + reanimated + safe-area-context + a
// half-dozen other Expo modules; that's a much bigger shim job. This
// demo proves the visual + interactive primitives are sufficient — a
// real expo-router shim would just wire its `<Tabs>` and `<Tabs.Screen>`
// API down to something like the local `<Tabs>` here.
//
// Run with:
//   RN_ENTRY=expo-tabs.tsx node bundle.mjs
//   # then kill the playground; watchdog will relaunch with the new bundle

import {useState, type ReactNode} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import {registerRootComponent} from 'expo';

// Compact palette modeled after Expo's default light theme.
const C = {
  bg: '#fff',
  surface: '#f6f7f9',
  border: '#e4e6eb',
  text: '#0f172a',
  muted: '#64748b',
  active: '#2563eb',
  inactive: '#9ca3af',
  accent: '#10b981',
  warn: '#f59e0b',
};

type TabName = 'home' | 'explore' | 'profile';
interface TabDef {
  name: TabName;
  title: string;
  icon: string;
  render: () => ReactNode;
}

export default function App(): JSX.Element {
  const [active, setActive] = useState<TabName>('home');
  const [counter, setCounter] = useState(0);

  const tabs: TabDef[] = [
    {
      name: 'home',
      title: 'Home',
      icon: '⌂',
      render: () => <HomeScreen counter={counter} onBump={() => setCounter(c => c + 1)} />,
    },
    {name: 'explore', title: 'Explore', icon: '◎', render: () => <ExploreScreen />},
    {name: 'profile', title: 'Profile', icon: '◐', render: () => <ProfileScreen />},
  ];
  const current = tabs.find(t => t.name === active) ?? tabs[0];

  return (
    <View style={styles.app}>
      {/* Top header — Expo's <Stack.Screen options={{title}}> equivalent. */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{current.title}</Text>
      </View>

      {/* Screen — the active tab's content fills the body. */}
      <View style={styles.body}>{current.render()}</View>

      {/* Bottom tab bar — what expo-router's <Tabs> renders. */}
      <View style={styles.tabbar}>
        {tabs.map(t => {
          const isActive = t.name === active;
          return (
            <Pressable key={t.name} style={styles.tab} onPress={() => setActive(t.name)}>
              <Text style={[styles.tabIcon, {color: isActive ? C.active : C.inactive}]}>
                {t.icon}
              </Text>
              <Text style={[styles.tabLabel, {color: isActive ? C.active : C.inactive}]}>
                {t.title}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <StatusBar style="auto" />
    </View>
  );
}

function HomeScreen({counter, onBump}: {counter: number; onBump: () => void}) {
  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>Welcome home</Text>
      <Text style={styles.p}>
        This is a tab-navigator demo running on react-native-linux. Each tab is its own component;
        the bar at the bottom swaps which one is mounted.
      </Text>
      <Pressable style={styles.btn} onPress={onBump}>
        <Text style={styles.btnText}>Counter: {counter}</Text>
      </Pressable>
      <Text style={styles.note}>
        The counter is held by the App component, so it persists when you switch tabs and come back.
      </Text>
    </View>
  );
}

function ExploreScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>Explore</Text>
      <Text style={styles.p}>
        A real Expo `tabs` template uses expo-router's file-based routing — every file under
        `app/(tabs)/` becomes a tab. Plumbing that into react-native-linux means shimming
        expo-router + react-native-screens + safe-area-context. The visual surface you see here
        works without any of that.
      </Text>
      <View style={styles.row}>
        <Card title="Plumbed" value="View · Text" tint={C.accent} />
        <Card title="Plumbed" value="ScrollView" tint={C.accent} />
        <Card title="Plumbed" value="FlatList" tint={C.accent} />
      </View>
      <View style={styles.row}>
        <Card title="TODO" value="expo-router" tint={C.warn} />
        <Card title="TODO" value="reanimated" tint={C.warn} />
        <Card title="TODO" value="screens" tint={C.warn} />
      </View>
    </View>
  );
}

function ProfileScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.h1}>Profile</Text>
      <Text style={styles.p}>
        Drop in your own content. State lives at the App level so each tab's render is just a pure
        function of props.
      </Text>
      <View style={styles.statRow}>
        <Stat label="FPS target" value="60" />
        <Stat label="Platform" value="linux" />
        <Stat label="Renderer" value="GTK4" />
      </View>
    </View>
  );
}

function Card({title, value, tint}: {title: string; value: string; tint: string}) {
  return (
    <View style={[styles.card, {borderLeftColor: tint}]}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardValue}>{value}</Text>
    </View>
  );
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  app: {flex: 1, backgroundColor: C.bg},
  header: {
    paddingTop: 16,
    paddingBottom: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  headerTitle: {fontSize: 22, fontWeight: '700', color: C.text},

  body: {flex: 1},
  screen: {flex: 1, padding: 24, gap: 16},

  h1: {fontSize: 32, fontWeight: '700', color: C.text},
  p: {fontSize: 15, lineHeight: 22, color: C.muted},
  note: {fontSize: 13, color: C.muted, fontStyle: 'italic'},

  btn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: C.active,
  },
  btnText: {color: '#fff', fontWeight: '600', fontSize: 14},

  row: {flexDirection: 'row', gap: 12},
  card: {
    flex: 1,
    backgroundColor: C.surface,
    padding: 14,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: C.border,
  },
  cardTitle: {fontSize: 11, fontWeight: '600', color: C.muted, marginBottom: 4},
  cardValue: {fontSize: 16, fontWeight: '600', color: C.text},

  statRow: {flexDirection: 'row', gap: 16, marginTop: 8},
  stat: {
    flex: 1,
    backgroundColor: C.surface,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  statValue: {fontSize: 28, fontWeight: '700', color: C.text},
  statLabel: {fontSize: 12, color: C.muted, marginTop: 4},

  tabbar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.surface,
    paddingVertical: 8,
  },
  tab: {flex: 1, alignItems: 'center', paddingVertical: 6},
  tabIcon: {fontSize: 22, marginBottom: 2},
  tabLabel: {fontSize: 11, fontWeight: '600'},
});

registerRootComponent(App);
