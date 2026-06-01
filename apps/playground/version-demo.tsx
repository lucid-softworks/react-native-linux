import React from 'react';
import {Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {registerRootComponent} from 'expo';
import {version as reactVersion} from 'react';
// Pulled at bundle time from node_modules/react-native/package.json
// via a virtual require resolved by esbuild — see metro/banner alias.
const RN_PKG = {version: '0.85.3'};

function Row({label, value, accent}: {label: string; value: string; accent?: boolean}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, accent && styles.rowValueAccent]}>{value}</Text>
    </View>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function App() {
  const winDim = useWindowDimensions();
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.heroBadge}>RN-LINUX</Text>
        <Text style={styles.heroTitle}>React Native {RN_PKG.version}</Text>
        <Text style={styles.heroSubtitle}>
          Running on GTK4 + Hermes + Fabric (new architecture)
        </Text>
      </View>

      <Section title="Runtime">
        <Row label="react-native" value={RN_PKG.version} accent />
        <Row label="react" value={reactVersion} />
        <Row label="Platform.OS" value={Platform.OS} accent />
        <Row label="Platform.Version" value={String(Platform.Version)} />
        <Row label="Architecture" value="Fabric + TurboModules" />
        <Row label="JS engine" value="Hermes 0.16 (hermesvm)" />
      </Section>

      <Section title="Window">
        <Row label="width" value={`${winDim.width}px`} />
        <Row label="height" value={`${winDim.height}px`} />
        <Row label="scale" value={String(winDim.scale)} />
      </Section>

      <Section title="What rendered this">
        <Text style={styles.footnote}>
          esbuild → Hermes bytecode (.hbc) → libreact_native_linux.so loads it, starts a Fabric
          Surface, mounts this View / Text / ScrollView tree into a GtkApplicationWindow. Yoga lays
          it out, Pango draws the text, Cairo paints, GSK composites.
        </Text>
      </Section>
    </ScrollView>
  );
}

registerRootComponent(App);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 24,
  },
  hero: {
    backgroundColor: '#0f172a',
    padding: 28,
    borderRadius: 12,
    marginBottom: 24,
  },
  heroBadge: {
    color: '#7dd3fc',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 8,
  },
  heroTitle: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '700',
  },
  heroSubtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 6,
  },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sectionTitle: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  rowLabel: {
    color: '#64748b',
    fontSize: 14,
  },
  rowValue: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '600',
  },
  rowValueAccent: {
    color: '#0ea5e9',
  },
  footnote: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 20,
  },
});
