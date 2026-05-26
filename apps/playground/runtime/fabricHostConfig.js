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
    if (k === 'onSubmitEditing' || k === 'onKeyPress') continue;
    // Skip undefined values so the C++ prop converter falls back to
    // its declared default instead of seeing a present-but-undefined
    // entry. (E.g. FlatList destructures `horizontal` out of its
    // props as undefined when callers don't pass it; if we forward
    // {horizontal: undefined} to the ScrollView shadow node, the
    // ScrollViewProps converter treats it as truthy somewhere along
    // the line and we end up with a horizontal scrolled window
    // policy where the caller wanted vertical.)
    if (props[k] === undefined) continue;
    // Skip function values at the top level. Fabric's RawPropsParser
    // calls jsi::dynamicFromValue on every prop; that helper substitutes
    // null for functions found *inside* an object property but THROWS
    // for a top-level function ("JS Functions are not convertible to
    // dynamic"). Real RN libraries (react-native-paper's TextInput,
    // most ref-forwarding wrappers) pass handler / callback / ref
    // functions as top-level props on the host element. We register
    // the handlers we care about via separate sync* paths against the
    // Fabric tag, so dropping them from the prop bag is correct.
    if (typeof props[k] === 'function') continue;
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

// onLayout lives on every host element type — register / unregister
// per-tag so dispatchFabricLayout (called from
// LinuxComponentView::updateLayoutMetrics) knows which tags need a
// callback. Function identity changes across renders, so we re-bind
// on every commit; the C++ side keeps a single shared_ptr<jsi::Function>
// alive per tag.
function syncLayoutHandler(tag, props) {
  const handler = props && typeof props.onLayout === 'function' ? props.onLayout : null;
  rnLinux.fabricOnLayout(tag, handler);
}

function syncSwitchHandler(tag, props) {
  const handler = props && typeof props.onValueChange === 'function' ? props.onValueChange : null;
  rnLinux.fabricOnSwitchChange(tag, handler);
}

function syncSubmitEditingHandler(tag, props) {
  const handler =
    props && typeof props.onSubmitEditing === 'function' ? props.onSubmitEditing : null;
  rnLinux.fabricOnSubmitEditing(tag, handler);
}

// onKeyPress is fired with a raw `key` string. We wrap into the
// RN-shaped {nativeEvent: {key}} object so userland code that reads
// `e.nativeEvent.key` works unchanged.
function syncKeyPressHandler(tag, props) {
  const user = props && typeof props.onKeyPress === 'function' ? props.onKeyPress : null;
  if (!user) {
    rnLinux.fabricOnKeyPress(tag, null);
    return;
  }
  rnLinux.fabricOnKeyPress(tag, key => {
    user({nativeEvent: {key}});
  });
}

