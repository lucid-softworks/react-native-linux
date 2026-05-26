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
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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

// ─────────────────────────── expo-location ───────────────────────────
// Real GeoClue2-backed location via the rnLinux.location* JSI
// bindings. Coordinates come from whatever sources GeoClue can find
// (static-source file under /etc/geolocation, network NMEA, modem
// GPS, etc.). On a fresh dev VM we expect 0/0 until /etc/geolocation
// is populated or a real source is wired.
function ExpoLocationDemo() {
  const ExpoLocation = require('expo-location');
  const [status, setStatus] = useState<'loading' | 'ok' | 'err'>('loading');
  const [coords, setCoords] = useState<null | {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    altitude: number;
  }>(null);
  const [err, setErr] = useState<string>('');
  const [tick, setTick] = useState(0);

  async function fetchOnce() {
    setStatus('loading');
    setErr('');
    try {
      const loc = await ExpoLocation.getCurrentPositionAsync({});
      setCoords({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy,
        altitude: loc.coords.altitude,
      });
      setStatus('ok');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStatus('err');
    }
  }

  useEffect(() => {
    fetchOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return (
    <View style={styles.demo}>
      <Text style={styles.demoCaption}>
        Real GeoClue2 client via DBus. First fix usually arrives within ~200ms once the daemon's
        agent is registered. Coordinates depend on whichever GeoClue source is active (static file,
        NMEA, modem GPS).
      </Text>
      {status === 'loading' ? (
        <Text style={styles.demoLine}>fetching fix from GeoClue…</Text>
      ) : null}
      {coords ? (
        <>
          <Text style={styles.demoLine}>
            lat={coords.latitude.toFixed(4)} lon={coords.longitude.toFixed(4)}
          </Text>
          <Text style={styles.demoLine}>
            accuracy={coords.accuracy != null ? `${coords.accuracy.toFixed(0)}m` : 'unknown'}{' '}
            altitude=
            {coords.altitude.toFixed(1)}m
          </Text>
        </>
      ) : null}
      {err ? <Text style={[styles.demoLine, styles.fail]}>{err}</Text> : null}
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={() => setTick(t => t + 1)}>
          <Text style={styles.btnText}>refresh</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────── expo-camera ───────────────────────────
// Real GStreamer pipeline behind <CameraView> (videotestsrc pattern
// "ball" on dev VMs with no /dev/video*, v4l2src otherwise). The
// snap button runs a separate one-shot pipeline that writes a PNG;
// we render it inline via <Image> so the round-trip is visible.
function ExpoCameraDemo() {
  const ExpoCamera = require('expo-camera');
  const [snapUri, setSnapUri] = useState<string | null>(null);
  const [snapErr, setSnapErr] = useState<string>('');
  const [pending, setPending] = useState(false);

  async function snap() {
    setPending(true);
    setSnapErr('');
    try {
      const r = await ExpoCamera.takePictureAsync({});
      setSnapUri(r.uri);
    } catch (e) {
      setSnapErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <View style={styles.demo}>
      <Text style={styles.demoCaption}>
        Live GStreamer preview into a GtkPicture (videotestsrc pattern on dev VMs without
        /dev/video*, v4l2src on real hardware). Snap runs a one-shot pngenc pipeline; the resulting
        PNG is rendered inline below.
      </Text>
      <View style={{height: 200, backgroundColor: '#000', borderRadius: 4, overflow: 'hidden'}}>
        <ExpoCamera.CameraView style={{flex: 1}} />
      </View>
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={snap} disabled={pending}>
          <Text style={styles.btnText}>{pending ? 'snapping…' : 'snap'}</Text>
        </Pressable>
      </View>
      {snapUri ? (
        <>
          <Text style={styles.demoLine}>{snapUri}</Text>
          <Image source={{uri: snapUri}} style={{width: 160, height: 120, marginTop: 4}} />
        </>
      ) : null}
      {snapErr ? <Text style={[styles.demoLine, styles.fail]}>{snapErr}</Text> : null}
    </View>
  );
}

// ─────────────────────────── expo-haptics ───────────────────────────
// gdk_display_beep on every kind. The WM / sound theme decides
// whether you hear anything; on a Lima VM with no audio sink it
// fires silently.
function ExpoHapticsDemo() {
  const Haptics = require('expo-haptics');
  const [last, setLast] = useState<string>('(none)');
  const buttons: Array<[string, () => Promise<unknown>]> = [
    ['impact light', () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)],
    ['impact heavy', () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)],
    ['notify success', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)],
    ['selection', () => Haptics.selectionAsync()],
  ];
  return (
    <View style={styles.demo}>
      <Text style={styles.demoCaption}>
        gdk_display_beep on every kind. WM/sound theme decides whether you hear anything.
      </Text>
      <View style={styles.row}>
        {buttons.map(([label, fn]) => (
          <Pressable
            key={label}
            style={styles.btn}
            onPress={async () => {
              await fn();
              setLast(label);
            }}>
            <Text style={styles.btnText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.demoLine}>last: {last}</Text>
    </View>
  );
}

// ─────────────────────────── expo-localization ───────────────────────────
// Pure libc + sysfs reads — no daemon involved. Locale parsing
// from LC_ALL/LANG, currency / separators via nl_langinfo, IANA
// timezone from /etc/timezone, plus CLDR-equivalent region
// heuristics for metric/imperial/RTL/temperature.
function ExpoLocalizationDemo() {
  const Localization = require('expo-localization');
  const cals = Localization.getCalendars();
  const lines = [
    `locale = ${Localization.locale}`,
    `locales = ${JSON.stringify(Localization.locales)}`,
    `region = ${Localization.region ?? '(none)'}  currency = ${Localization.currency ?? '(none)'}`,
    `decimal = "${Localization.decimalSeparator}"  grouping = "${Localization.digitGroupingSeparator}"`,
    `measurement = ${Localization.measurementSystem}  temperature = ${Localization.temperatureUnit}`,
    `timezone = ${Localization.timezone}  isRTL = ${Localization.isRTL}`,
    `calendars = ${cals.map((c: any) => c.calendar).join(', ')}`,
  ];
  return (
    <View style={styles.demo}>
      <Text style={styles.demoCaption}>
        Snapshot from libc (LC_ALL/LANG, nl_langinfo) + /etc/timezone + tiny CLDR-equivalent region
        tables for metric/imperial/RTL/temperature.
      </Text>
      {lines.map((l, i) => (
        <Text key={i} style={styles.demoLine}>
          {l}
        </Text>
      ))}
    </View>
  );
}

// ─────────────────────────── expo-secure-store ───────────────────────────
// libsecret round-trip. Writes a fresh token into the secret
// service, reads it back, lists what's stored under our schema,
// then deletes. Real values live in the user's keyring
// (gnome-keyring / kwallet / KeePassXC) — same place Firefox,
// Chrome, and the rest of the desktop hold credentials.
function ExpoSecureStoreDemo() {
  const SecureStore = require('expo-secure-store');
  const [state, setState] = useState<string>('(idle)');
  const [err, setErr] = useState<string>('');

  async function go() {
    setErr('');
    setState('working…');
    try {
      const available = await SecureStore.isAvailableAsync();
      if (!available) {
        setState('keyring daemon not running');
        return;
      }
      const key = 'rnl-demo-token';
      const value = `secret-${Math.random().toString(36).slice(2, 10)}`;
      await SecureStore.setItemAsync(key, value);
      const got = await SecureStore.getItemAsync(key);
      await SecureStore.deleteItemAsync(key);
      const after = await SecureStore.getItemAsync(key);
      setState(
        `set+get matched (${got === value ? 'yes' : 'no'}), after-delete=${after === null ? 'null' : after}`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.demo}>
      <Text style={styles.demoCaption}>
        libsecret over the session bus → the user's keyring (gnome-keyring / kwallet / KeePassXC).
        Default ("login") collection is used when available; falls back to the in-memory session
        collection on headless / VM sessions.
      </Text>
      <Text style={styles.demoLine}>{state}</Text>
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={go}>
          <Text style={styles.btnText}>re-run round-trip</Text>
        </Pressable>
      </View>
      {err ? <Text style={[styles.demoLine, styles.fail]}>{err}</Text> : null}
    </View>
  );
}

// ─────────────────────────── expo-clipboard ───────────────────────────
// GdkClipboard round-trip. The "copy timestamp" button writes a
// fresh tag; the "paste" button reads back whatever's on the
// display clipboard, including text put there by other apps.
function ExpoClipboardDemo() {
  const Clipboard = require('expo-clipboard');
  const [last, setLast] = useState<string>('(empty)');
  const [err, setErr] = useState<string>('');

  async function copyStamp() {
    setErr('');
    try {
      const stamp = `rn-linux ${new Date().toISOString()}`;
      await Clipboard.setStringAsync(stamp);
      setLast(`copied: ${stamp}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function paste() {
    setErr('');
    try {
      const v = await Clipboard.getStringAsync();
      setLast(v ? `read: ${v}` : '(clipboard returned empty)');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={styles.demo}>
      <Text style={styles.demoCaption}>
        Display-level clipboard via GdkClipboard. Set is sync; reads of values written by other apps
        need the async read_text path which isn't bound yet (sync fallback returns "").
      </Text>
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={copyStamp}>
          <Text style={styles.btnText}>copy timestamp</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={paste}>
          <Text style={styles.btnText}>paste</Text>
        </Pressable>
      </View>
      <Text style={styles.demoLine}>{last}</Text>
      {err ? <Text style={[styles.demoLine, styles.fail]}>{err}</Text> : null}
    </View>
  );
}

// ─────────────────────────── expo-file-system ───────────────────────────
// Real POSIX file IO. On mount: write a tagged file under
// documentDirectory, read it back, list the dir, surface the
// round-trip. Proves the C++ ↔ JS path including the file:// URI
// stripping handled by the shim.
function ExpoFileSystemDemo() {
  const FS = require('expo-file-system');
  const [report, setReport] = useState<string>('');
  const [err, setErr] = useState<string>('');

  useEffect(() => {
    async function go() {
      try {
        const dir = FS.documentDirectory;
        const filename = `rnl-fs-smoke-${Date.now()}.txt`;
        const uri = dir + filename;
        const payload = `hello from rn-linux at ${new Date().toISOString()}`;
        await FS.writeAsStringAsync(uri, payload);
        await FS.readAsStringAsync(uri); // round-trip
        const info = await FS.getInfoAsync(uri);
        const list = await FS.readDirectoryAsync(dir);
        const recent = list.filter((n: string) => n.startsWith('rnl-fs-smoke-')).slice(-3);
        setReport(
          `wrote+read ${payload.length} bytes  size=${info.size}  ` +
            `${recent.length}/${list.length} entries match prefix`,
        );
        // Clean up the file we wrote so the dir doesn't grow
        // unbounded across smoke runs.
        await FS.deleteAsync(uri, {idempotent: true});
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }
    go();
  }, [FS]);

  return (
    <View style={styles.demo}>
      <Text style={styles.demoCaption}>
        POSIX read/write/getInfo/readDir round-trip into{' '}
        {FS.documentDirectory ?? '(no documentDirectory)'}. Files use the {'file://'} scheme; the
        shim strips it before reaching C++.
      </Text>
      {report ? <Text style={styles.demoLine}>{report}</Text> : null}
      {err ? <Text style={[styles.demoLine, styles.fail]}>{err}</Text> : null}
    </View>
  );
}

// ─────────────────────────── expo-notifications ───────────────────────────
// Real libnotify-backed local notifications. "Present" fires
// immediately; "Schedule 3s" wires through g_timeout_add. The
// response listener fires when the user dismisses the bubble (close
// signal from the freedesktop notifications spec).
function ExpoNotificationsDemo() {
  const ExpoNotifications = require('expo-notifications');
  const [lastAction, setLastAction] = useState<string>('(none yet)');
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const sub = ExpoNotifications.addNotificationResponseReceivedListener((r: any) => {
      setLastAction(`${r.actionIdentifier} on ${r.notification.request.identifier}`);
    });
    return () => sub.remove();
  }, [ExpoNotifications]);

  async function presentNow() {
    await ExpoNotifications.scheduleNotificationAsync({
      content: {title: 'Hello from RN-Linux', body: 'Fired via libnotify on the session bus.'},
      trigger: null,
    });
  }

  async function schedule3s() {
    await ExpoNotifications.scheduleNotificationAsync({
      content: {title: 'Scheduled notification', body: 'Delayed 3 seconds via g_timeout_add.'},
      trigger: {seconds: 3},
    });
    refreshPending();
  }

  async function cancelAll() {
    await ExpoNotifications.cancelAllScheduledNotificationsAsync();
    refreshPending();
  }

  async function refreshPending() {
    const list = await ExpoNotifications.getAllScheduledNotificationsAsync();
    setPending(list.length);
  }

  return (
    <View style={styles.demo}>
      <Text style={styles.demoCaption}>
        Local notifications via libnotify (org.freedesktop.Notifications). The visible bubble is
        whatever daemon the desktop is running — gnome-shell, xfce4-notifyd, mako, dunst, etc.
        Dismissing it fires the response listener below.
      </Text>
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={presentNow}>
          <Text style={styles.btnText}>present</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={schedule3s}>
          <Text style={styles.btnText}>schedule 3s</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={cancelAll}>
          <Text style={styles.btnText}>cancel all</Text>
        </Pressable>
      </View>
      <Text style={styles.demoLine}>pending: {pending}</Text>
      <Text style={styles.demoLine}>last response: {lastAction}</Text>
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
        if (typeof cam.requestCameraPermissionsAsync !== 'function') {
          throw new Error(
            `requestCameraPermissionsAsync missing (keys: ${Object.keys(cam).join(',')})`,
          );
        }
        const perms = await cam.requestCameraPermissionsAsync();
        const has = await cam.isAvailableAsync();
        return `perms=${perms?.status ?? 'n/a'} native=${has ? 'on' : 'off'}`;
      }),
      tryProbe('expo-location', async function locationProbe() {
        const loc = require('expo-location');
        if (typeof loc.requestForegroundPermissionsAsync !== 'function') {
          throw new Error(
            `requestForegroundPermissionsAsync missing (keys: ${Object.keys(loc).join(',')})`,
          );
        }
        const perms = await loc.requestForegroundPermissionsAsync();
        const services = await loc.hasServicesEnabledAsync();
        return `perms=${perms?.status ?? 'n/a'} services=${services ? 'on' : 'off'}`;
      }),
      tryProbe('expo-notifications', async function notificationsProbe() {
        const n = require('expo-notifications');
        if (typeof n.scheduleNotificationAsync !== 'function') {
          throw new Error(`scheduleNotificationAsync missing (keys: ${Object.keys(n).join(',')})`);
        }
        const perms = await n.requestPermissionsAsync();
        return `perms=${perms?.status ?? 'n/a'}`;
      }),

      // ─── Backlog probes (stub shims; see TODO.md). Each fires a
      // representative method on the import — the Proxy throws with a
      // clean "not yet implemented" message that surfaces here.
      tryProbe('expo-clipboard', async function p() {
        const m = require('expo-clipboard');
        const stamp = `rnl-clip-${Date.now()}`;
        await m.setStringAsync(stamp);
        const got = await m.getStringAsync();
        if (got !== stamp) throw new Error(`roundtrip: wrote ${stamp}, read ${got}`);
        return `roundtripped ${stamp.length} chars`;
      }),
      tryProbe('expo-localization', async function p() {
        const m = require('expo-localization');
        if (!m.locale) throw new Error('locale missing');
        return `locale=${m.locale} region=${m.region ?? '?'} tz=${m.timezone}`;
      }),
      tryProbe('expo-haptics', async function p() {
        const m = require('expo-haptics');
        await m.impactAsync(m.ImpactFeedbackStyle.Medium);
        return 'beeped (display bell)';
      }),
      tryProbe('expo-keep-awake', async function p() {
        const m = require('expo-keep-awake');
        await m.activateKeepAwakeAsync('rnl-smoke');
        return 'inhibit-on';
      }),
      tryProbe('expo-file-system', async function p() {
        const m = require('expo-file-system');
        if (!m.documentDirectory) throw new Error('documentDirectory missing');
        const info = await m.getInfoAsync(m.documentDirectory);
        return `documentDirectory=${m.documentDirectory} exists=${info.exists}`;
      }),
      tryProbe('expo-secure-store', async function p() {
        const m = require('expo-secure-store');
        const available = await m.isAvailableAsync();
        if (!available) return 'service unavailable (no keyring daemon)';
        const key = 'rnl-smoke-secret';
        const value = `rnl-${Date.now()}`;
        await m.setItemAsync(key, value);
        const got = await m.getItemAsync(key);
        await m.deleteItemAsync(key);
        if (got !== value) throw new Error(`roundtrip: wrote ${value}, read ${got}`);
        return `roundtripped ${value.length} chars via keyring`;
      }),
      tryProbe('expo-network', async function p() {
        const m = require('expo-network');
        const s = await m.getNetworkStateAsync();
        return `state=${JSON.stringify(s)}`;
      }),
      tryProbe('expo-image', async function p() {
        const m = require('expo-image');
        if (!m.Image) throw new Error('Image export missing');
        return 'has-Image';
      }),
      tryProbe('expo-document-picker', async function p() {
        const m = require('expo-document-picker');
        if (typeof m.getDocumentAsync !== 'function') throw new Error('getDocumentAsync missing');
        return 'wired';
      }),
      tryProbe('expo-image-picker', async function p() {
        const m = require('expo-image-picker');
        if (typeof m.launchImageLibraryAsync !== 'function')
          throw new Error('launchImageLibraryAsync missing');
        return 'wired';
      }),
      tryProbe('expo-sharing', async function p() {
        const m = require('expo-sharing');
        const ok = await m.isAvailableAsync();
        return `available=${ok}`;
      }),
      tryProbe('expo-battery', async function p() {
        const m = require('expo-battery');
        const lvl = await m.getBatteryLevelAsync();
        return `level=${lvl}`;
      }),
      tryProbe('expo-print', async function p() {
        const m = require('expo-print');
        if (typeof m.printAsync !== 'function') throw new Error('printAsync missing');
        return 'wired';
      }),
      tryProbe('expo-screen-capture', async function p() {
        const m = require('expo-screen-capture');
        await m.preventScreenCaptureAsync();
        return 'wired';
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
          <ExpoCameraDemo />
        </View>

        <View style={styles.section}>
          <ProbeRow probe={pending('expo-location')} />
          <ExpoLocationDemo />
        </View>

        <View style={styles.section}>
          <ProbeRow probe={pending('expo-notifications')} />
          <ExpoNotificationsDemo />
        </View>

        <View style={styles.section}>
          <ProbeRow probe={pending('expo-file-system')} />
          <ExpoFileSystemDemo />
        </View>

        <View style={styles.section}>
          <ProbeRow probe={pending('expo-clipboard')} />
          <ExpoClipboardDemo />
        </View>

        <View style={styles.section}>
          <ProbeRow probe={pending('expo-secure-store')} />
          <ExpoSecureStoreDemo />
        </View>

        <View style={styles.section}>
          <ProbeRow probe={pending('expo-localization')} />
          <ExpoLocalizationDemo />
        </View>

        <View style={styles.section}>
          <ProbeRow probe={pending('expo-haptics')} />
          <ExpoHapticsDemo />
        </View>

        {/* Backlog rows — each is a stub shim awaiting a real
            Linux backend. The probe's ✗ surfaces what's pending; see
            docs/realworld-*.md and TODO.md as each one lands. */}
        <View style={styles.section}>
          <Text style={styles.title}>Backlog</Text>
          <Text style={styles.hint}>
            Stub shims wired through metro/esbuild — `require()` returns a Proxy that throws on
            access so apps don't crash at load time. Each row below is a planned full Linux
            implementation; see TODO.md "Expo module backlog" for the backend per module.
          </Text>
        </View>
        {[
          'expo-keep-awake',
          'expo-network',
          'expo-image',
          'expo-document-picker',
          'expo-image-picker',
          'expo-sharing',
          'expo-battery',
          'expo-print',
          'expo-screen-capture',
        ].map(name => (
          <View key={name} style={styles.section}>
            <ProbeRow probe={pending(name)} />
          </View>
        ))}
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
