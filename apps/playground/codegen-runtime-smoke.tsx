// Runtime verification entry for the codegen smoke specs. Compile-time
// guards (vnext/src/modules/CodegenSmoke.cpp + components/CodegenSmokeView.cpp)
// instantiate every emitted code path, but they don't catch lifetime
// bugs in the runtime-pointer captures (non-void sync callbacks) or
// the Promise resolve flow. This entry dispatches each method of the
// `CodegenSmoke` TurboModule + `PlatformConstants` from JS, logs the
// result of each round-trip, and renders a pass/fail row per probe.
//
// Run via:
//   RN_ENTRY=codegen-runtime-smoke.tsx node apps/playground/bundle.mjs
//   scripts/vm/run-playground.sh
//
// What gets exercised:
//
//   PlatformConstants.getConstants()         — TM, ObjectType return
//   CodegenSmoke.add(a, b)                   — TM, primitive in/out
//   CodegenSmoke.echoUser(user)              — TM, object in + object out (typed struct)
//   CodegenSmoke.ping()                      — TM, Promise<void> resolve
//   CodegenSmoke.fetchUser(id)               — TM, Promise<typed object> resolve
//   CodegenSmoke.subscribe(cb)               — TM, void callback (executor-hopped)
//   CodegenSmoke.observe(cb)                 — TM, void callback with object arg
//   CodegenSmoke.shouldAccept(pred)          — TM, non-void sync callback returning bool

import {useEffect, useState} from 'react';
import {SafeAreaView, ScrollView, StyleSheet, Text, View} from 'react-native';
import {registerRootComponent} from 'expo';
import {TurboModuleRegistry} from 'react-native';

type Status = 'pending' | 'ok' | 'fail';

interface Probe {
  name: string;
  status: Status;
  detail?: string;
}

function ProbeRow({probe}: {probe: Probe}) {
  const icon = probe.status === 'ok' ? '✓' : probe.status === 'fail' ? '✗' : '…';
  const color = probe.status === 'ok' ? '#16a34a' : probe.status === 'fail' ? '#dc2626' : '#a3a3a3';
  return (
    <View style={styles.row}>
      <Text style={[styles.icon, {color}]}>{icon}</Text>
      <View style={styles.rowText}>
        <Text style={styles.rowName}>{probe.name}</Text>
        {probe.detail ? <Text style={styles.rowDetail}>{probe.detail}</Text> : null}
      </View>
    </View>
  );
}

