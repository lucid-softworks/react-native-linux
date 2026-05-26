// Smoke-test harness + live demo for each of the next batch of
// "drop a real RN library in and see what works" libraries. Each
// section probes the import at run-time (✓/✗ row) AND mounts a tiny
// live UI exercising the API. Libraries that aren't wired native-side
// get a degraded fallback so you can still see the JS surface render.
//
// Findings get filed in docs/realworld-smoke.md.
//
// Run via:
//   RN_ENTRY=smoke-demo.tsx node apps/playground/bundle.mjs
//   scripts/vm/run-playground.sh

import {useEffect, useState} from 'react';
import {Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {registerRootComponent} from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DeviceInfo from 'react-native-device-info';
import * as SafeAreaContext from 'react-native-safe-area-context';
// expo-camera + expo-location go through expo-modules-core's
// requireNativeModule() at import-time, which throws when no native
// module is registered. Load them lazily via require() inside the
// probe so the throw lands in tryProbe's catch instead of breaking
// the whole bundle.
declare const require: (id: string) => any;

type Probe = {
  name: string;
  status: 'pending' | 'ok' | 'fail';
  detail?: string;
};

// async-arrows are silently no-op'd by our Hermes — use named async
// function declarations everywhere instead.
function tryProbe(name: string, fn: () => string | Promise<string>): Promise<Probe> {
  return Promise.resolve()
    .then(fn)
    .then(detail => ({name, status: 'ok' as const, detail}))
    .catch((e: unknown) => ({
      name,
      status: 'fail' as const,
      detail: e instanceof Error ? e.message : String(e),
    }));
}

function ProbeRow({probe}: {probe: Probe}) {
  return (
    <View style={styles.probeRow}>
      <Text style={[styles.status, probe.status === 'ok' ? styles.ok : styles.fail]}>
        {probe.status === 'ok' ? '✓' : '✗'}
      </Text>
      <View style={{flex: 1}}>
        <Text style={styles.probeName}>{probe.name}</Text>
        {probe.detail ? <Text style={styles.probeDetail}>{probe.detail}</Text> : null}
      </View>
    </View>
  );
}

// ─────────────────────────── AsyncStorage ───────────────────────────
function AsyncStorageDemo() {
  const [draft, setDraft] = useState('');
  const [stored, setStored] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('rnl-smoke-note').then(setStored);
  }, []);

  function save() {
    AsyncStorage.setItem('rnl-smoke-note', draft).then(() => setStored(draft));
  }
  function clear() {
    AsyncStorage.removeItem('rnl-smoke-note').then(() => setStored(null));
  }

  return (
    <View style={styles.demo}>
      <Text style={styles.demoCaption}>
        Persists across restarts. Backed by rnLinux.storage* → JSON file under XDG_CONFIG_HOME.
      </Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="type a note…"
        style={styles.input}
      />
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={save}>
          <Text style={styles.btnText}>Save</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={clear}>
          <Text style={styles.btnText}>Clear</Text>
        </Pressable>
      </View>
      <Text style={styles.demoLine}>stored: {stored ?? '(null)'}</Text>
    </View>
  );
}

