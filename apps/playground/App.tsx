import React from 'react';
import {Platform, ScrollView, StyleSheet, Text, View} from 'react-native';

// Touchstone of the things the runtime has to handle on day one:
// nested Views, multi-fragment Text with mixed styling, flex layout
// (driven by Yoga, identical to RN), and dynamic content from
// Platform.constants. CI uses this app as the smoke target — if it
// boots and the assertions in tests/visualSnapshot pass, we treat the
// platform as alive.
export default function App() {
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.header}>
        <Text style={styles.heading}>react-native-linux playground</Text>
        <Text style={styles.subheading}>
          Running on{' '}
          <Text style={styles.bold}>{Platform.constants.Distribution}</Text>{' '}
          ({Platform.OS} {Platform.Version})
        </Text>
      </View>

      <Section title="View nesting">
        <View style={styles.row}>
          <View style={[styles.box, {backgroundColor: '#3b82f6'}]} />
          <View style={[styles.box, {backgroundColor: '#10b981'}]} />
          <View style={[styles.box, {backgroundColor: '#f97316'}]} />
          <View style={[styles.box, {backgroundColor: '#ef4444'}]} />
        </View>
      </Section>

      <Section title="Text styles">
        <Text style={styles.body}>
          Plain text, <Text style={styles.bold}>bold</Text>,{' '}
          <Text style={styles.italic}>italic</Text>,{' '}
          <Text style={styles.mono}>monospace</Text>, and{' '}
          <Text style={styles.code}>inline code</Text>.
        </Text>
      </Section>

      <Section title="Flex layout">
        <View style={styles.flexRow}>
          <View style={[styles.flexCell, {flex: 1}]}>
            <Text style={styles.body}>flex: 1</Text>
          </View>
          <View style={[styles.flexCell, {flex: 2}]}>
            <Text style={styles.body}>flex: 2</Text>
          </View>
          <View style={[styles.flexCell, {flex: 1}]}>
            <Text style={styles.body}>flex: 1</Text>
          </View>
        </View>
      </Section>

      <Section title="Status">
        <Text style={styles.muted}>
          If you can read this on a GTK4 window, the host, scheduler,
          mounting layer, and at least View + Text are all alive.
        </Text>
      </Section>
    </ScrollView>
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

const styles = StyleSheet.create({
  scroll: {
    padding: 24,
    backgroundColor: '#0f172a',
    minHeight: '100%',
  },
  header: {
    marginBottom: 24,
  },
  heading: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  subheading: {
    color: '#cbd5f5',
    fontSize: 14,
  },
  section: {
    marginBottom: 20,
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#1e293b',
  },
  sectionTitle: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  box: {
    width: 56,
    height: 56,
    borderRadius: 6,
  },
  body: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 22,
  },
  bold: {
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  mono: {
    fontFamily: 'monospace',
  },
  code: {
    fontFamily: 'monospace',
    backgroundColor: '#334155',
    color: '#fcd34d',
    paddingHorizontal: 4,
  },
  flexRow: {
    flexDirection: 'row',
    gap: 8,
  },
  flexCell: {
    backgroundColor: '#0f172a',
    borderRadius: 4,
    padding: 12,
    alignItems: 'center',
  },
  muted: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
  },
});
