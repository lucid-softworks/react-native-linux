/**
 * react-native-linux lightning-path demo.
 *
 * Uses react-reconciler to drive the rnLinux JSI bindings exposed by
 * vnext/src/jsi/RnLinuxBindings.cpp. This is *not* Fabric — once Phase
 * 5.3 lands the same JSX surface will move over to <View>/<Text> on
 * the real ComponentDescriptor + Scheduler pipeline.
 */

// Minimal browser-API shims so react-reconciler (and React's scheduler)
// can run on Hermes. Hermes exposes Promise + console but not
// queueMicrotask, setTimeout / clearTimeout / setInterval / clearInterval,
// or performance. Real timer plumbing lands in Phase 5.8 tied to the
// GTK main loop.
if (typeof globalThis.queueMicrotask === 'undefined') {
  const _resolved = Promise.resolve();
  globalThis.queueMicrotask = (fn) => {
    _resolved.then(() => {
      try { fn(); }
      catch (e) { rnLinux.log('error', 'microtask threw: ' + String(e)); }
    });
  };
}
// React's scheduler uses setImmediate to yield between work units. Without
// a real event loop we'd ping-pong setImmediate→microtask→setImmediate and
// blow the stack. Workaround for the static-render demo: drain queued
// callbacks at the end of the current synchronous tick via a single
// post-evaluation Promise.then. Real timer/scheduler integration is
// Phase 5.8 work.
const _pendingTasks = [];
let _draining = false;
function _enqueue(fn) {
  _pendingTasks.push(fn);
  if (!_draining) {
    _draining = true;
    Promise.resolve().then(() => {
      while (_pendingTasks.length) {
        const next = _pendingTasks.shift();
        try { next(); }
        catch (e) { rnLinux.log('error', 'task threw: ' + String(e)); }
      }
      _draining = false;
    });
  }
}
const _timers = new Map();
let _timerSeq = 1;
if (typeof globalThis.setTimeout === 'undefined') {
  globalThis.setTimeout = (fn, _ms, ...args) => {
    const id = _timerSeq++;
    _timers.set(id, true);
    _enqueue(() => {
      if (_timers.delete(id)) fn(...args);
    });
    return id;
  };
  globalThis.clearTimeout = (id) => _timers.delete(id);
}
if (typeof globalThis.setInterval === 'undefined') {
  globalThis.setInterval = () => 0;
  globalThis.clearInterval = () => {};
}
if (typeof globalThis.setImmediate === 'undefined') {
  globalThis.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
  globalThis.clearImmediate = (id) => clearTimeout(id);
}
if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = {now: () => Date.now()};
}

const React = require('react');
const {useState, useEffect} = React;
const Reconciler = require('react-reconciler');
const {DefaultEventPriority} = require('react-reconciler/constants');

const noop = () => {};

const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  isPrimaryRenderer: true,
  noTimeout: -1,

  now: () => Date.now(),
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  getCurrentEventPriority: () => DefaultEventPriority,

  getRootHostContext: () => ({}),
  getChildHostContext: () => ({}),
  getPublicInstance: (instance) => instance,
  prepareForCommit: () => null,
  resetAfterCommit: noop,
  preparePortalMount: noop,
  beforeActiveInstanceBlur: noop,
  afterActiveInstanceBlur: noop,
  prepareScopeUpdate: noop,
  getInstanceFromScope: () => null,
  getInstanceFromNode: () => null,
  detachDeletedInstance: noop,
  clearContainer: noop,

  createInstance(type, props) {
    if (type === 'box') {
      const id = rnLinux.createBox();
      const inst = {id, type, props};
      applyNonBoundsProps(inst);
      return inst;
    }
    if (type === 'label') {
      const id = rnLinux.createLabel();
      const inst = {id, type, props};
      applyNonBoundsProps(inst);
      return inst;
    }
    throw new Error('Unknown host element: ' + type);
  },

  createTextInstance() {
    throw new Error(
      'Bare text nodes are not supported; wrap strings in <label text="...">.',
    );
  },

  appendInitialChild(parent, child) {
    rnLinux.appendChild(parent.id, child.id);
    applyBounds(child);
  },
  appendChild(parent, child) {
    rnLinux.appendChild(parent.id, child.id);
    applyBounds(child);
  },
  appendChildToContainer(_container, child) {
    rnLinux.setRoot(child.id);
    applyBounds(child);
  },
  insertBefore(parent, child) {
    rnLinux.appendChild(parent.id, child.id);
    applyBounds(child);
  },
  insertInContainerBefore(_container, child) {
    rnLinux.setRoot(child.id);
    applyBounds(child);
  },
  removeChild(parent, child) {
    rnLinux.removeChild(parent.id, child.id);
  },
  removeChildFromContainer: noop,

  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  resetTextContent: noop,
  commitTextUpdate: noop,

  // React-reconciler calls prepareUpdate for every prop change; if it
  // returns null/false commitUpdate is skipped. We don't bother diffing
  // — return a truthy sentinel so commitUpdate always runs, then do the
  // actual prop apply there.
  prepareUpdate: () => true,

  commitMount: noop,
  commitUpdate(instance, _updatePayload, _type, _oldProps, newProps) {
    instance.props = newProps;
    applyNonBoundsProps(instance);
    applyBounds(instance);
  },

  hideInstance: noop,
  unhideInstance: noop,
  hideTextInstance: noop,
  unhideTextInstance: noop,
};

