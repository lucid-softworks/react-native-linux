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
    return [
      ((n >>> 24) & 0xff) / 255,
      ((n >>> 16) & 0xff) / 255,
      ((n >>> 8) & 0xff) / 255,
      (n & 0xff) / 255,
    ];
  }
  if ((m = /^#([0-9a-f]{3})$/i.exec(c))) {
    const s = m[1];
    return [
      parseInt(s[0] + s[0], 16) / 255,
      parseInt(s[1] + s[1], 16) / 255,
      parseInt(s[2] + s[2], 16) / 255,
      1,
    ];
  }
  if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c))) {
    return [+m[1] / 255, +m[2] / 255, +m[3] / 255, m[4] != null ? +m[4] : 1];
  }
  rnLinux.log('warn', '[fabric-reconciler] unrecognized color: ' + c);
  return c;
}

// Flatten the React Native `style` prop into a single object. Accepts
// any of: null/undefined, a single style object, or a (possibly
// nested) array of those. Later entries override earlier ones —
// matches RN's StyleSheet.flatten semantics. Falsy entries are
// skipped so `style={[base, condition && override]}` Just Works.
function flattenStyle(style, out) {
  if (style == null || style === false) return;
  if (Array.isArray(style)) {
    for (const s of style) flattenStyle(s, out);
    return;
  }
  if (typeof style !== 'object') return;
  for (const k in style) {
    out[k] = style[k];
  }
}

function buildFabricProps(type, props) {
  // children/key/ref are React-internal; never forward to Fabric.
  // onClick is a JS function — it can't survive serialization into
  // ViewProps. We register it separately against the Fabric tag (see
  // syncClickHandler) and strip it from the prop bag here.
  // For <text>, text-style props (color/fontSize/…) ride along as
  // top-level Paragraph props — BaseTextProps parses them into the
  // Paragraph's textAttributes.
  //
  // The `style` prop is RN's idiomatic way to bundle layout + visual
  // properties — we accept it as an object, a (possibly nested)
  // array of objects, or null. Style entries override direct
  // top-level props, matching the precedence RN uses on iOS/Android.
  //
  // Yoga handles layout for everything inside Fabric — flex,
  // flexDirection, justifyContent, alignItems, padding, margin, gap,
  // etc. flow through unchanged. We leave `position` unset by
  // default so RN's normal `position:'relative'` + flex layout
  // applies; set `position:'absolute'` (with top/left/width/height)
  // explicitly for free-floating elements.
  const out = {};
  for (const k in props) {
    if (k === 'children' || k === 'key' || k === 'ref') continue;
    if (k === 'onClick' || k === 'style') continue;
    if (k === 'onChangeText') continue;
    if (k === 'onScroll') continue;
    out[k] = props[k];
  }
  // Style merges in after direct props so it wins (RN precedence).
  flattenStyle(props.style, out);
  // Color normalization runs AFTER merge so styles get the same
  // hex-string → [r,g,b,a] conversion direct props do.
  for (const k of Object.keys(out)) {
    if (COLOR_PROPS.has(k)) out[k] = normalizeColor(out[k]);
  }
  // collapsable:false forces Fabric to materialize this node even if
  // its only role is layout — otherwise it gets folded into the parent
  // and Yoga's per-node frame disappears.
  if (out.collapsable === undefined) out.collapsable = false;
  return out;
}

// Push (or remove) a click handler for a Fabric tag into the JSI
// registry the C++ ViewComponentView gesture controller consults.
function syncClickHandler(tag, props) {
  const handler = props && typeof props.onClick === 'function' ? props.onClick : null;
  rnLinux.fabricOnClick(tag, handler);
}

function syncChangeTextHandler(tag, props) {
  const handler = props && typeof props.onChangeText === 'function' ? props.onChangeText : null;
  rnLinux.fabricOnChangeText(tag, handler);
}

function syncScrollHandler(tag, props) {
  const handler = props && typeof props.onScroll === 'function' ? props.onScroll : null;
  rnLinux.fabricOnScroll(tag, handler);
}