// ─────────────────────────── DeviceInfo ───────────────────────────
function DeviceInfoDemo() {
  const [info, setInfo] = useState<Record<string, unknown>>({});

  useEffect(() => {
    async function load() {
      const out: Record<string, unknown> = {};
      // Every public method on react-native-device-info. Grouped to
      // keep the rendered list scannable; suffixes like (Android-only)
      // mean the upstream library exposes them but they return Linux-
      // safe stubs ('' / 0 / false / []).
      const getters: Array<[string, () => Promise<unknown> | unknown]> = [
        // ── identifiers ───────────────────────────────────────────
        ['getBrand', DeviceInfo.getBrand],
        ['getModel', DeviceInfo.getModel],
        ['getManufacturer', DeviceInfo.getManufacturer],
        ['getDeviceId', DeviceInfo.getDeviceId],
        ['getDeviceName', DeviceInfo.getDeviceName],
        ['getDeviceType', DeviceInfo.getDeviceType],
        ['getUniqueId', DeviceInfo.getUniqueId],
        ['syncUniqueId', DeviceInfo.syncUniqueId],
        ['getInstanceId', DeviceInfo.getInstanceId],
        ['getSerialNumber', DeviceInfo.getSerialNumber],
        ['getAndroidId (Android-only)', DeviceInfo.getAndroidId],
        ['getAppSetId (Android-only)', DeviceInfo.getAppSetId],
        ['getDeviceToken (iOS-only)', DeviceInfo.getDeviceToken],
        // ── OS / kernel ───────────────────────────────────────────
        ['getBaseOs', DeviceInfo.getBaseOs],
        ['getSystemName', DeviceInfo.getSystemName],
        ['getSystemVersion', DeviceInfo.getSystemVersion],
        ['getBuildId', DeviceInfo.getBuildId],
        ['getFingerprint', DeviceInfo.getFingerprint],
        ['getHardware', DeviceInfo.getHardware],
        ['getBootloader', DeviceInfo.getBootloader],
        ['getApiLevel (Android-only)', DeviceInfo.getApiLevel],
        ['getCodename (Android-only)', DeviceInfo.getCodename],
        ['getDevice (Android-only)', DeviceInfo.getDevice],
        ['getDisplay (Android-only)', DeviceInfo.getDisplay],
        ['getIncremental (Android-only)', DeviceInfo.getIncremental],
        ['getPreviewSdkInt (Android-only)', DeviceInfo.getPreviewSdkInt],
        ['getSecurityPatch (Android-only)', DeviceInfo.getSecurityPatch],
        ['getTags (Android-only)', DeviceInfo.getTags],
        ['getType (Android-only)', DeviceInfo.getType],
        ['getProduct', DeviceInfo.getProduct],
        // ── app identity ──────────────────────────────────────────
        ['getApplicationName', DeviceInfo.getApplicationName],
        ['getBundleId', DeviceInfo.getBundleId],
        ['getVersion', DeviceInfo.getVersion],
        ['getBuildNumber', DeviceInfo.getBuildNumber],
        ['getReadableVersion', DeviceInfo.getReadableVersion],
        ['getInstallerPackageName', DeviceInfo.getInstallerPackageName],
        ['getInstallReferrer', DeviceInfo.getInstallReferrer],
        ['getFirstInstallTime', DeviceInfo.getFirstInstallTime],
        ['getLastUpdateTime', DeviceInfo.getLastUpdateTime],
        ['getStartupTime', DeviceInfo.getStartupTime],
        // ── network ───────────────────────────────────────────────
        ['getIpAddress', DeviceInfo.getIpAddress],
        ['getMacAddress', DeviceInfo.getMacAddress],
        ['getHost', DeviceInfo.getHost],
        ['getHostNames', DeviceInfo.getHostNames],
        ['getCarrier (mobile-only)', DeviceInfo.getCarrier],
        ['getUserAgent', DeviceInfo.getUserAgent],
        // ── memory / disk ─────────────────────────────────────────
        ['getTotalMemory', DeviceInfo.getTotalMemory],
        ['getMaxMemory', DeviceInfo.getMaxMemory],
        ['getUsedMemory', DeviceInfo.getUsedMemory],
        ['getFreeDiskStorage', DeviceInfo.getFreeDiskStorage],
        ['getFreeDiskStorageOld', DeviceInfo.getFreeDiskStorageOld],
        ['getTotalDiskCapacity', DeviceInfo.getTotalDiskCapacity],
        ['getTotalDiskCapacityOld', DeviceInfo.getTotalDiskCapacityOld],
        // ── power / battery ───────────────────────────────────────
        ['getBatteryLevel', DeviceInfo.getBatteryLevel],
        ['isBatteryCharging', DeviceInfo.isBatteryCharging],
        ['getPowerState', DeviceInfo.getPowerState],
        ['getBrightness (iOS-only)', DeviceInfo.getBrightness],
        // ── form factor / capabilities ────────────────────────────
        ['isTablet', DeviceInfo.isTablet],
        ['isEmulator', DeviceInfo.isEmulator],
        ['isLandscape', DeviceInfo.isLandscape],
        ['isCameraPresent', DeviceInfo.isCameraPresent],
        ['isKeyboardConnected', DeviceInfo.isKeyboardConnected],
        ['isMouseConnected', DeviceInfo.isMouseConnected],
        ['isTabletMode (Windows-only)', DeviceInfo.isTabletMode],
        ['isLowRamDevice (Android-only)', DeviceInfo.isLowRamDevice],
        ['isDisplayZoomed (iOS-only)', DeviceInfo.isDisplayZoomed],
        ['hasNotch', DeviceInfo.hasNotch],
        ['hasDynamicIsland', DeviceInfo.hasDynamicIsland],
        ['hasGms (Android-only)', DeviceInfo.hasGms],
        ['hasHms (Android-only)', DeviceInfo.hasHms],
        // ── permissions / state ───────────────────────────────────
        ['isPinOrFingerprintSet', DeviceInfo.isPinOrFingerprintSet],
        ['isAirplaneMode (Android-only)', DeviceInfo.isAirplaneMode],
        ['isLocationEnabled', DeviceInfo.isLocationEnabled],
        ['isHeadphonesConnected (mobile-only)', DeviceInfo.isHeadphonesConnected],
        ['isWiredHeadphonesConnected (mobile-only)', DeviceInfo.isWiredHeadphonesConnected],
        ['isBluetoothHeadphonesConnected (mobile-only)', DeviceInfo.isBluetoothHeadphonesConnected],
        // ── ABIs ──────────────────────────────────────────────────
        ['supportedAbis', DeviceInfo.supportedAbis],
        ['supported32BitAbis (Android-only)', DeviceInfo.supported32BitAbis],
        ['supported64BitAbis', DeviceInfo.supported64BitAbis],
        // ── misc ──────────────────────────────────────────────────
        ['getFontScale', DeviceInfo.getFontScale],
        ['getAvailableLocationProviders', DeviceInfo.getAvailableLocationProviders],
        ['getSupportedMediaTypeList (Android-only)', DeviceInfo.getSupportedMediaTypeList],
      ];
      for (const [name, fn] of getters) {
        try {
          const v = typeof fn === 'function' ? await fn() : undefined;
          out[name] = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
        } catch (e) {
          out[name] = `<threw: ${(e as Error).message}>`;
        }
      }
      setInfo(out);
    }
    load();
  }, []);

  return (
    <View style={styles.demo}>
      <Text style={styles.demoCaption}>
        Every getter from react-native-device-info. Values are the library's "unknown" JS fallbacks
        — no native bridge yet, so brand/model/OS/etc. are all placeholders.
      </Text>
      {Object.entries(info).map(([k, v]) => (
        <Text key={k} style={styles.demoLine}>
          {k} = {String(v)}
        </Text>
      ))}
    </View>
  );
}