function CodegenRuntimeSmoke() {
  const [probes, setProbes] = useState<Probe[]>([
    {name: 'PlatformConstants.getConstants()', status: 'pending'},
    {name: 'CodegenSmoke.add(2, 40)', status: 'pending'},
    {name: 'CodegenSmoke.echoUser({name, age})', status: 'pending'},
    {name: 'CodegenSmoke.ping() — Promise<void>', status: 'pending'},
    {name: 'CodegenSmoke.fetchUser(id) — Promise<typed object>', status: 'pending'},
    {name: 'CodegenSmoke.subscribe(cb) — void callback', status: 'pending'},
    {name: 'CodegenSmoke.observe(cb) — void callback w/ object arg', status: 'pending'},
    {name: 'CodegenSmoke.shouldAccept(pred) — non-void sync callback', status: 'pending'},
  ]);

  useEffect(() => {
    runProbes(p => {
      setProbes(prev => {
        const next = [...prev];
        const idx = next.findIndex(x => x.name === p.name);
        if (idx >= 0) next[idx] = p;
        return next;
      });
    });
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>codegen runtime smoke</Text>
      <Text style={styles.subtitle}>
        Each row dispatches a generated TM method from JS and confirms the round-trip. ✗ = the
        runtime found a real bug the compile guards couldn't see.
      </Text>
      <ScrollView style={styles.scroll}>
        {probes.map(p => (
          <ProbeRow key={p.name} probe={p} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

async function runProbes(emit: (p: Probe) => void) {
  await probePlatformConstants(emit);
  await probeAdd(emit);
  await probeEchoUser(emit);
  await probePing(emit);
  await probeFetchUser(emit);
  await probeSubscribe(emit);
  await probeObserve(emit);
  await probeShouldAccept(emit);
}

async function probePlatformConstants(emit: (p: Probe) => void) {
  const name = 'PlatformConstants.getConstants()';
  try {
    const mod: any = TurboModuleRegistry.getEnforcing('PlatformConstants');
    const c = mod.getConstants();
    log(`[codegen-smoke] PC: ${JSON.stringify(c)}`);
    if (c?.OS !== 'linux') throw new Error(`OS=${c?.OS}, expected linux`);
    if (typeof c?.osVersion !== 'string')
      throw new Error(`osVersion=${c?.osVersion} (${typeof c?.osVersion})`);
    emit({name, status: 'ok', detail: `OS=${c.OS}, osVersion=${c.osVersion}`});
  } catch (e: any) {
    emit({name, status: 'fail', detail: String(e?.message ?? e)});
  }
}

async function probeAdd(emit: (p: Probe) => void) {
  const name = 'CodegenSmoke.add(2, 40)';
  try {
    const mod: any = TurboModuleRegistry.getEnforcing('CodegenSmoke');
    const result = mod.add(2, 40);
    log(`[codegen-smoke] add(2,40) = ${result}`);
    if (result !== 42) throw new Error(`add returned ${result}, expected 42`);
    emit({name, status: 'ok', detail: `add(2, 40) = ${result}`});
  } catch (e: any) {
    emit({name, status: 'fail', detail: String(e?.message ?? e)});
  }
}

async function probeEchoUser(emit: (p: Probe) => void) {
  const name = 'CodegenSmoke.echoUser({name, age})';
  try {
    const mod: any = TurboModuleRegistry.getEnforcing('CodegenSmoke');
    const result = mod.echoUser({name: 'luna', age: 7});
    log(`[codegen-smoke] echoUser → ${JSON.stringify(result)}`);
    if (result?.name !== 'luna') throw new Error(`name=${result?.name}`);
    if (result?.age !== 7) throw new Error(`age=${result?.age}`);
    if (typeof result?.greeting !== 'string') throw new Error(`greeting=${result?.greeting}`);
    emit({name, status: 'ok', detail: JSON.stringify(result)});
  } catch (e: any) {
    emit({name, status: 'fail', detail: String(e?.message ?? e)});
  }
}

async function probePing(emit: (p: Probe) => void) {
  const name = 'CodegenSmoke.ping() — Promise<void>';
  try {
    const mod: any = TurboModuleRegistry.getEnforcing('CodegenSmoke');
    const start = Date.now();
    await mod.ping();
    const dt = Date.now() - start;
    log(`[codegen-smoke] ping() resolved in ${dt}ms`);
    emit({name, status: 'ok', detail: `resolved in ${dt}ms`});
  } catch (e: any) {
    emit({name, status: 'fail', detail: String(e?.message ?? e)});
  }
}

async function probeFetchUser(emit: (p: Probe) => void) {
  const name = 'CodegenSmoke.fetchUser(id) — Promise<typed object>';
  try {
    const mod: any = TurboModuleRegistry.getEnforcing('CodegenSmoke');
    const result = await mod.fetchUser('luna');
    log(`[codegen-smoke] fetchUser → ${JSON.stringify(result)}`);
    if (typeof result?.name !== 'string') throw new Error(`name=${result?.name}`);
    if (typeof result?.age !== 'number') throw new Error(`age=${result?.age}`);
    emit({name, status: 'ok', detail: JSON.stringify(result)});
  } catch (e: any) {
    emit({name, status: 'fail', detail: String(e?.message ?? e)});
  }
}

async function probeSubscribe(emit: (p: Probe) => void) {
  const name = 'CodegenSmoke.subscribe(cb) — void callback';
  try {
    const mod: any = TurboModuleRegistry.getEnforcing('CodegenSmoke');
    let fired: {eventName: string; count: number} | null = null;
    await new Promise<void>((resolve, reject) => {
      mod.subscribe((eventName: string, count: number) => {
        fired = {eventName, count};
        resolve();
      });
      setTimeout(() => reject(new Error('subscribe cb never fired within 500ms')), 500);
    });
    log(`[codegen-smoke] subscribe cb fired → ${JSON.stringify(fired)}`);
    if (fired === null) throw new Error('cb did not fire');
    emit({name, status: 'ok', detail: JSON.stringify(fired)});
  } catch (e: any) {
    emit({name, status: 'fail', detail: String(e?.message ?? e)});
  }
}

async function probeObserve(emit: (p: Probe) => void) {
  const name = 'CodegenSmoke.observe(cb) — void callback w/ object arg';
  try {
    const mod: any = TurboModuleRegistry.getEnforcing('CodegenSmoke');
    let event: {kind: string; count: number} | null = null;
    await new Promise<void>((resolve, reject) => {
      mod.observe((ev: {kind: string; count: number}) => {
        event = ev;
        resolve();
      });
      setTimeout(() => reject(new Error('observe cb never fired within 500ms')), 500);
    });
    log(`[codegen-smoke] observe event → ${JSON.stringify(event)}`);
    if (event === null) throw new Error('cb did not fire');
    if (typeof (event as any)?.kind !== 'string') throw new Error(`kind=${(event as any)?.kind}`);
    emit({name, status: 'ok', detail: JSON.stringify(event)});
  } catch (e: any) {
    emit({name, status: 'fail', detail: String(e?.message ?? e)});
  }
}

async function probeShouldAccept(emit: (p: Probe) => void) {
  const name = 'CodegenSmoke.shouldAccept(pred) — non-void sync callback';
  try {
    const mod: any = TurboModuleRegistry.getEnforcing('CodegenSmoke');
    let predFired = false;
    let argSeen: string | null = null;
    // The impl calls pred("hello") synchronously and uses its bool
    // return. If the runtime-pointer capture is broken, this either
    // crashes or returns garbage.
    mod.shouldAccept((msg: string) => {
      predFired = true;
      argSeen = msg;
      return msg === 'hello';
    });
    log(`[codegen-smoke] shouldAccept pred fired=${predFired} arg=${argSeen}`);
    if (!predFired) throw new Error('pred never invoked');
    if (argSeen !== 'hello') throw new Error(`pred arg=${argSeen}, expected "hello"`);
    emit({name, status: 'ok', detail: `pred arg="${argSeen}", returned true`});
  } catch (e: any) {
    emit({name, status: 'fail', detail: String(e?.message ?? e)});
  }
}

function log(line: string) {
  // Goes through Hermes' console → rnLinux.log → vnext logging,
  // visible via scripts/vm/sh.sh or run-playground.sh stderr.
  // eslint-disable-next-line no-console
  console.log(line);
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fafafa', paddingHorizontal: 16, paddingTop: 12},
  title: {fontSize: 20, fontWeight: '700', color: '#0a0a0a', marginBottom: 4},
  subtitle: {fontSize: 13, color: '#525252', marginBottom: 16, lineHeight: 18},
  scroll: {flex: 1},
  row: {flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, gap: 12},
  icon: {fontSize: 16, fontWeight: '700', width: 16, textAlign: 'center'},
  rowText: {flex: 1},
  rowName: {fontSize: 14, color: '#0a0a0a', fontWeight: '500'},
  rowDetail: {fontSize: 12, color: '#525252', marginTop: 2, fontFamily: 'monospace'},
});

registerRootComponent(CodegenRuntimeSmoke);
