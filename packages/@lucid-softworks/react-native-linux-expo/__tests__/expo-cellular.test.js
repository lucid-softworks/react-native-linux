'use strict';

function freshShim() {
  delete globalThis.expo;
  delete globalThis.rnLinux;
  globalThis.rnLinux = {log: () => {}};
  jest.resetModules();
  return require('../expo-cellular');
}

describe('expo-cellular shim', () => {
  test('getCellularGenerationAsync resolves to CellularGeneration.UNKNOWN (0)', async () => {
    const cellular = freshShim();
    await expect(cellular.getCellularGenerationAsync()).resolves.toBe(
      cellular.CellularGeneration.UNKNOWN,
    );
  });

  test('CellularGeneration enum has all 5 values', () => {
    const cellular = freshShim();
    expect(cellular.CellularGeneration).toEqual({
      UNKNOWN: 0,
      CELLULAR_2G: 1,
      CELLULAR_3G: 2,
      CELLULAR_4G: 3,
      CELLULAR_5G: 4,
    });
  });

  test('data getters all resolve to null (no SIM/modem)', async () => {
    const cellular = freshShim();
    await expect(cellular.allowsVoipAsync()).resolves.toBeNull();
    await expect(cellular.getIsoCountryCodeAsync()).resolves.toBeNull();
    await expect(cellular.getCarrierNameAsync()).resolves.toBeNull();
    await expect(cellular.getMobileCountryCodeAsync()).resolves.toBeNull();
    await expect(cellular.getMobileNetworkCodeAsync()).resolves.toBeNull();
  });

  test('getPermissionsAsync returns granted response', async () => {
    const cellular = freshShim();
    await expect(cellular.getPermissionsAsync()).resolves.toEqual({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    });
  });

  test('requestPermissionsAsync returns granted response', async () => {
    const cellular = freshShim();
    await expect(cellular.requestPermissionsAsync()).resolves.toEqual({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    });
  });

  test('usePermissions returns [grantedResponse, requestFn, getFn]', () => {
    const cellular = freshShim();
    const result = cellular.usePermissions();
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    });
    expect(typeof result[1]).toBe('function');
    expect(typeof result[2]).toBe('function');
  });

  test('registers as ExpoCellular via registerExpoModule', () => {
    delete globalThis.expo;
    delete globalThis.rnLinux;
    globalThis.rnLinux = {log: () => {}};
    jest.resetModules();

    const mockRegister = jest.fn();
    jest.doMock('../expo-modules-core', () => ({
      registerExpoModule: mockRegister,
    }));

    const _cellular = require('../expo-cellular');
    expect(mockRegister).toHaveBeenCalledWith('ExpoCellular', expect.any(Object));
  });
});
