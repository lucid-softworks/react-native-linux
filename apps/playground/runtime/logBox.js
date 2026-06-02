'use strict';

// LogBox — RN's in-window error/warning panel. iOS/Android show
// non-fatal errors and warnings in a small bottom-anchored toast
// during dev; tapping it opens a full-screen panel with the stack
// trace and a dismiss button. We replicate that here using only the
// shipped View / Text / Pressable / ScrollView primitives.
//
// Wiring:
//   1. ErrorUtils.setGlobalHandler installs a handler in shims.js
//      that calls `LogBox.add({...})` on every non-fatal report.
//   2. console.error in shims.js also calls LogBox.add — the level
//      'error' messages are the ones userland cares about.
//   3. fabric.js wraps the user's tree in <LogBoxOverlay> which
//      subscribes to LogBox and renders the toast + expanded panel.
//
// The overlay sits ABOVE the ErrorBoundary so a render crash that
// trips the boundary still leaves the LogBox visible — the boundary
// swaps its children for a fallback, but the LogBoxOverlay is on
// the outside and stays mounted.

const React = require('react');
const {View, Text, Pressable, ScrollView} = require('./components');

const MAX_ENTRIES = 50;

// In-memory ring buffer + subscriber list. Lives outside React so the
// store survives Fast Refresh and ErrorBoundary remounts.
const _state = {
  entries: [],
  nextId: 1,
  // Monotonic version bump — useSyncExternalStore's getSnapshot
  // returns this so React re-renders even when the entries array
  // identity is preserved. Without it Object.is(prev, next) bails
  // on every notify and the toast never updates.
  version: 0,
  subscribers: new Set(),
};

function _notify() {
  _state.version++;
  // Defer subscriber dispatch to a microtask. If we fired
  // synchronously while inside a click handler, React 19 would
  // throw mid-event-dispatch because a setState scheduled by
  // useSyncExternalStore's subscriber can't run inside another
  // commit phase. Promise.resolve().then unwinds the current call
  // stack first.
  Promise.resolve().then(() => {
    const snapshot = Array.from(_state.subscribers);
    for (let i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i]();
      } catch (_e) {
        if (typeof rnLinux !== 'undefined' && rnLinux.log) {
          rnLinux.log('warn', '[LogBox] subscriber threw: ' + String(_e));
        }
      }
    }
  });
}

function _shortMessage(err) {
  if (err == null) return 'unknown';
  if (typeof err === 'string') return err;
  if (err.message != null) return String(err.message);
  return String(err);
}

function _stackOf(err) {
  if (err == null) return '';
  if (typeof err === 'string') return '';
  if (err.stack) return String(err.stack);
  return '';
}

const LogBox = {
  add(level, err) {
    const entry = {
      id: _state.nextId++,
      level: level === 'warn' ? 'warn' : 'error',
      message: _shortMessage(err),
      stack: _stackOf(err),
    };
    _state.entries.push(entry);
    if (_state.entries.length > MAX_ENTRIES) {
      _state.entries.splice(0, _state.entries.length - MAX_ENTRIES);
    }
    _notify();
  },
  clear() {
    _state.entries = [];
    _notify();
  },
  getEntries() {
    return _state.entries;
  },
  subscribe(cb) {
    _state.subscribers.add(cb);
    return () => _state.subscribers.delete(cb);
  },
};

// Hook the global so shims.js can wire ErrorUtils + console.error
// without having to require this module synchronously at the bottom
// of its block-scoped if-chains.
if (typeof globalThis !== 'undefined') {
  globalThis.__rnLinuxLogBox = LogBox;
}

function _useLogBoxEntries() {
  // Subscribe to version bumps so React re-renders on every add /
  // clear. The actual entries are read from the live array.
  React.useSyncExternalStore(
    LogBox.subscribe,
    () => _state.version,
    () => _state.version,
  );
  return _state.entries;
}

