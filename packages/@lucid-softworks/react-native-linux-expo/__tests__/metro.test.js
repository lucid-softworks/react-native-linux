'use strict';

// Tests for the Metro composition helper (../metro.js). The helper is
// the public Metro-layer API rn-linux exposes for slot-in consumers
// (expo-desktop, custom Expo wrappers). It must compose cleanly on
// top of any base config without clobbering upstream resolveRequest
// or other resolver fields.

const {linuxExpoShims, createLinuxResolver, withLinuxExpoShims} = require('../metro');

// A `context` object Metro hands to `resolveRequest`. We stub
// `context.resolveRequest` to record which (name, platform) it was
// called with so the assertions can distinguish "rewritten to shim"
// from "delegated unchanged".
function makeContext() {
  return {
    resolveRequest(_ctx, name, platform) {
      return {viaContext: true, name, platform};
    },
  };
}

describe('linuxExpoShims table', () => {
  test('covers the canonical Expo + RN ecosystem entry points', () => {
    for (const name of [
      'expo',
      'expo-router',
      'expo-status-bar',
      'expo-constants',
      'expo-font',
      'react-native-safe-area-context',
      'react-native-screens',
      'react-native-reanimated',
      '@react-native-community/netinfo',
    ]) {
      expect(linuxExpoShims[name]).toMatch(/^@lucid-softworks\/react-native-linux-expo\//);
    }
  });
});

describe('createLinuxResolver', () => {
  test('rewrites a known linux specifier to the shim path', () => {
    const resolve = createLinuxResolver();
    const ctx = makeContext();
    const out = resolve(ctx, 'expo-router', 'linux');
    expect(out).toEqual({
      viaContext: true,
      name: '@lucid-softworks/react-native-linux-expo/expo-router',
      platform: 'linux',
    });
  });

  test('delegates an unknown linux specifier to the upstream next when present', () => {
    const upstream = jest.fn(() => ({fromUpstream: true}));
    const resolve = createLinuxResolver(upstream);
    const ctx = makeContext();
    const out = resolve(ctx, 'some-untracked-package', 'linux');
    expect(out).toEqual({fromUpstream: true});
    expect(upstream).toHaveBeenCalledWith(ctx, 'some-untracked-package', 'linux');
  });

  test('falls through to context.resolveRequest when no upstream supplied', () => {
    const resolve = createLinuxResolver();
    const ctx = makeContext();
    const out = resolve(ctx, 'react', 'linux');
    expect(out).toEqual({viaContext: true, name: 'react', platform: 'linux'});
  });

  test('non-linux platforms skip the shim table entirely', () => {
    const upstream = jest.fn(() => ({fromUpstream: true}));
    const resolve = createLinuxResolver(upstream);
    const ctx = makeContext();
    resolve(ctx, 'expo-router', 'ios');
    resolve(ctx, 'expo-router', 'android');
    resolve(ctx, 'expo-router', undefined);
    expect(upstream).toHaveBeenCalledTimes(3);
    for (const call of upstream.mock.calls) {
      expect(call[1]).toBe('expo-router');
    }
  });
});

describe('withLinuxExpoShims', () => {
  test('preserves all upstream resolver and transformer fields', () => {
    const blockList = /never/;
    const base = {
      resolver: {
        platforms: ['ios', 'android'],
        blockList,
        extraNodeModules: {foo: '/foo'},
        sourceExts: ['ts', 'tsx', 'js'],
        resolveRequest: (_c, _n, _p) => ({fromUpstream: true}),
      },
      transformer: {babelTransformerPath: '/x'},
      watchFolders: ['/repo'],
    };
    const wrapped = withLinuxExpoShims(base);

    expect(wrapped.resolver.blockList).toBe(blockList);
    expect(wrapped.resolver.extraNodeModules).toEqual({foo: '/foo'});
    expect(wrapped.resolver.sourceExts).toEqual(['ts', 'tsx', 'js']);
    expect(wrapped.transformer).toEqual({babelTransformerPath: '/x'});
    expect(wrapped.watchFolders).toEqual(['/repo']);
  });

  test('injects "linux" into resolver.platforms at the front if missing', () => {
    const wrapped = withLinuxExpoShims({
      resolver: {platforms: ['ios', 'android']},
    });
    expect(wrapped.resolver.platforms).toEqual(['linux', 'ios', 'android']);
  });

  test('leaves resolver.platforms unchanged if "linux" already present', () => {
    const wrapped = withLinuxExpoShims({
      resolver: {platforms: ['linux', 'ios', 'android', 'native']},
    });
    expect(wrapped.resolver.platforms).toEqual(['linux', 'ios', 'android', 'native']);
  });

  test('seeds resolver.platforms with ["linux"] when input has none', () => {
    const wrapped = withLinuxExpoShims({});
    expect(wrapped.resolver.platforms).toEqual(['linux']);
  });

  test('delegates to upstream resolveRequest for linux misses', () => {
    const upstream = jest.fn(() => ({fromUpstream: true}));
    const wrapped = withLinuxExpoShims({
      resolver: {resolveRequest: upstream},
    });
    const ctx = makeContext();
    const out = wrapped.resolver.resolveRequest(ctx, 'react', 'linux');
    expect(out).toEqual({fromUpstream: true});
    expect(upstream).toHaveBeenCalledWith(ctx, 'react', 'linux');
  });

  test('rewrites linux hits even with an upstream resolver set', () => {
    const upstream = jest.fn(() => ({fromUpstream: true}));
    const wrapped = withLinuxExpoShims({
      resolver: {resolveRequest: upstream},
    });
    const ctx = makeContext();
    const out = wrapped.resolver.resolveRequest(ctx, 'expo-router', 'linux');
    expect(out.name).toBe('@lucid-softworks/react-native-linux-expo/expo-router');
    expect(upstream).not.toHaveBeenCalled();
  });

  test('passes non-linux platforms straight through to upstream', () => {
    const upstream = jest.fn(() => ({fromUpstream: true}));
    const wrapped = withLinuxExpoShims({
      resolver: {resolveRequest: upstream},
    });
    const ctx = makeContext();
    wrapped.resolver.resolveRequest(ctx, 'expo-router', 'ios');
    expect(upstream).toHaveBeenCalledWith(ctx, 'expo-router', 'ios');
  });

  test('tolerates an entirely empty input config', () => {
    const wrapped = withLinuxExpoShims();
    expect(wrapped.resolver.platforms).toEqual(['linux']);
    expect(typeof wrapped.resolver.resolveRequest).toBe('function');
  });
});
