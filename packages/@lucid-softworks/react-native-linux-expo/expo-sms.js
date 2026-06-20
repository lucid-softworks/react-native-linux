'use strict';

// Shim for `expo-sms`. SMS is a telephony concept with no desktop
// equivalent — Linux machines don't have a SIM card or cellular
// modem. Rather than faking success, we match upstream's own
// behavior on unsupported platforms (web/simulator):
//
//   * `isAvailableAsync()` → false
//   * `sendSMSAsync()` → throws UnavailabilityError
//
// Cross-platform code that checks `isAvailableAsync` before sending
// will follow the "no SMS hardware" path naturally.

class CodedError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'CodedError';
  }
}

class UnavailabilityError extends CodedError {
  constructor(moduleName, propertyName) {
    super(
      'ERR_UNAVAILABLE',
      `The method or property ${moduleName}.${propertyName} is not available on Linux, ` +
        `are you sure you've linked all the native dependencies properly?`,
    );
  }
}

async function isAvailableAsync() {
  return false;
}

async function sendSMSAsync(_addresses, _message, _options) {
  throw new UnavailabilityError('expo-sms', 'sendSMSAsync');
}

const api = {
  isAvailableAsync,
  sendSMSAsync,
};

try {
  const {registerExpoModule} = require('./expo-modules-core');
  registerExpoModule('ExpoSMS', api);
} catch (_) {
  /* expo-modules-core not loaded in this context */
}

module.exports = api;
module.exports.default = api;
