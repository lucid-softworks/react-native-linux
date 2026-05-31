'use strict';

// expo-sqlite shim. Real implementation backs a sqlite3 database via
// libsqlite3 + the C++ side; that's a meaningful chunk of work
// because expo-sqlite's surface is large (PreparedStatement, batches,
// prepare/runAsync/getFirstAsync/getAllAsync/withTransaction…).
//
// For the smoke-matrix purpose — "did the JS side mount cleanly?" —
// an in-memory stub that satisfies the most-used surface area is
// enough. Apps that actually persist data won't work, but they'll
// at least render their initial state without throwing.
//
// What's stubbed here:
//   * openDatabaseSync / openDatabaseAsync (returns a fake handle)
//   * SQLiteProvider context that returns the handle to children
//   * useSQLiteContext hook
//   * runAsync / getFirstAsync / getAllAsync / execAsync / withTransaction
//     all return empty results (or no-op for run/exec)
//
// Future: bind sqlite3 in C++ and route through, keyed by app-id +
// XDG_DATA_HOME like AsyncStorage already does.

const React = require('react');

function makeDatabase(name) {
  // In-memory key/value store as a transparent fallback for the
  // simplest expo-sqlite usage pattern (single-table reads/writes).
  // Real SQL won't execute, but a key/value getter at least
  // returns something instead of crashing.
  const memory = new Map();
  const db = {
    databaseName: name,
    // Sync APIs.
    runSync(_sql, ..._params) {
      return {lastInsertRowId: 0, changes: 0};
    },
    getFirstSync(_sql, ..._params) {
      return null;
    },
    getAllSync(_sql, ..._params) {
      return [];
    },
    getEachSync: function* () {},
    execSync(_sql) {},
    prepareSync(_sql) {
      return makePreparedStatement();
    },
    withTransactionSync(cb) {
      cb();
    },
    closeSync() {},
    // Async APIs — wrap the sync ones in Promise.resolve. The whole
    // shim runs on the JS thread; no real I/O happens, so the async
    // shape is just to satisfy the API contract.
    runAsync: (sql, ...p) => Promise.resolve(db.runSync(sql, ...p)),
    getFirstAsync: (sql, ...p) => Promise.resolve(db.getFirstSync(sql, ...p)),
    getAllAsync: (sql, ...p) => Promise.resolve(db.getAllSync(sql, ...p)),
    getEachAsync: async function* () {},
    execAsync: sql => Promise.resolve(db.execSync(sql)),
    prepareAsync: sql => Promise.resolve(db.prepareSync(sql)),
    withTransactionAsync: async cb => {
      await cb();
    },
    closeAsync: () => Promise.resolve(),
    // Convenience for the in-memory fallback.
    __memory: memory,
  };
  return db;
}

function makePreparedStatement() {
  return {
    executeSync: () => ({lastInsertRowId: 0, changes: 0}),
    executeAsync: async () => ({lastInsertRowId: 0, changes: 0}),
    finalizeSync: () => {},
    finalizeAsync: async () => {},
  };
}

function openDatabaseSync(name, _options) {
  return makeDatabase(name);
}

function openDatabaseAsync(name, _options) {
  return Promise.resolve(makeDatabase(name));
}

// Provider context — apps wrap their tree in <SQLiteProvider
// databaseName="..."> and consume via useSQLiteContext().
const SQLiteCtx = React.createContext(null);

function SQLiteProvider(props) {
  const dbRef = React.useRef(null);
  if (dbRef.current === null) {
    dbRef.current = makeDatabase(props.databaseName || 'default');
  }
  return React.createElement(SQLiteCtx.Provider, {value: dbRef.current}, props.children);
}

function useSQLiteContext() {
  const ctx = React.useContext(SQLiteCtx);
  if (!ctx) {
    // Falling back to a fresh handle keeps stubbed consumers from
    // throwing — real expo-sqlite throws here, but for smoke we
    // prefer to keep mounting.
    return makeDatabase('default');
  }
  return ctx;
}

// addDatabaseChangeListener — real expo-sqlite emits these on
// WAL-mode commits. Stub returns a subscription that never fires.
function addDatabaseChangeListener() {
  return {remove() {}};
}

// deleteDatabaseSync / Async — no-ops for the in-memory stub.
function deleteDatabaseSync() {}
function deleteDatabaseAsync() {
  return Promise.resolve();
}

Object.defineProperty(module.exports, '__esModule', {value: true});
module.exports.openDatabaseSync = openDatabaseSync;
module.exports.openDatabaseAsync = openDatabaseAsync;
module.exports.SQLiteProvider = SQLiteProvider;
module.exports.useSQLiteContext = useSQLiteContext;
module.exports.addDatabaseChangeListener = addDatabaseChangeListener;
module.exports.deleteDatabaseSync = deleteDatabaseSync;
module.exports.deleteDatabaseAsync = deleteDatabaseAsync;
module.exports.default = {
  openDatabaseSync,
  openDatabaseAsync,
  SQLiteProvider,
  useSQLiteContext,
};
