'use strict';

// Tests for the `expo-modules-core` shim
// (../expo-modules-core.js). The shim provides the
// `requireNativeModule(name)` lookup third-party Expo packages from npm
// reach for at module-load time. Without it, every Expo package crashes
// before any user code runs.

// Reset module cache + the global registry between cases so each test
// sees a clean slate. `globalThis.expo` is the persistent registry the
// shim bootstraps; we let the shim recreate it on the next require.
function freshShim() {
  // jest doesn't auto-clear globalThis.expo between tests.
  delete globalThis.expo;
  delete globalThis.rnLinux;
  globalThis.rnLinux = {log: () => {}};
  jest.resetModules();
  return require('../expo-modules-core');
}

describe('expo-modules-core shim', () => {
  test('exposes the upstream surface', () => {
    const shim = freshShim();
    const expected = [
      'requireNativeModule',
      'requireOptionalNativeModule',
      'registerExpoModule',
      'EventEmitter',
      'NativeModule',
      'SharedObject',
      'SharedRef',
      'CodedError',
      'UnavailabilityError',
      'useEvent',
      'useEventListener',
    ];
    for (const name of expected) {
      expect(shim[name]).toBeDefined();
    }
  });

  test('hydrates globalThis.expo on first require', () => {
    const shim = freshShim();
    expect(globalThis.expo).toBeDefined();
    expect(globalThis.expo.modules).toBeDefined();
    expect(globalThis.expo.EventEmitter).toBe(shim.EventEmitter);
    expect(globalThis.expo.NativeModule).toBe(shim.NativeModule);
  });

  describe('registerExpoModule + requireNativeModule', () => {
    test('round-trips a registered impl', () => {
      const shim = freshShim();
      const impl = {greet: () => 'hi'};
      shim.registerExpoModule('ExpoTestModule', impl);
      expect(shim.requireNativeModule('ExpoTestModule')).toBe(impl);
    });

    test('requireNativeModule throws on a missing module', () => {
      const shim = freshShim();
      expect(() => shim.requireNativeModule('NotARealModule')).toThrow(
        /Cannot find native module 'NotARealModule'/,
      );
    });

    test('requireOptionalNativeModule returns null on missing', () => {
      const shim = freshShim();
      expect(shim.requireOptionalNativeModule('NotARealModule')).toBeNull();
    });

    test('rejects null / empty name', () => {
      const shim = freshShim();
      expect(() => shim.registerExpoModule('', {})).toThrow();
      expect(() => shim.registerExpoModule('Foo', null)).toThrow();
    });

    test('later register wins (shim ergonomics)', () => {
      const shim = freshShim();
      const first = {tag: 1};
      const second = {tag: 2};
      shim.registerExpoModule('ExpoOverride', first);
      shim.registerExpoModule('ExpoOverride', second);
      expect(shim.requireNativeModule('ExpoOverride')).toBe(second);
    });
  });

  describe('EventEmitter', () => {
    test('add + emit fires the listener', () => {
      const shim = freshShim();
      const ee = new shim.EventEmitter();
      let got = null;
      ee.addListener('boom', v => {
        got = v;
      });
      ee.emit('boom', 42);
      expect(got).toBe(42);
    });

    test('subscription.remove unsubscribes', () => {
      const shim = freshShim();
      const ee = new shim.EventEmitter();
      let count = 0;
      const sub = ee.addListener('tick', () => count++);
      ee.emit('tick');
      sub.remove();
      ee.emit('tick');
      expect(count).toBe(1);
    });

    test('listenerCount tracks subscription count', () => {
      const shim = freshShim();
      const ee = new shim.EventEmitter();
      expect(ee.listenerCount('foo')).toBe(0);
      const sub1 = ee.addListener('foo', () => {});
      const sub2 = ee.addListener('foo', () => {});
      expect(ee.listenerCount('foo')).toBe(2);
      sub1.remove();
      expect(ee.listenerCount('foo')).toBe(1);
      sub2.remove();
      expect(ee.listenerCount('foo')).toBe(0);
    });

    test('removeAllListeners clears one event or everything', () => {
      const shim = freshShim();
      const ee = new shim.EventEmitter();
      ee.addListener('a', () => {});
      ee.addListener('b', () => {});
      ee.removeAllListeners('a');
      expect(ee.listenerCount('a')).toBe(0);
      expect(ee.listenerCount('b')).toBe(1);
      ee.removeAllListeners();
      expect(ee.listenerCount('b')).toBe(0);
    });

    test('emit snapshots listeners — a self-removing listener still fires', () => {
      const shim = freshShim();
      const ee = new shim.EventEmitter();
      let outerCount = 0;
      const sub = ee.addListener('event', () => {
        outerCount++;
        sub.remove();
      });
      ee.emit('event');
      ee.emit('event');
      expect(outerCount).toBe(1);
    });

    test('listener throwing does not stop sibling listeners', () => {
      const shim = freshShim();
      const ee = new shim.EventEmitter();
      let bSaw = false;
      ee.addListener('event', () => {
        throw new Error('first listener bomb');
      });
      ee.addListener('event', () => {
        bSaw = true;
      });
      ee.emit('event');
      expect(bSaw).toBe(true);
    });
  });

  describe('class hierarchy', () => {
    test('NativeModule extends EventEmitter', () => {
      const shim = freshShim();
      expect(new shim.NativeModule()).toBeInstanceOf(shim.EventEmitter);
    });

    test('SharedRef extends SharedObject extends EventEmitter', () => {
      const shim = freshShim();
      const ref = new shim.SharedRef();
      expect(ref).toBeInstanceOf(shim.SharedObject);
      expect(ref).toBeInstanceOf(shim.EventEmitter);
    });

    test('SharedObject.release is a no-op stub', () => {
      const shim = freshShim();
      expect(() => new shim.SharedObject().release()).not.toThrow();
    });
  });

  describe('errors', () => {
    test('CodedError carries the supplied code', () => {
      const shim = freshShim();
      const err = new shim.CodedError('ERR_TEST', 'something blew up');
      expect(err.code).toBe('ERR_TEST');
      expect(err.message).toBe('something blew up');
      expect(err).toBeInstanceOf(Error);
    });

    test('UnavailabilityError carries module.member in its message', () => {
      const shim = freshShim();
      const err = new shim.UnavailabilityError('ExpoFoo', 'doThing');
      expect(err.code).toBe('ERR_UNAVAILABLE');
      expect(err.message).toContain('ExpoFoo.doThing');
      expect(err).toBeInstanceOf(shim.CodedError);
    });
  });
});
