'use strict';

// In-window LogBox/RedBox replacement. Wraps the user's app in an
// ErrorBoundary; when JS throws during render or commit, the boundary
// catches the error and renders a panel with the message, stack, and
// Reload / Dismiss buttons instead of leaving the user staring at a
// blank window.
//
// Async errors (rejected microtasks, setTimeout throws) are surfaced
// via the shim's task-threw path → console.error. A future iteration
// can add a global ErrorUtils setGlobalHandler that pushes those into
// the same boundary via a module-level subscribe list.
//
// Reload uses rnLinux.reloadApp (which the C++ host exposes when this
// module loads). Dismiss resets the boundary so the next render can
// re-try (useful for transient errors during HMR).

const React = require('react');
const {View, Text, Pressable, ScrollView} = require('./components');

const styles = {
  scrim: {
    flex: 1,
    backgroundColor: '#1f1f23',
    padding: 24,
    justifyContent: 'flex-start',
  },
  badge: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  badgeText: {color: '#fff', fontWeight: '700', fontSize: 11, letterSpacing: 1},
  title: {color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 4},
  msg: {color: '#fee2e2', fontSize: 14, fontFamily: 'monospace', marginBottom: 12},
  stack: {
    flex: 1,
    backgroundColor: '#0f0f12',
    borderLeftWidth: 3,
    borderLeftColor: '#dc2626',
    padding: 12,
    borderRadius: 6,
    marginBottom: 16,
  },
  stackText: {color: '#d4d4d8', fontSize: 11, fontFamily: 'monospace'},
  row: {flexDirection: 'row', gap: 10},
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  btnText: {color: '#fff', fontWeight: '700', fontSize: 13},
  btnDismiss: {backgroundColor: '#3f3f46'},
};

function ErrorPanel({error, info, onReload, onDismiss}) {
  const stackLines = [];
  if (error && error.stack) {
    stackLines.push(error.stack);
  }
  if (info && info.componentStack) {
    stackLines.push('\nComponent stack:' + info.componentStack);
  }
  const stack = stackLines.join('\n');
  const msg = error ? error.message || String(error) : 'unknown error';
  return React.createElement(
    View,
    {style: styles.scrim},
    React.createElement(
      View,
      {style: styles.badge},
      React.createElement(Text, {style: styles.badgeText}, 'JS ERROR'),
    ),
    React.createElement(Text, {style: styles.title}, 'Something broke'),
    React.createElement(Text, {style: styles.msg}, msg),
    stack
      ? React.createElement(
          ScrollView,
          {style: styles.stack},
          React.createElement(Text, {style: styles.stackText}, stack),
        )
      : null,
    React.createElement(
      View,
      {style: styles.row},
      React.createElement(
        Pressable,
        {style: styles.btn, onPress: onReload},
        React.createElement(Text, {style: styles.btnText}, 'Reload (Ctrl+R)'),
      ),
      React.createElement(
        Pressable,
        {style: [styles.btn, styles.btnDismiss], onPress: onDismiss},
        React.createElement(Text, {style: styles.btnText}, 'Dismiss'),
      ),
    ),
  );
}

// ES5 function-constructor form because Hermes' optimizer chokes on
// `var X = class extends MemberExpression { ... }` — the shape esbuild
// emits when it wraps module-level `class X extends React.Component`
// in CJS. The function-constructor pattern bypasses the class
// expression entirely while still producing a React class component
// (React only requires Component-prototype lineage + the right
// instance methods).
//
// CRITICAL: forward `context` AND `updater` to React.Component.call.
// The reconciler constructs class components as
// `new Component(props, context, updater)` and the updater is what
// setState routes through. If we drop it, React.Component's
// constructor leaves this.updater = ReactNoopUpdateQueue, and
// setState becomes a silent no-op — Dismiss / Reload buttons did
// nothing because their setState never reached the renderer.
function ErrorBoundary(props, context, updater) {
  React.Component.call(this, props, context, updater);
  this.state = {error: null, info: null};
  this._reload = this._reload.bind(this);
  this._dismiss = this._dismiss.bind(this);
  this._onAsyncError = this._onAsyncError.bind(this);
}
ErrorBoundary.prototype = Object.create(React.Component.prototype);
ErrorBoundary.prototype.constructor = ErrorBoundary;
ErrorBoundary.getDerivedStateFromError = function (error) {
  return {error};
};
ErrorBoundary.prototype.componentDidMount = function () {
  if (typeof globalThis.ErrorUtils !== 'undefined') {
    this._prevHandler = globalThis.ErrorUtils.getGlobalHandler();
    globalThis.ErrorUtils.setGlobalHandler(this._onAsyncError);
  }
};
ErrorBoundary.prototype.componentWillUnmount = function () {
  if (typeof globalThis.ErrorUtils !== 'undefined' && this._prevHandler) {
    globalThis.ErrorUtils.setGlobalHandler(this._prevHandler);
  }
};
ErrorBoundary.prototype._onAsyncError = function (error, _isFatal) {
  if (this.state.error) return;
  this.setState({error: error instanceof Error ? error : new Error(String(error)), info: null});
};
ErrorBoundary.prototype.componentDidCatch = function (error, info) {
  this.setState({error, info});
  if (typeof rnLinux !== 'undefined') {
    rnLinux.log(
      'error',
      'ErrorBoundary caught: ' + (error && error.stack ? error.stack : String(error)),
    );
  }
};
ErrorBoundary.prototype._reload = function () {
  rnLinux.log('info', '[ErrorBoundary] _reload pressed');
  // Stash this boundary's reset into a global so the hot-reload
  // tryMount path can clear our state AFTER the bundle re-evaluates.
  // Doing it here via setState races against the synchronous
  // reloadApp call — by the time React processes the update, the
  // bundle re-eval has already run with the boundary still in error
  // state, so the post-reload render re-displays the panel.
  globalThis.__rnLinuxBoundaryReset = () => {
    rnLinux.log('info', '[ErrorBoundary] reset fired post-reload');
    this.setState({error: null, info: null});
  };
  if (typeof rnLinux !== 'undefined' && rnLinux.reloadApp) {
    rnLinux.reloadApp();
  }
};
ErrorBoundary.prototype._dismiss = function () {
  rnLinux.log('info', '[ErrorBoundary] _dismiss pressed');
  this.setState({error: null, info: null});
};
ErrorBoundary.prototype.render = function () {
  if (this.state.error) {
    if (typeof rnLinux !== 'undefined') {
      rnLinux.log(
        'info',
        '[ErrorBoundary] rendering ErrorPanel for: ' +
          (this.state.error.message || String(this.state.error)),
      );
    }
    return React.createElement(ErrorPanel, {
      error: this.state.error,
      info: this.state.info,
      onReload: this._reload,
      onDismiss: this._dismiss,
    });
  }
  return this.props.children;
};

module.exports = {ErrorBoundary};
