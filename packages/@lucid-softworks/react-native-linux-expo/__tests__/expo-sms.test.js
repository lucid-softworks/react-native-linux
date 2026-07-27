'use strict';

function freshShim() {
  delete globalThis.expo;
  delete globalThis.rnLinux;
  globalThis.rnLinux = {log: () => {}};
  jest.resetModules();
  return require('../expo-sms');
}

describe('expo-sms shim', () => {
  test('isAvailableAsync resolves to false', async () => {
    const sms = freshShim();
    await expect(sms.isAvailableAsync()).resolves.toBe(false);
  });

  test('sendSMSAsync throws UnavailabilityError', async () => {
    const sms = freshShim();
    await expect(sms.sendSMSAsync(['555'], 'hi')).rejects.toMatchObject({
      code: 'ERR_UNAVAILABLE',
      message: expect.stringContaining('expo-sms'),
    });
  });

  test('registers as ExpoSMS via registerExpoModule', () => {
    delete globalThis.expo;
    delete globalThis.rnLinux;
    globalThis.rnLinux = {log: () => {}};
    jest.resetModules();

    const mockRegister = jest.fn();
    jest.doMock('../expo-modules-core', () => ({
      registerExpoModule: mockRegister,
    }));

    const _sms = require('../expo-sms');
    expect(mockRegister).toHaveBeenCalledWith('ExpoSMS', expect.any(Object));
  });
});