// Build the object react-reconciler sees as a host instance. Apps get
// this back via ref.current; library code (paper, gesture-handler,
// navigation, …) expects measure / measureInWindow / focus / blur to
// exist as methods on the public instance. Methods dispatch into JSI
// bindings (rnLinux.measureFabricView / focusFabricView / …) keyed by
// the same tag the C++ mounting registry uses.
//
// Returning a fresh object per instance keeps the prop bag stable.
// cloneInstance allocates a new one each commit; React's reconciliation
// already treats the host instance as ephemeral, so the per-clone
// closure cost is negligible.
function makeInstance(tag, fabricNode, componentName, type) {
  return {
    tag,
    fabricNode,
    componentName,
    type,
    measure(callback) {
      const m = rnLinux.measureFabricView(tag);
      if (typeof callback !== 'function') return;
      if (m) {
        callback(m.x, m.y, m.width, m.height, m.pageX, m.pageY);
      } else {
        callback(0, 0, 0, 0, 0, 0);
      }
    },
    measureInWindow(callback) {
      const m = rnLinux.measureFabricView(tag);
      if (typeof callback !== 'function') return;
      if (m) {
        callback(m.pageX, m.pageY, m.width, m.height);
      } else {
        callback(0, 0, 0, 0);
      }
    },
    measureLayout(_relativeToNativeNode, onSuccess, _onFail) {
      // measureLayout is "measure relative to another native node". We
      // approximate by returning the same coords as measure() — that's
      // wrong for the relative-to case but right when callers pass the
      // ancestor's UIManager root tag (the common react-navigation
      // pattern). Good enough until we wire a real relative-coord path.
      const m = rnLinux.measureFabricView(tag);
      if (typeof onSuccess !== 'function') return;
      if (m) {
        onSuccess(m.x, m.y, m.width, m.height);
      } else {
        onSuccess(0, 0, 0, 0);
      }
    },
    focus() {
      rnLinux.focusFabricView(tag);
    },
    blur() {
      rnLinux.blurFabricView(tag);
    },
  };
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
      syncLayoutHandler(tag, props);
      return makeInstance(tag, fabricNode, 'View', type);
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
      syncLayoutHandler(tag, props);
      return makeInstance(tag, fabricNode, 'ScrollView', type);
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
      syncLayoutHandler(tag, props);
      return makeInstance(tag, fabricNode, 'Image', type);
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
      syncSubmitEditingHandler(tag, props);
      syncKeyPressHandler(tag, props);
      syncLayoutHandler(tag, props);
      return makeInstance(tag, fabricNode, 'TextInput', type);
    }

    if (type === 'switch') {
      const tag = newTag();
      const fabricNode = currentFabric.createNode(
        tag,
        'Switch',
        currentSurfaceId,
        buildFabricProps(type, props),
        internalInstanceHandle,
      );
      syncSwitchHandler(tag, props);
      syncLayoutHandler(tag, props);
      return makeInstance(tag, fabricNode, 'Switch', type);
    }

    if (type === 'spinner') {
      const tag = newTag();
      const fabricNode = currentFabric.createNode(
        tag,
        'ActivityIndicator',
        currentSurfaceId,
        buildFabricProps(type, props),
        internalInstanceHandle,
      );
      syncLayoutHandler(tag, props);
      return makeInstance(tag, fabricNode, 'ActivityIndicator', type);
    }

    if (type === 'text') {
      // Outer <Text> → Paragraph (Yoga layout + AttributedString
      // owner). Top-level text-style props become the default
      // TextAttributes for descendant fragments.
      const tag = newTag();
      const fabricNode = currentFabric.createNode(
        tag,
        'Paragraph',
        currentSurfaceId,
        buildFabricProps('text', props),
        internalInstanceHandle,
      );
      syncLayoutHandler(tag, props);
      return makeInstance(tag, fabricNode, 'Paragraph', type);
    }

    if (type === 'innertext') {
      // Nested <Text> inside another <Text> → Text shadow node.
      // Data-only (no widget); Fabric walks Text + RawText descendants
      // of the nearest Paragraph to build the AttributedString. The
      // Text shadow node's TextAttributes override the parent
      // Paragraph's for the fragments under this branch — that's how
      // mixed-style runs come out as multiple Pango <span>s.
      const tag = newTag();
      const fabricNode = currentFabric.createNode(
        tag,
        'Text',
        currentSurfaceId,
        buildFabricProps('text', props),
        internalInstanceHandle,
      );
      return makeInstance(tag, fabricNode, 'Text', type);
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
    return makeInstance(tag, fabricNode, 'RawText', 'rawtext');
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
    if (type === 'textinput') {
      syncChangeTextHandler(currentInstance.tag, newProps);
      syncSubmitEditingHandler(currentInstance.tag, newProps);
      syncKeyPressHandler(currentInstance.tag, newProps);
    }
    if (type === 'scrollview') syncScrollHandler(currentInstance.tag, newProps);
    if (type === 'switch') syncSwitchHandler(currentInstance.tag, newProps);
    // onLayout lives on every host type; rebind on every commit so the
    // freshest callback is in the registry.
    syncLayoutHandler(currentInstance.tag, newProps);
    return makeInstance(currentInstance.tag, fabricNode, currentInstance.componentName, type);
  },

  // Used inside Fabric's `<hidden>` Offscreen branch — we don't have
  // a visibility primitive yet, so just return a clone with the same
  // props (no Pango layer needed to honour `display: none`).
  cloneHiddenInstance(currentInstance, type, _props /*, internalInstanceHandle */) {
    return makeInstance(
      currentInstance.tag,
      currentFabric.cloneNode(currentInstance.fabricNode),
      currentInstance.componentName,
      type,
    );
  },
  cloneHiddenTextInstance(currentInstance /*, text, internalInstanceHandle */) {
    return makeInstance(
      currentInstance.tag,
      currentFabric.cloneNode(currentInstance.fabricNode),
      currentInstance.componentName,
      currentInstance.type,
    );
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