// The toast that sits at the bottom of the screen showing the
// current entry count. Tapping it expands the full panel.
function LogBoxToast({count, level, onPress}) {
  if (count === 0) return null;
  const bg = level === 'error' ? '#dc2626' : '#d97706';
  return React.createElement(
    Pressable,
    {
      onPress,
      style: {
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 12,
        backgroundColor: bg,
        borderRadius: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
      },
    },
    React.createElement(
      Text,
      {style: {color: '#fff', fontWeight: '700', flex: 1}},
      String(count) + (count === 1 ? ' issue' : ' issues') + ' — tap to view',
    ),
  );
}

function LogBoxPanel({entries, onDismiss, onClear}) {
  return React.createElement(
    View,
    {
      style: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15,23,42,0.92)',
        padding: 16,
      },
    },
    React.createElement(
      View,
      {style: {flexDirection: 'row', alignItems: 'center', marginBottom: 8}},
      React.createElement(
        Text,
        {style: {color: '#fff', fontSize: 18, fontWeight: '700', flex: 1}},
        'LogBox · ' + entries.length + (entries.length === 1 ? ' entry' : ' entries'),
      ),
      React.createElement(
        Pressable,
        {
          onPress: onClear,
          style: {
            paddingHorizontal: 12,
            paddingVertical: 6,
            backgroundColor: '#475569',
            borderRadius: 4,
            marginRight: 8,
          },
        },
        React.createElement(Text, {style: {color: '#fff'}}, 'Clear'),
      ),
      React.createElement(
        Pressable,
        {
          onPress: onDismiss,
          style: {
            paddingHorizontal: 12,
            paddingVertical: 6,
            backgroundColor: '#0ea5e9',
            borderRadius: 4,
          },
        },
        React.createElement(Text, {style: {color: '#fff'}}, 'Close'),
      ),
    ),
    React.createElement(
      ScrollView,
      {
        style: {flex: 1, backgroundColor: '#1f2937', borderRadius: 6},
        contentContainerStyle: {padding: 8},
      },
      entries
        .slice()
        .reverse()
        .map(entry =>
          React.createElement(
            View,
            {
              key: entry.id,
              style: {
                marginBottom: 12,
                paddingBottom: 8,
                borderBottomWidth: 1,
                borderBottomColor: '#334155',
              },
            },
            React.createElement(
              Text,
              {
                style: {
                  color: entry.level === 'error' ? '#fca5a5' : '#fcd34d',
                  fontWeight: '700',
                  fontSize: 12,
                  marginBottom: 2,
                },
              },
              entry.level.toUpperCase(),
            ),
            React.createElement(
              Text,
              {style: {color: '#fff', fontFamily: 'monospace', fontSize: 12, marginBottom: 4}},
              entry.message,
            ),
            entry.stack
              ? React.createElement(
                  Text,
                  {style: {color: '#cbd5e1', fontFamily: 'monospace', fontSize: 10}},
                  entry.stack,
                )
              : null,
          ),
        ),
    ),
  );
}

// LogBoxOverlay wraps the user's tree. Children render inline; the
// overlay sits on top via absolute-positioned siblings inside a
// flex:1 container so child layout isn't affected.
function LogBoxOverlay({children}) {
  const entries = _useLogBoxEntries();
  const [expanded, setExpanded] = React.useState(false);
  const latestLevel =
    entries.length > 0 && entries[entries.length - 1].level === 'error' ? 'error' : 'warn';
  return React.createElement(
    View,
    {style: {flex: 1}},
    children,
    expanded
      ? React.createElement(LogBoxPanel, {
          entries,
          onDismiss: () => setExpanded(false),
          onClear: () => {
            LogBox.clear();
            setExpanded(false);
          },
        })
      : React.createElement(LogBoxToast, {
          count: entries.length,
          level: latestLevel,
          onPress: () => setExpanded(true),
        }),
  );
}

module.exports = {LogBox, LogBoxOverlay};