const hostConfig = {
  // Persistence is the natural fit for Fabric — every commit clones
  // the affected nodes via nativeFabricUIManager.cloneNodeWith*, then
  // hands the new root child-set to completeRoot. No in-place
  // mutation, no diff payloads.
  supportsMutation: false,
  supportsPersistence: true,
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

  // The 5th arg to `currentFabric.createNode` is the *instanceHandle*
  // — RN's UIManagerBinding wraps it in a `jsi::WeakObject` and ties
  // the ShadowNode's lifetime to it (it's how getNodeFromInstanceHandle
  // resolves a fiber back to a ShadowNode, and how getPublicInstance /
  // measure / focus / ref-attach all find their target on iOS/Android).
  //
  // Pre-fix we were passing `{}` here, expecting it to be `state`. RN's
  // signature is `createNode(tag, name, surfaceId, props, instanceHandle)`
  // — there's no separate `state` arg. The empty object got GC'd as
  // soon as createNode returned; with no ref the dangling WeakObject
  // was harmless, but the moment React tried to attach a ref the
  // commit phase walked the InstanceHandle, dereferenced the dead
  // weak object, and propagated an exception out of UIManager::startSurface.
  //
  // Passing the reconciler's `internalInstanceHandle` (the fiber) keeps
  // it alive for the lifetime of the shadow node and matches the iOS/
  // Android contract.
  createInstance(type, props, _rootContainerInstance, _hostContext, internalInstanceHandle) {
    if (type === 'view') {
      const tag = newTag();
      const fabricNode = currentFabric.createNode(
        tag,
        'View',
        currentSurfaceId,
        buildFabricProps(type, props),
        internalInstanceHandle,
      );
      syncClickHandler(tag, props);
      return {tag, fabricNode, componentName: 'View', type};
    }

    if (type === 'scrollview') {
      const tag = newTag();
      const fabricNode = currentFabric.createNode(
        tag,
        'ScrollView',
        currentSurfaceId,
        buildFabricProps(type, props),
        internalInstanceHandle,
      );
      syncScrollHandler(tag, props);
      return {tag, fabricNode, componentName: 'ScrollView', type};
    }

    if (type === 'image') {
      const tag = newTag();
      const fabricNode = currentFabric.createNode(
        tag,
        'Image',
        currentSurfaceId,
        buildFabricProps(type, props),
        internalInstanceHandle,
      );
      return {tag, fabricNode, componentName: 'Image', type};
    }

    if (type === 'textinput') {
      const tag = newTag();
      const fabricNode = currentFabric.createNode(
        tag,
        'TextInput',
        currentSurfaceId,
        buildFabricProps(type, props),
        internalInstanceHandle,
      );
      syncChangeTextHandler(tag, props);
      return {tag, fabricNode, componentName: 'TextInput', type};
    }

    if (type === 'text') {
      // RN's textual flow is Paragraph (carries layout + base
      // TextAttributes) → RawText children (contribute string content).
      // ParagraphProps inherits BaseTextProps, so top-level `color`,
      // `fontSize`, `fontWeight`, … parse into its textAttributes and
      // propagate to every fragment built from descendants.
      const tag = newTag();
      const fabricNode = currentFabric.createNode(
        tag,
        'Paragraph',
        currentSurfaceId,
        buildFabricProps('text', props),
        internalInstanceHandle,
      );
      return {tag, fabricNode, componentName: 'Paragraph', type};
    }

    throw new Error('Unknown host element: <' + type + '>');
  },

  createTextInstance(text, _rootContainerInstance, _hostContext, internalInstanceHandle) {
    const tag = newTag();
    const fabricNode = currentFabric.createNode(
      tag,
      'RawText',
      currentSurfaceId,
      {text},
      internalInstanceHandle,
    );
    return {tag, fabricNode, componentName: 'RawText', type: 'rawtext'};
  },

  appendInitialChild(parent, child) {
    currentFabric.appendChild(parent.fabricNode, child.fabricNode);
  },
  finalizeInitialChildren: () => false,

  // Persistent-mode update path. cloneInstance is called once per
  // changed (or child-changed) node in the workInProgress tree.
  // The reconciler tells us whether children are unchanged — when
  // true we keep the existing child list via cloneNodeWithNewProps;
  // otherwise the caller reattaches children via appendChild on the
  // returned (clone) instance.
  prepareUpdate(_instance, _type, oldProps, newProps) {
    // Cheap reference check first — children/key are React-only and
    // are not part of newProps for host instances, so identity is
    // a safe shortcut.
    return oldProps === newProps ? null : true;
  },

  cloneInstance(
    currentInstance,
    _updatePayload,
    type,
    _oldProps,
    newProps,
    _workInProgress,
    childrenUnchanged,
    /*recyclableInstance*/
  ) {
    const fabricProps = buildFabricProps(type, newProps);
    const fabricNode = childrenUnchanged
      ? currentFabric.cloneNodeWithNewProps(currentInstance.fabricNode, fabricProps)
      : currentFabric.cloneNodeWithNewChildrenAndProps(currentInstance.fabricNode, fabricProps);
    // Re-bind the click handler — JS function identity changes across
    // renders, so we keep the C++ registry pointing at the freshest
    // closure.
    if (type === 'view') syncClickHandler(currentInstance.tag, newProps);
    if (type === 'textinput') syncChangeTextHandler(currentInstance.tag, newProps);
    if (type === 'scrollview') syncScrollHandler(currentInstance.tag, newProps);
    return {
      tag: currentInstance.tag,
      fabricNode,
      componentName: currentInstance.componentName,
      type,
    };
  },

  // Used inside Fabric's `<hidden>` Offscreen branch — we don't have
  // a visibility primitive yet, so just return a clone with the same
  // props (no Pango layer needed to honour `display: none`).
  cloneHiddenInstance(currentInstance, type, _props /*, internalInstanceHandle */) {
    return {
      tag: currentInstance.tag,
      fabricNode: currentFabric.cloneNode(currentInstance.fabricNode),
      componentName: currentInstance.componentName,
      type,
    };
  },
  cloneHiddenTextInstance(currentInstance /*, text, internalInstanceHandle */) {
    return {
      tag: currentInstance.tag,
      fabricNode: currentFabric.cloneNode(currentInstance.fabricNode),
      componentName: currentInstance.componentName,
      type: currentInstance.type,
    };
  },

  appendChild(parent, child) {
    currentFabric.appendChild(parent.fabricNode, child.fabricNode);
  },

  // Container child-set lifecycle. The reconciler builds a fresh
  // child-set for every commit; we hand it off to completeRoot in
  // replaceContainerChildren.
  createContainerChildSet(_container) {
    return currentFabric.createChildSet(currentSurfaceId);
  },
  appendChildToContainerChildSet(childSet, child) {
    currentFabric.appendChildToSet(childSet, child.fabricNode);
  },
  finalizeContainerChildren: noop,
  replaceContainerChildren(container, newChildSet) {
    container.childSet = newChildSet;
    currentFabric.completeRoot(currentSurfaceId, newChildSet);
  },

  // <text>hi</text> must spawn a RawText child, NOT inline the string
  // on the Paragraph's props. Returning false sends React down the
  // createTextInstance path.
  shouldSetTextContent: () => false,

  commitMount: noop,
  hideInstance: noop,
  unhideInstance: noop,
  hideTextInstance: noop,
  unhideTextInstance: noop,
};

module.exports = {hostConfig, setSurfaceContext};