// ─────────────────────────── SafeAreaContext ───────────────────────────
// Mounted INSIDE a SafeAreaProvider — calling the hooks at the root
// section level (no provider ancestor) returns the static context
// defaults, which would lie about what real apps observe.
function SafeAreaInner() {
  const insets = SafeAreaContext.useSafeAreaInsets();
  const frame = SafeAreaContext.useSafeAreaFrame();
  return (
    <View style={styles.demo}>
      <Text style={styles.demoCaption}>
        Mounted under a real SafeAreaProvider. On Linux there's no notch / status bar / gesture-area
        to inset around, so every edge reports 0; the frame mirrors the live window-content
        dimensions (useWindowDimensions inside the shim).
      </Text>
      <Text style={styles.demoLine}>
        useSafeAreaInsets = top:{insets.top} right:{insets.right} bottom:{insets.bottom} left:
        {insets.left}
      </Text>
      <Text style={styles.demoLine}>
        useSafeAreaFrame = x:{frame.x} y:{frame.y} w:{frame.width} h:{frame.height}
      </Text>
      <SafeAreaContext.SafeAreaView edges={['top', 'bottom']} style={styles.safeBox}>
        <Text style={styles.demoLine}>
          SafeAreaView edges=[top, bottom] — no visible inset on Linux
        </Text>
      </SafeAreaContext.SafeAreaView>
    </View>
  );
}

function SafeAreaDemo() {
  // Upstream's SafeAreaProvider defaults to flex:1 (intended for app
  // root). Inside a content-sized card it collapses to 0 height.
  return (
    <SafeAreaContext.SafeAreaProvider style={{flex: 0}}>
      <SafeAreaInner />
    </SafeAreaContext.SafeAreaProvider>
  );
}

// ─────────────────────────── Expo modules placeholder ───────────────────────────
function ExpoModulePlaceholder({lib, hint}: {lib: string; hint: string}) {
  return (
    <View style={styles.demo}>
      <Text style={styles.demoCaption}>
        {lib} calls requireNativeModule() at import time, which throws because there's no native
        module registered for it. {hint}
      </Text>
      <Text style={styles.demoLine}>
        Gap: wire expo-modules-core to a Linux native registry so individual expo packages can
        self-register.
      </Text>
    </View>
  );
}

