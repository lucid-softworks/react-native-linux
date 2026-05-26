'use strict';

// react-reconciler host config that drives the rnLinux JSI bridge.
//
// Host element types:
//   <box>   → GtkFixed (positionable container)
//   <label> → GtkLabel (single-line for now)
//
// Both accept:
//   x, y, width, height          — absolute layout in parent
//   backgroundColor: "#RRGGBB"   — CSS provider on the widget
//   onClick: () => void          — GtkGestureClick handler
// <label> additionally accepts:
//   text: string                 — gtk_label_set_text contents

const {DefaultEventPriority} = require('react-reconciler/constants');

const noop = () => {};

// Props that don't depend on having a parent (text, color, click). Safe
// to apply during createInstance — they're idempotent.
function applyNonBoundsProps(inst) {
  const {id, type, props: p} = inst;
  if (type === 'label' && typeof p.text === 'string') {
    rnLinux.setText(id, p.text);
  }
  if (p.backgroundColor) rnLinux.setBackgroundColor(id, p.backgroundColor);
  // Register / replace / detach in one shot. Passing `null` (vs
  // `undefined`) tells the C++ side "no handler — remove".
  rnLinux.onClick(id, typeof p.onClick === 'function' ? p.onClick : null);
}

// Position/size go through gtk_fixed_move on the parent — must run
// after the widget has been added to its parent. Defaults keep labels
// rendering even without explicit width/height.
function applyBounds(inst) {
  const {id, type, props: p} = inst;
  const x = p.x | 0;
  const y = p.y | 0;
  const w = p.width | 0 || (type === 'label' ? 400 : 100);
  const h = p.height | 0 || (type === 'label' ? 24 : 100);
  rnLinux.setBounds(id, x, y, w, h);
}

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
  getPublicInstance: instance => instance,
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
    throw new Error('Bare text nodes are not supported; wrap strings in <label text="...">.');
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

  // react-reconciler 0.29 only calls commitUpdate if prepareUpdate
  // returns truthy. We skip the diff and always re-apply props — cheap
  // for the sizes we deal with here.
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

module.exports = {hostConfig};
