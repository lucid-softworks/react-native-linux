// Ported from ~/code/lucid-softworks/akari/apps/akari/components/DevPerformanceOverlay.tsx
// Self-contained — drops the akari-specific token/dev-settings deps so it
// can drop into any RN app. Measures FPS via rAF deltas over a 60-frame
// sliding window, surfaces avg frame time + dropped-frame count.

import type * as React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Platform, Pressable, StyleSheet, Text, View} from 'react-native';

type PerfStats = {
  fps: number;
  avgFrameTime: number;
  jsHeap: number | null;
  droppedFrames: number;
};

// Frames averaged per sample. Each sample fires a setState → React
// commit → mount transaction → GTK paint, which currently costs about
// 200 ms on our software-paint stack. Updating less often keeps those
// expensive frames rare so the steady-state animation FPS isn't
// dragged down by the FPS counter itself. 240 ≈ one update per 4 s
// at 60 fps — fine for human-eye monitoring, and the costly frame
// no longer dominates the rolling window.
const SAMPLE_WINDOW = 240;

export function FpsOverlay(): React.JSX.Element | null {
  const [visible, setVisible] = useState(true);
  const [stats, setStats] = useState<PerfStats>({
    fps: 0,
    avgFrameTime: 0,
    jsHeap: null,
    droppedFrames: 0,
  });
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameRef = useRef<number>(0);
  const droppedRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const measureFrame = useCallback((timestamp: number) => {
    if (lastFrameRef.current > 0) {
      const delta = timestamp - lastFrameRef.current;
      frameTimesRef.current.push(delta);
      if (delta > 20) droppedRef.current++;

      if (frameTimesRef.current.length >= SAMPLE_WINDOW) {
        const times = frameTimesRef.current;
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const fps = Math.round(1000 / avg);
        let jsHeap: number | null = null;
        if (typeof performance !== 'undefined' && (performance as any).memory) {
          jsHeap = Math.round((performance as any).memory.usedJSHeapSize / 1024 / 1024);
        }
        setStats({
          fps,
          avgFrameTime: Math.round(avg * 10) / 10,
          jsHeap,
          droppedFrames: droppedRef.current,
        });
        frameTimesRef.current = [];
        droppedRef.current = 0;
      }
    }
    lastFrameRef.current = timestamp;
    rafRef.current = requestAnimationFrame(measureFrame);
  }, []);

  useEffect(() => {
    if (!visible) return;
    lastFrameRef.current = 0;
    frameTimesRef.current = [];
    droppedRef.current = 0;
    rafRef.current = requestAnimationFrame(measureFrame);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [visible, measureFrame]);

  if (!visible) {
    return (
      <Pressable style={styles.toggleButton} onPress={() => setVisible(true)}>
        <Text style={styles.toggleText}>FPS</Text>
      </Pressable>
    );
  }

  const fpsColor = stats.fps >= 55 ? '#4ade80' : stats.fps >= 30 ? '#fbbf24' : '#ef4444';

  return (
    <Pressable style={styles.panel} onPress={() => setVisible(false)}>
      <View style={styles.row}>
        <Text style={[styles.value, {color: fpsColor}]}>{stats.fps}</Text>
        <Text style={styles.label}>FPS</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.value}>{stats.avgFrameTime}ms</Text>
        <Text style={styles.label}>Frame</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={[styles.value, stats.droppedFrames > 5 && styles.valueWarn]}>
          {stats.droppedFrames}
        </Text>
        <Text style={styles.label}>Drops</Text>
      </View>
      {stats.jsHeap !== null && (
        <>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.value}>{stats.jsHeap}MB</Text>
            <Text style={styles.label}>Heap</Text>
          </View>
        </>
      )}
      <View style={styles.divider} />
      <Text style={styles.label}>{Platform.OS}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggleButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  toggleText: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  panel: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    gap: 8,
  },
  row: {
    alignItems: 'center',
  },
  value: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  valueWarn: {
    color: '#fbbf24',
  },
  label: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 9,
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  divider: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
});
