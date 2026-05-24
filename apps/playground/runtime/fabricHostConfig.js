'use strict';

// react-reconciler host config that drives the *real* Fabric pipeline.
//
// JSX host element types map to RN shadow node component names:
//   <view> → 'View'     (Yoga node, mounts a GtkFixed via ViewComponentView)
//   <text> → 'Paragraph' (mounts a GtkLabel via ParagraphComponentView;
//                         its text content comes from RawText *children*)
// Bare strings inside <text> become 'RawText' shadow nodes via
// createTextInstance — that's the only way the Paragraph's
// AttributedString gets populated.
//
// All Yoga style props live at the top level of each element's props
// (top/left/width/height/position/etc.) so they flow through to
// fabric.createNode untouched. We default `position: 'absolute'` if the
// app doesn't specify, since we don't have a real flex container yet —
// users position with explicit top/left coords for now.
//
// Updates: re-rendering on setState rebuilds the entire shadow tree —
// react-reconciler's commitUpdate is a no-op here. That's fine for the
// MVP; proper cloneNodeWithNewProps + replaceChild plumbing is a
// follow-up.

const {DefaultEventPriority} = require('react-reconciler/constants');

const noop = () => {};

let nextTag = 2000;
function newTag() {
  // Stay clear of the surfaceId range (1..1024) and the hand-rolled
  // demo's range (1000..) so debug logs are unambiguous.
  return ++nextTag;
}

let currentFabric = null;
let currentSurfaceId = null;

function setSurfaceContext(fabric, surfaceId) {
  currentFabric = fabric;
  currentSurfaceId = surfaceId;
}

const TYPE_TO_COMPONENT = {
  view: 'View',
  text: 'Paragraph',
};

// Color props that need string-to-rgba normalization. Keep small —
// covers what View/Text actually accept right now.
const COLOR_PROPS = new Set(['backgroundColor', 'color', 'borderColor']);

// Convert a CSS-style color string to a normalized [r, g, b, a] float
// array. The C++ side's fromRawValueShared accepts this shape
// (value.hasType<std::vector<float>>()) and packs it into a
// SharedColor. Numbers / arrays are passed through unchanged so apps
// can still write e.g. backgroundColor={0xff22c55e} or [r,g,b,a].
function normalizeColor(c) {
  if (c == null) return c;
  if (typeof c === 'number') return c;
  if (Array.isArray(c)) return c;
  if (typeof c !== 'string') return c;

  let m;
  if ((m = /^#([0-9a-f]{6})$/i.exec(c))) {
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255, 1];
  }
  if ((m = /^#([0-9a-f]{8})$/i.exec(c))) {
    // CSS form is #RRGGBBAA.
    const n = parseInt(m[1], 16);
    return [((n >>> 24) & 0xff) / 255, ((n >>> 16) & 0xff) / 255,
            ((n >>> 8) & 0xff) / 255, (n & 0xff) / 255];
  }
  if ((m = /^#([0-9a-f]{3})$/i.exec(c))) {
    const s = m[1];
    return [parseInt(s[0] + s[0], 16) / 255,
            parseInt(s[1] + s[1], 16) / 255,
            parseInt(s[2] + s[2], 16) / 255, 1];
  }
  if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c))) {
    return [(+m[1]) / 255, (+m[2]) / 255, (+m[3]) / 255,
            m[4] != null ? +m[4] : 1];
  }
  rnLinux.log('warn', '[fabric-reconciler] unrecognized color: ' + c);
  return c;
}

function buildFabricProps(type, props) {
  // children/key/ref are React-internal; never forward to Fabric.
  const out = {};
  for (const k in props) {
    if (k === 'children' || k === 'key' || k === 'ref') continue;
    out[k] = COLOR_PROPS.has(k) ? normalizeColor(props[k]) : props[k];
  }
  if (out.position === undefined) out.position = 'absolute';
  // collapsable:false forces Fabric to materialize this node even if
  // its only role is layout — otherwise it gets folded into the parent.
  if (out.collapsable === undefined) out.collapsable = false;
  return out;
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
  getPublicInstance: (instance) => instance,

  prepareForCommit: () => null,
  resetAfterCommit(containerInfo) {
    if (containerInfo._committed) return;
    containerInfo._committed = true;
    currentFabric.completeRoot(currentSurfaceId, containerInfo.childSet);
    rnLinux.log('info',
      '[fabric-reconciler] completeRoot surface=' + currentSurfaceId);
  },

  preparePortalMount: noop,
  beforeActiveInstanceBlur: noop,
  afterActiveInstanceBlur: noop,
  prepareScopeUpdate: noop,
  getInstanceFromScope: () => null,
  getInstanceFromNode: () => null,
  detachDeletedInstance: noop,
  clearContainer: noop,

  createInstance(type, props) {
    const componentName = TYPE_TO_COMPONENT[type];
    if (!componentName) {
      throw new Error('Unknown host element: <' + type + '>');
    }
    const tag = newTag();
    const fabricProps = buildFabricProps(type, props);
    const fabricNode = currentFabric.createNode(
      tag, componentName, currentSurfaceId, fabricProps, {});
    return {tag, fabricNode, componentName, type};
  },

  createTextInstance(text) {
    const tag = newTag();
    const fabricNode = currentFabric.createNode(
      tag, 'RawText', currentSurfaceId, {text}, {});
    return {tag, fabricNode, componentName: 'RawText', type: 'rawtext'};
  },

  appendInitialChild(parent, child) {
    currentFabric.appendChild(parent.fabricNode, child.fabricNode);
  },
  finalizeInitialChildren: () => false,

  appendChild(parent, child) {
    currentFabric.appendChild(parent.fabricNode, child.fabricNode);
  },
  appendChildToContainer(container, child) {
    currentFabric.appendChildToSet(container.childSet, child.fabricNode);
  },
  insertBefore(parent, child) {
    currentFabric.appendChild(parent.fabricNode, child.fabricNode);
  },
  insertInContainerBefore(container, child) {
    currentFabric.appendChildToSet(container.childSet, child.fabricNode);
  },

  // Updates aren't wired through cloneNodeWithNewProps yet — we'd need
  // to recreate the affected subtree and replaceChild on the parent.
  // For the MVP, prepareUpdate returning null suppresses commitUpdate.
  prepareUpdate: () => null,
  commitMount: noop,
  commitUpdate: noop,

  // <text>hi</text> must spawn a RawText child, NOT inline the string
  // on the Paragraph's props. Returning false sends React down the
  // createTextInstance path.
  shouldSetTextContent: () => false,
  resetTextContent: noop,
  commitTextUpdate: noop,

  removeChild: noop,
  removeChildFromContainer: noop,

  hideInstance: noop,
  unhideInstance: noop,
  hideTextInstance: noop,
  unhideTextInstance: noop,
};

module.exports = {hostConfig, setSurfaceContext};