// Props that don't depend on having a parent (text, color, click). Safe
// to apply during createInstance — they're idempotent.
function applyNonBoundsProps(inst) {
  const {id, type, props: p} = inst;
  if (type === 'label' && typeof p.text === 'string') {
    rnLinux.setText(id, p.text);
  }
  if (p.backgroundColor) rnLinux.setBackgroundColor(id, p.backgroundColor);
  // Register / replace / detach the click handler in one shot. Pass
  // `null` (vs `undefined`) so the C++ side recognises "no handler".
  rnLinux.onClick(id, typeof p.onClick === 'function' ? p.onClick : null);
}

// Position/size go through gtk_fixed_move on the parent — so we must run
// after the widget has been added to its parent. Bounds default to a
// reasonable size so labels render even without an explicit width/height.
function applyBounds(inst) {
  const {id, type, props: p} = inst;
  const x = p.x | 0;
  const y = p.y | 0;
  const w = (p.width | 0) || (type === 'label' ? 400 : 100);
  const h = (p.height | 0) || (type === 'label' ? 24 : 100);
  rnLinux.setBounds(id, x, y, w, h);
}

const reconciler = Reconciler(hostConfig);

// ---- App ----------------------------------------------------------------
// JSX from here on. esbuild's automatic JSX runtime handles the lowering;
// no React.createElement calls in user code.

function Button({x, y, width = 200, height = 60, color = '#3b82f6', label, onClick}) {
  return (
    <box x={x} y={y} width={width} height={height} backgroundColor={color} onClick={onClick}>
      <label
        x={16}
        y={Math.max(0, (height - 24) / 2)}
        width={width - 32}
        height={24}
        text={label}
      />
    </box>
  );
}

function Swatch({x, y, label, value}) {
  return (
    <box x={x} y={y} width={300} height={64} backgroundColor="#1e293b">
      <label x={16} y={8}  width={268} height={20} text={label} />
      <label x={16} y={32} width={268} height={24} text={String(value)} />
    </box>
  );
}

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    rnLinux.log('info', 'React App mounted — useEffect ran ✓');
  }, []);

  useEffect(() => {
    rnLinux.log('info', 'count is now ' + count);
  }, [count]);

  return (
    <box x={0} y={0} width={1024} height={720} backgroundColor="#0f172a">
      <label x={80} y={56} width={860} height={48}
             text="🔄  reloaded at runtime  🔄" />
      <label x={80} y={108} width={860} height={22}
             text="click a button, watch the count update through useState" />

      <Swatch x={80}  y={160} label="count"           value={count} />
      <Swatch x={400} y={160} label="count × 2"       value={count * 2} />
      <Swatch x={720} y={160} label="count is even"   value={count % 2 === 0 ? 'yes' : 'no'} />

      <Button x={80}  y={260} color="#22c55e" label="+1"
              onClick={() => setCount(c => c + 1)} />
      <Button x={300} y={260} color="#f97316" label="+10"
              onClick={() => setCount(c => c + 10)} />
      <Button x={520} y={260} color="#ef4444" label="reset"
              onClick={() => setCount(0)} />

      <label x={80} y={360} width={860} height={22}
             text="GtkGestureClick → JSI fn call → setState → reconciler → setText" />
      <label x={80} y={390} width={860} height={22}
             text="edit apps/playground/index.jsx, run `pnpm --filter @lucid-softworks/playground watch` — hot reload reboots the runtime." />
    </box>
  );
}

const root = reconciler.createContainer(
  /* containerInfo */ {},
  /* tag */ 0,
  /* hydrationCallbacks */ null,
  /* isStrictMode */ false,
  /* concurrentUpdatesByDefault */ null,
  /* identifierPrefix */ '',
  /* onUncaughtError */ (err) => rnLinux.log('error', String(err)),
  /* onCaughtError */ (err) => rnLinux.log('error', String(err)),
  /* onRecoverableError */ (err) => rnLinux.log('warn', String(err)),
  /* transitionCallbacks */ null,
);

reconciler.updateContainer(
  <App />,
  root,
  null,
  () => rnLinux.log('info', 'initial render committed'),
);
