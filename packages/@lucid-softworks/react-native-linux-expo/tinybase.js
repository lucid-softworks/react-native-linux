'use strict';

// tinybase shim. Real impl is a tiny reactive table/key-value DB.
// We provide the surface apps reach for at import time: createStore,
// createMergeableStore, createIndexes, createRelationships, plus the
// React hooks (`useCell`, `useRow`, `useValue`, `useTable`, …) — all
// return undefined / no-op so consumers render their initial state.

const React = require('react');

function createStore() {
  const tables = {};
  const values = {};
  const listeners = new Set();
  const api = {
    getTable: t => tables[t] || {},
    getTables: () => tables,
    setTable(t, rows) {
      tables[t] = rows;
      listeners.forEach(l => l());
      return api;
    },
    setRow(t, r, row) {
      tables[t] = tables[t] || {};
      tables[t][r] = row;
      listeners.forEach(l => l());
      return api;
    },
    getRow: (t, r) => (tables[t] || {})[r] || {},
    getRowIds: t => Object.keys(tables[t] || {}),
    getCell: (t, r, c) => ((tables[t] || {})[r] || {})[c],
    setCell(t, r, c, v) {
      tables[t] = tables[t] || {};
      tables[t][r] = tables[t][r] || {};
      tables[t][r][c] = v;
      listeners.forEach(l => l());
      return api;
    },
    getValue: k => values[k],
    setValue(k, v) {
      values[k] = v;
      listeners.forEach(l => l());
      return api;
    },
    getValues: () => values,
    addRowIdsListener: () => () => {},
    addTableListener: () => () => {},
    addCellListener: () => () => {},
    addValueListener: () => () => {},
    delTables() {
      for (const k in tables) delete tables[k];
      listeners.forEach(l => l());
      return api;
    },
    delValues() {
      for (const k in values) delete values[k];
      listeners.forEach(l => l());
      return api;
    },
    addListener(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return api;
}

function createMergeableStore() {
  return createStore();
}
function createIndexes(_store) {
  return {addIndexDefinition: () => {}, getSliceIds: () => [], getSliceRowIds: () => []};
}
function createRelationships(_store) {
  return {
    setRelationshipDefinition: () => {},
    getRemoteRowId: () => null,
    getLocalRowIds: () => [],
  };
}
function createQueries(_store) {
  return {setQueryDefinition: () => {}, getResultRowIds: () => []};
}
function createCheckpoints(_store) {
  return {addCheckpoint: () => null, getCheckpointIds: () => [[], '0', []]};
}
function createMetrics(_store) {
  return {setMetricDefinition: () => {}, getMetric: () => 0};
}

// React bindings — the /ui-react sub-path. Wrap a store in Provider,
// expose hooks that read via getCell/getRow/getValue.
const StoreCtx = React.createContext(null);

function Provider(props) {
  return React.createElement(StoreCtx.Provider, {value: props.store || null}, props.children);
}
function useStore() {
  return React.useContext(StoreCtx);
}
function useCreateStore(creator) {
  const ref = React.useRef(null);
  if (ref.current === null) ref.current = creator ? creator() : createStore();
  return ref.current;
}
function useCell(table, row, cell, _store) {
  const store = _store || React.useContext(StoreCtx) || createStore();
  return store.getCell(table, row, cell);
}
function useRow(table, row, _store) {
  const store = _store || React.useContext(StoreCtx) || createStore();
  return store.getRow(table, row);
}
function useTable(table, _store) {
  const store = _store || React.useContext(StoreCtx) || createStore();
  return store.getTable(table);
}
function useRowIds(table, _store) {
  const store = _store || React.useContext(StoreCtx) || createStore();
  return store.getRowIds(table);
}
function useValue(key, _store) {
  const store = _store || React.useContext(StoreCtx) || createStore();
  return store.getValue(key);
}
function useValues(_store) {
  const store = _store || React.useContext(StoreCtx) || createStore();
  return store.getValues();
}
function useSetCellCallback(table, row, cell) {
  const store = React.useContext(StoreCtx);
  return v => store && store.setCell(table, row, cell, v);
}
function useDelRowCallback(table, row) {
  const store = React.useContext(StoreCtx);
  return () => store && store.setRow(table, row, undefined);
}

// /persisters/* sub-paths. Each persister is a thin wrapper that
// in-memory persists, no-op load/save.
function createPersister() {
  return {
    load: () => Promise.resolve(),
    save: () => Promise.resolve(),
    startAutoLoad: () => Promise.resolve(),
    startAutoSave: () => Promise.resolve(),
    stopAutoLoad: () => {},
    stopAutoSave: () => {},
    destroy: () => {},
  };
}

function stamp(o) {
  Object.defineProperty(o, '__esModule', {value: true});
  return o;
}

const base = stamp({
  createStore,
  createMergeableStore,
  createIndexes,
  createRelationships,
  createQueries,
  createCheckpoints,
  createMetrics,
});
const uiReact = stamp({
  Provider,
  useStore,
  useCreateStore,
  useCell,
  useRow,
  useTable,
  useRowIds,
  useValue,
  useValues,
  useSetCellCallback,
  useDelRowCallback,
  useCreateMergeableStore: useCreateStore,
});
const persisters = stamp({
  createBrowserPersister: createPersister,
  createExpoSqlitePersister: createPersister,
  createPersister,
});

module.exports = {base, uiReact, persisters};