// ─────────────────────────── Root ───────────────────────────
function SmokeDemo() {
  const [probes, setProbes] = useState<Probe[]>([]);

  useEffect(() => {
    const runs = [
      tryProbe('@react-native-async-storage/async-storage', async function asyncStorageProbe() {
        const stamp = String(Date.now());
        await AsyncStorage.setItem('rnl-smoke', stamp);
        const v = await AsyncStorage.getItem('rnl-smoke');
        if (v !== stamp) throw new Error(`roundtrip mismatch: wrote ${stamp}, read ${v}`);
        return `persisted ${stamp}`;
      }),
      tryProbe('react-native-device-info', async function deviceInfoProbe() {
        const brand = await DeviceInfo.getBrand?.();
        const model = await DeviceInfo.getModel?.();
        const sys = await DeviceInfo.getSystemName?.();
        if (brand == null && model == null && sys == null) {
          throw new Error('all getters returned null (native module missing)');
        }
        return `brand=${brand} model=${model} sys=${sys}`;
      }),
      tryProbe('react-native-safe-area-context', async function safeAreaProbe() {
        // forwardRef components are objects (not functions) — check for
        // truthy + react $$typeof tag rather than typeof === 'function'.
        const haveProvider = !!SafeAreaContext.SafeAreaProvider;
        const haveView = !!SafeAreaContext.SafeAreaView;
        const haveHook = typeof SafeAreaContext.useSafeAreaInsets === 'function';
        if (!haveProvider || !haveHook || !haveView) {
          throw new Error(`missing: provider=${haveProvider} view=${haveView} hook=${haveHook}`);
        }
        const m = SafeAreaContext.initialWindowMetrics;
        return `insets=${JSON.stringify(m?.insets)} frame=${JSON.stringify(m?.frame)}`;
      }),
      tryProbe('expo-camera', async function cameraProbe() {
        const cam = require('expo-camera');
        const Camera = cam.Camera ?? cam.default;
        if (!Camera) throw new Error(`Camera export missing (keys: ${Object.keys(cam).join(',')})`);
        const perms = await Camera.requestCameraPermissionsAsync?.();
        return `perms=${perms?.status ?? 'n/a (no native module)'}`;
      }),
      tryProbe('expo-location', async function locationProbe() {
        const loc = require('expo-location');
        if (typeof loc.requestForegroundPermissionsAsync !== 'function') {
          throw new Error(
            `requestForegroundPermissionsAsync missing (keys: ${Object.keys(loc).join(',')})`,
          );
        }
        const perms = await loc.requestForegroundPermissionsAsync();
        return `perms=${perms?.status ?? 'n/a'}`;
      }),
    ];
    Promise.all(runs).then(setProbes);
  }, []);

  const byName = Object.fromEntries(probes.map(p => [p.name, p]));
  const pending = (name: string): Probe => byName[name] ?? {name, status: 'pending', detail: ''};

  return (
    <SafeAreaView style={styles.app}>
      <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>react-native-linux · smoke test</Text>
        <Text style={styles.hint}>
          Each section probes a library at runtime then mounts a live UI. Anything red is a gap to
          file.
        </Text>

        <View style={styles.section}>
          <ProbeRow probe={pending('@react-native-async-storage/async-storage')} />
          <AsyncStorageDemo />
        </View>

        <View style={styles.section}>
          <ProbeRow probe={pending('react-native-device-info')} />
          <DeviceInfoDemo />
        </View>

        <View style={styles.section}>
          <ProbeRow probe={pending('react-native-safe-area-context')} />
          <SafeAreaDemo />
        </View>

        <View style={styles.section}>
          <ProbeRow probe={pending('expo-camera')} />
          <ExpoModulePlaceholder
            lib="expo-camera"
            hint="Would render a CameraView with live video preview here."
          />
        </View>

        <View style={styles.section}>
          <ProbeRow probe={pending('expo-location')} />
          <ExpoModulePlaceholder
            lib="expo-location"
            hint="Would request foreground permissions then call getCurrentPositionAsync()."
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: {flex: 1, backgroundColor: '#fafafa'},
  scrollOuter: {flex: 1},
  scroll: {padding: 16, gap: 16, paddingBottom: 32},
  title: {fontSize: 20, fontWeight: '600'},
  hint: {color: '#666'},
  section: {
    backgroundColor: '#fff',
    borderRadius: 6,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  probeRow: {flexDirection: 'row', gap: 12, alignItems: 'flex-start'},
  status: {fontSize: 18, width: 20},
  ok: {color: '#16a34a'},
  fail: {color: '#dc2626'},
  probeName: {fontFamily: 'monospace', fontSize: 14},
  probeDetail: {color: '#444', fontSize: 12, marginTop: 4},
  demo: {gap: 6, marginTop: 4},
  demoCaption: {color: '#555', fontSize: 12, lineHeight: 16},
  demoLine: {fontSize: 13},
  mono: {fontFamily: 'monospace'},
  safeBox: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d4d4d4',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  row: {flexDirection: 'row', gap: 8},
  btn: {
    backgroundColor: '#4f46e5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  btnText: {color: '#fff', fontSize: 13},
});

registerRootComponent(SmokeDemo);
