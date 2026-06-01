'use strict';

// socket.io-client shim. Returns a Socket-like event emitter that
// reports `connected = false` and never fires server events. Real
// apps that subscribe `socket.on('event', cb)` get registered
// listeners that simply never fire — UI initial state renders, no
// crash on the import or `io(url)` call.

function makeSocket() {
  const listeners = new Map();
  const managerListeners = new Map();
  // `socket.io` is the underlying Manager. Real socket.io-client
  // exposes its raw open/close/reconnect events through this nested
  // surface; apps subscribe via `socket.io.on('open', cb)`. Returning
  // an event-emitter-like object keeps that chain alive even though
  // we never fire the events.
  const manager = {
    on(event, cb) {
      const arr = managerListeners.get(event) || [];
      arr.push(cb);
      managerListeners.set(event, arr);
      return manager;
    },
    off(event, cb) {
      const arr = managerListeners.get(event);
      if (arr) {
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      }
      return manager;
    },
    open() {
      return manager;
    },
    close() {
      return manager;
    },
    socket() {
      return makeSocket();
    },
    reconnection() {
      return manager;
    },
    reconnectionAttempts() {
      return manager;
    },
    reconnectionDelay() {
      return manager;
    },
  };
  return {
    connected: false,
    disconnected: true,
    id: null,
    io: manager,
    on(event, cb) {
      const arr = listeners.get(event) || [];
      arr.push(cb);
      listeners.set(event, arr);
      return this;
    },
    once(event, cb) {
      const wrap = (...args) => {
        this.off(event, wrap);
        cb(...args);
      };
      return this.on(event, wrap);
    },
    off(event, cb) {
      const arr = listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(cb);
        if (idx >= 0) arr.splice(idx, 1);
      }
      return this;
    },
    emit() {
      return this;
    },
    connect() {
      return this;
    },
    disconnect() {
      return this;
    },
    close() {
      return this;
    },
    removeAllListeners(event) {
      if (event) listeners.delete(event);
      else listeners.clear();
      return this;
    },
  };
}

function io(_url, _opts) {
  return makeSocket();
}

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.io = io;
module.exports.connect = io;
module.exports.Manager = function () {
  return {socket: () => makeSocket()};
};
module.exports.Socket = makeSocket;
module.exports.default = io;
