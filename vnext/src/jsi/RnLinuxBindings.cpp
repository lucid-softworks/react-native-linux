#include "RnLinuxBindings.h"

#include "../camera/Camera.h"
#include "../deviceinfo/DeviceInfo.h"
#include "../filesystem/FileSystem.h"
#include "../location/Location.h"
#include "../notifications/Notifications.h"
#include "react-native-linux/Logging.h"

#include <array>
#include <atomic>
#include <cstdio>
#include <gtk/gtk.h>
#include <jsi/jsi.h>
#include <string>
#include <unordered_map>
#include <vector>

namespace rnlinux {

// Storage backing lives in vnext/src/storage/AsyncStorage.cpp. The
// JSI rnLinux.storage* bindings below forward into these four.
std::string asyncStorageRead(const std::string& key);
void asyncStorageWrite(const std::string& key, const std::string& value);
void asyncStorageRemove(const std::string& key);
std::vector<std::string> asyncStorageKeys();

namespace {

using namespace facebook;

// Node registry — JS hands us integer handles, we map them to GtkWidget*.
// Lifetimes: the handle keeps the widget alive via GTK refcounting; when a
// node is removed from the tree, its parent unparents it and the
// container's last-ref-released hook destroys the widget. We don't
// explicitly delete entries on remove because nodes may be re-parented;
// they get cleaned up when setRoot replaces the tree.
//
// For the lightning MVP this is acceptable. A real impl would track
// reference counts and emit explicit destroy events.
struct State {
  GtkWidget* rootView = nullptr;
  std::atomic<int> nextId{1};
  std::unordered_map<int, GtkWidget*> nodes;
  // Click handlers — registered by `rnLinux.onClick(nodeId, fn)` and
  // invoked from GtkGestureClick's `released` signal. We're
  // single-threaded today so calling into the runtime from the GTK
  // callback is safe.
  jsi::Runtime* runtime = nullptr;
  std::unordered_map<int, std::shared_ptr<jsi::Function>> clickHandlers;

  // Fabric-tag-keyed click handlers — registered by JS via
  // `rnLinux.fabricOnClick(tag, fn)`. Looked up by tag from the
  // C++ component-view layer when its gesture fires.
  std::unordered_map<int, std::shared_ptr<jsi::Function>> fabricClickHandlers;

  // Text-change handlers for TextInput. Keyed by Fabric tag; the
  // C++ view (TextInputComponentView) dispatches with the new text.
  std::unordered_map<int, std::shared_ptr<jsi::Function>> fabricChangeTextHandlers;

  // Scroll handlers for ScrollView. The C++ view subscribes to
  // GtkAdjustment value-changed and routes through dispatchFabricScroll.
  // Keyed by Fabric tag.
  std::unordered_map<int, std::shared_ptr<jsi::Function>> fabricScrollHandlers;

  // Switch onValueChange handlers. The C++ view subscribes to GtkSwitch
  // notify::active and routes through dispatchFabricSwitchChange.
  std::unordered_map<int, std::shared_ptr<jsi::Function>> fabricSwitchHandlers;

  // TextInput Enter-pressed (onSubmitEditing) handlers.
  std::unordered_map<int, std::shared_ptr<jsi::Function>> fabricSubmitEditingHandlers;

  // TextInput per-keystroke (onKeyPress) handlers.
  std::unordered_map<int, std::shared_ptr<jsi::Function>> fabricKeyPressHandlers;

  // TextInput focus / blur handlers. Paper's TextInput.Outlined animates
  // its floating label off the JS-side `focused` state derived from
  // these — without the dispatch the label stays inline and the typed
  // text overlays it.
  std::unordered_map<int, std::shared_ptr<jsi::Function>> fabricFocusHandlers;
  std::unordered_map<int, std::shared_ptr<jsi::Function>> fabricBlurHandlers;

  // onLayout handlers — fired from LinuxComponentView::updateLayoutMetrics
  // whenever a view's frame changes. Keyed by Fabric tag; payload mirrors
  // RN's {nativeEvent: {layout: {x, y, width, height}}} shape so apps can
  // copy-paste handlers across platforms. RN libraries (Paper's TextInput
  // container width measurement, FlatList's onLayout-driven viewport
  // tracking, every wrapper that reacts to its rendered size) depend on
  // this — without it inputContainerLayout stays at the default {width:65}
  // and floating labels render in a 65-px box.
  std::unordered_map<int, std::shared_ptr<jsi::Function>> fabricLayoutHandlers;
  // Last-dispatched layout per tag — skip redundant calls when the
  // metrics didn't actually move/resize. updateLayoutMetrics can fire
  // multiple times per commit (mounting transaction → state update →
  // re-layout); JS handlers shouldn't see identical events back-to-back.
  std::unordered_map<int, std::array<float, 4>> fabricLayoutLast;

  // Active intervals/timers. `handlerId → (sourceId, fn)`. We keep the
  // jsi::Function alive here so the GTK source can call back into JS
  // safely; resetRnLinuxBindings drops these on reload so dangling
  // sources don't fire into a destroyed runtime.
  std::unordered_map<int, std::pair<guint, std::shared_ptr<jsi::Function>>> timerHandlers;
  int nextTimerId{1};

  // Tag → widget lookup, set by the host. Lets the Animated native
  // driver tweak Fabric widgets directly without round-tripping
  // through React/Fabric on every frame.
  std::function<GtkWidget*(int)> fabricLookup;

  // Reload trigger — host wires its reload() in via
  // setReloadCallbackForJsi. JS can hit it via rnLinux.reloadApp
  // (the LogBox overlay's Reload button uses this).
  std::function<void()> reload;

  // nativeID-string → widget map for the Animated native-driver path.
  // Populated by ViewComponentView::updateProps when JS sets a
  // `nativeID` prop; consumed by rnLinux.setNativeProp(stringId, …).
  std::unordered_map<std::string, GtkWidget*> animWidgets;

  // GeoClue2 location client. Lazily created on first
  // rnLinux.locationStartWatch; reset on JS reload so a fresh
  // bundle doesn't inherit the old client + dangling JS callbacks.
  std::unique_ptr<rnlinux::location::LocationClient> location;
  std::shared_ptr<jsi::Function> locationOnFix;
  std::shared_ptr<jsi::Function> locationOnError;

  int registerWidget(GtkWidget* w) {
    int id = nextId.fetch_add(1);
    nodes[id] = w;
    return id;
  }

  GtkWidget* lookup(int id) {
    auto it = nodes.find(id);
    return it == nodes.end() ? nullptr : it->second;
  }
};

State& state() {
  static State s;
  return s;
}

// Helper: install a function on `target` under `name` taking `nargs` args.
template <typename Fn>
void bindMethod(jsi::Runtime& rt, jsi::Object& target, const char* name, unsigned nargs, Fn&& fn) {
  auto propName = jsi::PropNameID::forUtf8(rt, name);
  target.setProperty(
      rt,
      propName,
      jsi::Function::createFromHostFunction(rt, propName, nargs, std::forward<Fn>(fn)));
}

// Convenience: build a per-widget CSS provider so JS can change background
// colors without leaking style across siblings.
GtkCssProvider* ensureCssProvider(GtkWidget* w) {
  auto* p = static_cast<GtkCssProvider*>(g_object_get_data(G_OBJECT(w), "rnl-css-provider"));
  if (p)
    return p;
  p = gtk_css_provider_new();
  g_object_set_data_full(G_OBJECT(w), "rnl-css-provider", p, g_object_unref);
  gtk_style_context_add_provider_for_display(
      gtk_widget_get_display(w), GTK_STYLE_PROVIDER(p), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
  return p;
}

} // namespace

void resetRnLinuxBindings() {
  // Drop click handlers FIRST while the runtime is still alive — the
  // jsi::Function destructors talk to the runtime to release their
  // shared roots. Doing this in installRnLinuxBindings is too late,
  // because by then the old runtime has been destroyed.
  for (auto& [id, entry] : state().timerHandlers) {
    g_source_remove(entry.first);
  }
  state().timerHandlers.clear();
  state().clickHandlers.clear();
  state().fabricClickHandlers.clear();
  state().fabricChangeTextHandlers.clear();
  state().fabricSwitchHandlers.clear();
  state().fabricSubmitEditingHandlers.clear();
  state().fabricKeyPressHandlers.clear();
  state().fabricScrollHandlers.clear();
  state().fabricLayoutHandlers.clear();
  state().fabricLayoutLast.clear();
  state().fabricFocusHandlers.clear();
  state().fabricBlurHandlers.clear();
  // Tear down the GeoClue client BEFORE the runtime goes away — its
  // signal callback dereferences state().runtime when a fix arrives,
  // and an in-flight reload could otherwise fire onLocationSignal
  // against a freed Hermes instance.
  if (state().location) {
    state().location->stopWatch();
    state().location.reset();
  }
  state().locationOnFix.reset();
  state().locationOnError.reset();
  // Notifications state is decoupled from this State struct (lives
  // in vnext/src/notifications), but it captures jsi::Function refs
  // into the old runtime too — clear it through the same reload
  // boundary so libnotify's signal callbacks don't fire into a
  // freed Hermes.
  rnlinux::notifications::reset();
  state().nodes.clear();
  state().nextId = 1;
  state().nextTimerId = 1;
  state().runtime = nullptr;
  state().rootView = nullptr;
}

// Forward a caught JSError into JS's ErrorUtils.reportError so the
// LogBox ErrorBoundary can render. Without this every uncaught throw
// from an event handler died at the C++ log line and the user got no
// in-window feedback.
void reportJsErrorToErrorUtils(jsi::Runtime& rt, const jsi::JSError& e) {
  try {
    auto errorUtils = rt.global().getProperty(rt, "ErrorUtils");
    if (!errorUtils.isObject())
      return;
    auto reportError = errorUtils.asObject(rt).getProperty(rt, "reportError");
    if (!reportError.isObject())
      return;
    reportError.asObject(rt).asFunction(rt).call(rt, e.value());
    rt.drainMicrotasks();
  } catch (const std::exception&) {
    // ErrorUtils path itself blew up — silent fallback so we don't loop.
  }
}

void dispatchFabricClick(int tag) {
  auto& s = state();
  if (!s.runtime)
    return;
  auto it = s.fabricClickHandlers.find(tag);
  if (it == s.fabricClickHandlers.end())
    return;
  try {
    it->second->call(*s.runtime);
    // React schedules state-update work on a microtask; drain so the
    // resulting commit happens before this turn yields.
    s.runtime->drainMicrotasks();
  } catch (const jsi::JSError& e) {
    RNL_LOGE("rnLinux") << "fabric click handler threw: " << e.getMessage();
    reportJsErrorToErrorUtils(*s.runtime, e);
  } catch (const std::exception& e) {
    RNL_LOGE("rnLinux") << "fabric click handler threw: " << e.what();
  }
}

void setFabricWidgetLookupForJsi(std::function<GtkWidget*(int)> lookup) {
  state().fabricLookup = std::move(lookup);
}

void setReloadCallbackForJsi(std::function<void()> reload) {
  state().reload = std::move(reload);
}

void registerAnimWidget(const std::string& nativeId, GtkWidget* widget) {
  if (nativeId.empty() || !widget)
    return;
  state().animWidgets[nativeId] = widget;
}

void unregisterAnimWidget(const std::string& nativeId) {
  if (nativeId.empty())
    return;
  state().animWidgets.erase(nativeId);
}

void dispatchFabricChangeText(int tag, const std::string& text) {
  auto& s = state();
  if (!s.runtime)
    return;
  auto it = s.fabricChangeTextHandlers.find(tag);
  if (it == s.fabricChangeTextHandlers.end())
    return;
  try {
    it->second->call(*s.runtime, jsi::String::createFromUtf8(*s.runtime, text));
    s.runtime->drainMicrotasks();
  } catch (const jsi::JSError& e) {
    RNL_LOGE("rnLinux") << "fabric changeText handler threw: " << e.getMessage();
  } catch (const std::exception& e) {
    RNL_LOGE("rnLinux") << "fabric changeText handler threw: " << e.what();
  }
}

void dispatchFabricSubmitEditing(int tag) {
  auto& s = state();
  if (!s.runtime)
    return;
  auto it = s.fabricSubmitEditingHandlers.find(tag);
  if (it == s.fabricSubmitEditingHandlers.end())
    return;
  try {
    it->second->call(*s.runtime);
    s.runtime->drainMicrotasks();
  } catch (const std::exception& e) {
    RNL_LOGE("rnLinux") << "fabric submitEditing handler threw: " << e.what();
  }
}

void dispatchFabricKeyPress(int tag, const std::string& key) {
  auto& s = state();
  if (!s.runtime)
    return;
  auto it = s.fabricKeyPressHandlers.find(tag);
  if (it == s.fabricKeyPressHandlers.end())
    return;
  try {
    it->second->call(*s.runtime, jsi::String::createFromUtf8(*s.runtime, key));
    s.runtime->drainMicrotasks();
  } catch (const std::exception& e) {
    RNL_LOGE("rnLinux") << "fabric keyPress handler threw: " << e.what();
  }
}

void dispatchFabricSwitchChange(int tag, bool value) {
  auto& s = state();
  if (!s.runtime)
    return;
  auto it = s.fabricSwitchHandlers.find(tag);
  if (it == s.fabricSwitchHandlers.end())
    return;
  try {
    it->second->call(*s.runtime, jsi::Value(value));
    s.runtime->drainMicrotasks();
  } catch (const jsi::JSError& e) {
    RNL_LOGE("rnLinux") << "fabric switchChange handler threw: " << e.getMessage();
  } catch (const std::exception& e) {
    RNL_LOGE("rnLinux") << "fabric switchChange handler threw: " << e.what();
  }
}

void dispatchFabricScroll(int tag,
                          double offsetX,
                          double offsetY,
                          double contentWidth,
                          double contentHeight,
                          double viewportWidth,
                          double viewportHeight) {
  auto& s = state();
  if (!s.runtime)
    return;
  auto it = s.fabricScrollHandlers.find(tag);
  if (it == s.fabricScrollHandlers.end())
    return;
  jsi::Runtime& rt = *s.runtime;
  try {
    // Synthesize a nativeEvent that matches RN's shape so apps that
    // copy-paste FlatList/ScrollView handlers don't have to learn a
    // new event format.
    jsi::Object offset(rt);
    offset.setProperty(rt, "x", offsetX);
    offset.setProperty(rt, "y", offsetY);
    jsi::Object contentSize(rt);
    contentSize.setProperty(rt, "width", contentWidth);
    contentSize.setProperty(rt, "height", contentHeight);
    jsi::Object layout(rt);
    layout.setProperty(rt, "width", viewportWidth);
    layout.setProperty(rt, "height", viewportHeight);
    jsi::Object nativeEvent(rt);
    nativeEvent.setProperty(rt, "contentOffset", offset);
    nativeEvent.setProperty(rt, "contentSize", contentSize);
    nativeEvent.setProperty(rt, "layoutMeasurement", layout);
    jsi::Object event(rt);
    event.setProperty(rt, "nativeEvent", nativeEvent);
    it->second->call(rt, event);
    // NOTE: deliberately no drainMicrotasks here. Scroll fires up to
    // 60 Hz and FlatList's setScrollY only changes when the window
    // window of items actually shifts — let React batch with the
    // surrounding work instead of forcing a commit per pixel.
  } catch (const jsi::JSError& e) {
    RNL_LOGE("rnLinux") << "fabric scroll handler threw: " << e.getMessage();
  } catch (const std::exception& e) {
    RNL_LOGE("rnLinux") << "fabric scroll handler threw: " << e.what();
  }
}

void dispatchFabricFocus(int tag) {
  auto& s = state();
  if (!s.runtime)
    return;
  auto it = s.fabricFocusHandlers.find(tag);
  if (it == s.fabricFocusHandlers.end())
    return;
  jsi::Runtime& rt = *s.runtime;
  try {
    jsi::Object nativeEvent(rt);
    nativeEvent.setProperty(rt, "target", tag);
    jsi::Object event(rt);
    event.setProperty(rt, "nativeEvent", nativeEvent);
    event.setProperty(rt, "target", tag);
    it->second->call(rt, event);
  } catch (const jsi::JSError& e) {
    RNL_LOGE("rnLinux") << "fabric focus handler threw: " << e.getMessage();
  } catch (const std::exception& e) {
    RNL_LOGE("rnLinux") << "fabric focus handler threw: " << e.what();
  }
}

void dispatchFabricBlur(int tag) {
  auto& s = state();
  if (!s.runtime)
    return;
  auto it = s.fabricBlurHandlers.find(tag);
  if (it == s.fabricBlurHandlers.end())
    return;
  jsi::Runtime& rt = *s.runtime;
  try {
    jsi::Object nativeEvent(rt);
    nativeEvent.setProperty(rt, "target", tag);
    jsi::Object event(rt);
    event.setProperty(rt, "nativeEvent", nativeEvent);
    event.setProperty(rt, "target", tag);
    it->second->call(rt, event);
  } catch (const jsi::JSError& e) {
    RNL_LOGE("rnLinux") << "fabric blur handler threw: " << e.getMessage();
  } catch (const std::exception& e) {
    RNL_LOGE("rnLinux") << "fabric blur handler threw: " << e.what();
  }
}

void dispatchFabricLayout(int tag, float x, float y, float w, float h) {
  auto& s = state();
  if (!s.runtime)
    return;
  auto it = s.fabricLayoutHandlers.find(tag);
  if (it == s.fabricLayoutHandlers.end())
    return;
  // Skip if this view's layout hasn't actually changed since the last
  // dispatch — a single React commit can fire updateLayoutMetrics
  // multiple times (Yoga relayout passes, state-driven re-runs), and
  // RN apps loop forever if onLayout keeps re-firing for the same
  // metrics (handler calls setState → re-render → re-layout → re-fire).
  std::array<float, 4> next{x, y, w, h};
  auto& last = s.fabricLayoutLast[tag];
  if (last == next)
    return;
  last = next;
  jsi::Runtime& rt = *s.runtime;
  try {
    jsi::Object layout(rt);
    layout.setProperty(rt, "x", static_cast<double>(x));
    layout.setProperty(rt, "y", static_cast<double>(y));
    layout.setProperty(rt, "width", static_cast<double>(w));
    layout.setProperty(rt, "height", static_cast<double>(h));
    jsi::Object nativeEvent(rt);
    nativeEvent.setProperty(rt, "layout", layout);
    nativeEvent.setProperty(rt, "target", tag);
    jsi::Object event(rt);
    event.setProperty(rt, "nativeEvent", nativeEvent);
    event.setProperty(rt, "target", tag);
    it->second->call(rt, event);
  } catch (const jsi::JSError& e) {
    RNL_LOGE("rnLinux") << "fabric layout handler threw: " << e.getMessage();
  } catch (const std::exception& e) {
    RNL_LOGE("rnLinux") << "fabric layout handler threw: " << e.what();
  }
}

void installRnLinuxBindings(jsi::Runtime& rt, GtkWidget* rootView) {
  // Defensive: by the time we get here resetRnLinuxBindings() should
  // already have run from RNLinuxHost::stop() — but a clean cycle is
  // cheap if it didn't.
  state().clickHandlers.clear();
  state().nodes.clear();
  state().nextId = 1;
  state().rootView = rootView;
  // Stash the runtime so the GTK-signal trampoline below can call back
  // into JS without going through a captured lambda (which would have
  // to outlive its host function).
  state().runtime = &rt;

  jsi::Object rnLinux{rt};

  bindMethod(rt,
             rnLinux,
             "createLabel",
             0,
             [](jsi::Runtime& rt,
                const jsi::Value& /*thisVal*/,
                const jsi::Value* /*args*/,
                size_t /*count*/) -> jsi::Value {
               auto* label = gtk_label_new("");
               gtk_label_set_xalign(GTK_LABEL(label), 0.0f);
               gtk_label_set_yalign(GTK_LABEL(label), 0.0f);
               int id = state().registerWidget(label);
               return jsi::Value{id};
             });

  bindMethod(rt,
             rnLinux,
             "createBox",
             0,
             [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               auto* box = gtk_fixed_new();
               int id = state().registerWidget(box);
               return jsi::Value{id};
             });

  bindMethod(
      rt,
      rnLinux,
      "setText",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        std::string text = args[1].asString(rt).utf8(rt);
        GtkWidget* w = state().lookup(id);
        if (w && GTK_IS_LABEL(w))
          gtk_label_set_text(GTK_LABEL(w), text.c_str());
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "setBounds",
      5,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 5)
          return jsi::Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        int x = static_cast<int>(args[1].asNumber());
        int y = static_cast<int>(args[2].asNumber());
        int w = static_cast<int>(args[3].asNumber());
        int h = static_cast<int>(args[4].asNumber());
        GtkWidget* widget = state().lookup(id);
        if (!widget)
          return jsi::Value::undefined();
        gtk_widget_set_size_request(widget, w, h);
        GtkWidget* parent = gtk_widget_get_parent(widget);
        if (parent && GTK_IS_FIXED(parent)) {
          gtk_fixed_move(GTK_FIXED(parent), widget, x, y);
        }
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "setBackgroundColor",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        std::string color = args[1].asString(rt).utf8(rt);
        GtkWidget* w = state().lookup(id);
        if (!w)
          return jsi::Value::undefined();
        auto* provider = ensureCssProvider(w);
        // Tag the widget with a CSS name we can target.
        char name[32];
        std::snprintf(name, sizeof(name), "rnl-%d", id);
        gtk_widget_set_name(w, name);
        char css[128];
        std::snprintf(css, sizeof(css), "#%s { background-color: %s; }", name, color.c_str());
        gtk_css_provider_load_from_string(provider, css);
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "appendChild",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int parentId = static_cast<int>(args[0].asNumber());
        int childId = static_cast<int>(args[1].asNumber());
        GtkWidget* parent = state().lookup(parentId);
        GtkWidget* child = state().lookup(childId);
        if (!parent || !child)
          return jsi::Value::undefined();
        if (!GTK_IS_FIXED(parent)) {
          RNL_LOGW("rnLinux") << "appendChild: parent " << parentId << " is not a GtkFixed";
          return jsi::Value::undefined();
        }
        // If already parented somewhere, detach first.
        if (auto* current = gtk_widget_get_parent(child)) {
          if (GTK_IS_FIXED(current))
            gtk_fixed_remove(GTK_FIXED(current), child);
        }
        gtk_fixed_put(GTK_FIXED(parent), child, 0, 0);
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "removeChild",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int parentId = static_cast<int>(args[0].asNumber());
        int childId = static_cast<int>(args[1].asNumber());
        GtkWidget* parent = state().lookup(parentId);
        GtkWidget* child = state().lookup(childId);
        if (parent && child && GTK_IS_FIXED(parent)) {
          gtk_fixed_remove(GTK_FIXED(parent), child);
        }
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "setRoot",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        GtkWidget* child = state().lookup(id);
        GtkWidget* root = state().rootView;
        if (!child || !root || !GTK_IS_FIXED(root))
          return jsi::Value::undefined();
        // Remove any existing children so React owns the canvas.
        GtkWidget* existing = gtk_widget_get_first_child(root);
        while (existing) {
          GtkWidget* next = gtk_widget_get_next_sibling(existing);
          gtk_fixed_remove(GTK_FIXED(root), existing);
          existing = next;
        }
        if (auto* current = gtk_widget_get_parent(child)) {
          if (GTK_IS_FIXED(current))
            gtk_fixed_remove(GTK_FIXED(current), child);
        }
        gtk_fixed_put(GTK_FIXED(root), child, 0, 0);
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "log",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        std::string level = count > 0 ? args[0].asString(rt).utf8(rt) : "info";
        std::string msg = count > 1 ? args[1].asString(rt).utf8(rt) : "";
        if (level == "error")
          RNL_LOGE("js") << msg;
        else if (level == "warn")
          RNL_LOGW("js") << msg;
        else
          RNL_LOGI("js") << msg;
        return jsi::Value::undefined();
      });

  // `rnLinux.onClick(nodeId, fn | null)` — install / replace / remove a
  // press handler. fn is invoked once per click (released-after-press)
  // with no arguments. Passing null detaches the handler; the
  // GtkGestureClick controller stays attached (cheap) but inert.
  bindMethod(
      rt,
      rnLinux,
      "onClick",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        GtkWidget* w = state().lookup(id);
        if (!w)
          return jsi::Value::undefined();

        if (args[1].isNull() || args[1].isUndefined()) {
          state().clickHandlers.erase(id);
          return jsi::Value::undefined();
        }
        state().clickHandlers[id] =
            std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));

        // Add a GtkGestureClick once per widget; subsequent calls just
        // replace the stored jsi::Function above.
        if (!g_object_get_data(G_OBJECT(w), "rnl-click-gesture")) {
          auto* gesture = gtk_gesture_click_new();
          g_object_set_data_full(G_OBJECT(w), "rnl-click-gesture", gesture, g_object_unref);
          auto idPayload = GINT_TO_POINTER(id);
          g_signal_connect_data(gesture,
                                "released",
                                G_CALLBACK(+[](GtkGestureClick* /*gc*/,
                                               int /*n_press*/,
                                               double /*x*/,
                                               double /*y*/,
                                               gpointer ud) {
                                  int nodeId = GPOINTER_TO_INT(ud);
                                  auto it = state().clickHandlers.find(nodeId);
                                  if (it == state().clickHandlers.end() || !state().runtime)
                                    return;
                                  try {
                                    it->second->call(*state().runtime);
                                    // React's scheduler queues the re-render on a microtask
                                    // (our setTimeout shim ends up doing Promise.resolve().then).
                                    // Hermes only auto-drains the queue at evaluateJavaScript
                                    // boundaries, so we drain explicitly here — otherwise the
                                    // post-setState commit never happens until the next
                                    // unrelated JS entry-point.
                                    state().runtime->drainMicrotasks();
                                  } catch (const jsi::JSError& e) {
                                    RNL_LOGE("rnLinux")
                                        << "click handler threw: " << e.getMessage();
                                  } catch (const std::exception& e) {
                                    RNL_LOGE("rnLinux") << "click handler threw: " << e.what();
                                  }
                                }),
                                idPayload,
                                /*destroy=*/nullptr,
                                /*flags=*/static_cast<GConnectFlags>(0));
          gtk_widget_add_controller(w, GTK_EVENT_CONTROLLER(gesture));
        }
        return jsi::Value::undefined();
      });

  // requestAnimationFrame backed by g_timeout_add at ~60fps. Real RN
  // schedules these on the platform's native compositor vsync; we'd
  // wire to GdkFrameClock for that, but a 16ms tick is fine for the
  // playground demo work.
  bindMethod(
      rt,
      rnLinux,
      "requestAnimationFrame",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::undefined();
        auto fn = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
        int handlerId = state().nextTimerId++;
        // One-shot — return G_SOURCE_REMOVE inside the callback.
        guint sourceId = g_timeout_add(
            16,
            +[](gpointer ud) -> gboolean {
              int hid = GPOINTER_TO_INT(ud);
              auto it = state().timerHandlers.find(hid);
              if (it == state().timerHandlers.end() || !state().runtime) {
                return G_SOURCE_REMOVE;
              }
              auto fn = it->second.second;
              // Pull the entry out of the map BEFORE calling — apps
              // commonly schedule the next rAF from inside the callback
              // and the new id reuses the slot if we leave it stale.
              state().timerHandlers.erase(it);
              try {
                // rAF fires the callback with a high-res timestamp in
                // milliseconds — RN/web convention. We compute from
                // GLib's monotonic time so consecutive rAFs see a
                // strictly-monotonic clock.
                const double tMs = g_get_monotonic_time() / 1000.0;
                const gint64 t0 = g_get_monotonic_time();
                fn->call(*state().runtime, jsi::Value{tMs});
                const gint64 t1 = g_get_monotonic_time();
                state().runtime->drainMicrotasks();
                const gint64 t2 = g_get_monotonic_time();
                // Light-weight rolling profile so we can see WHICH phase
                // of the rAF is slow. n=60 ≈ 1 s at 60 Hz.
                struct RafProf {
                  int n = 0;
                  gint64 jsUs = 0, drainUs = 0, maxUs = 0;
                };
                static RafProf p;
                p.n++;
                p.jsUs += (t1 - t0);
                p.drainUs += (t2 - t1);
                if ((t2 - t0) > p.maxUs)
                  p.maxUs = (t2 - t0);
                if (p.n >= 60) {
                  RNL_LOGI("rnLinux.rafProf") << "n=" << p.n << " avg_js=" << (p.jsUs / p.n) << "us"
                                              << " avg_drain=" << (p.drainUs / p.n) << "us"
                                              << " max_total=" << p.maxUs << "us";
                  p = {};
                }
              } catch (const jsi::JSError& e) {
                // Include the stack so we can tell WHICH chain is overflowing
                // — generic "Maximum call stack size exceeded" doesn't say.
                RNL_LOGE("rnLinux") << "rAF threw: " << e.getMessage() << "\n    stack:\n"
                                    << e.getStack();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux") << "rAF threw: " << e.what();
              }
              return G_SOURCE_REMOVE;
            },
            GINT_TO_POINTER(handlerId));
        state().timerHandlers[handlerId] = {sourceId, std::move(fn)};
        return jsi::Value{handlerId};
      });

  bindMethod(rt,
             rnLinux,
             "cancelAnimationFrame",
             1,
             [](jsi::Runtime& /*rt*/, const jsi::Value&, const jsi::Value* args, size_t count)
                 -> jsi::Value {
               if (count < 1)
                 return jsi::Value::undefined();
               int handlerId = static_cast<int>(args[0].asNumber());
               auto it = state().timerHandlers.find(handlerId);
               if (it != state().timerHandlers.end()) {
                 g_source_remove(it->second.first);
                 state().timerHandlers.erase(it);
               }
               return jsi::Value::undefined();
             });

  // Real timers backed by g_timeout_add. JS+GTK share a thread today,
  // so the GTK source callback can call into the runtime directly.
  // setInterval returns a JS-visible handler id; clearInterval removes
  // the underlying GTK source and drops our Function reference.
  bindMethod(
      rt,
      rnLinux,
      "setInterval",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        auto fn = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
        guint ms = static_cast<guint>(args[1].asNumber());
        int handlerId = state().nextTimerId++;
        guint sourceId = g_timeout_add(
            ms,
            +[](gpointer ud) -> gboolean {
              int hid = GPOINTER_TO_INT(ud);
              auto it = state().timerHandlers.find(hid);
              if (it == state().timerHandlers.end() || !state().runtime) {
                return G_SOURCE_REMOVE;
              }
              try {
                it->second.second->call(*state().runtime);
                state().runtime->drainMicrotasks();
              } catch (const jsi::JSError& e) {
                RNL_LOGE("rnLinux") << "interval threw: " << e.getMessage();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux") << "interval threw: " << e.what();
              }
              return G_SOURCE_CONTINUE;
            },
            GINT_TO_POINTER(handlerId));
        state().timerHandlers[handlerId] = {sourceId, std::move(fn)};
        return jsi::Value{handlerId};
      });

  // Fabric click registry. The Fabric host config (apps/playground/runtime/
  // fabricHostConfig.js) calls this whenever a <View onClick={fn}> shadow
  // node is created or its handler changes. We key by the Fabric tag —
  // ViewComponentView's gesture controller looks the function up via
  // dispatchFabricClick(tag) when GtkGestureClick fires.
  bindMethod(
      rt,
      rnLinux,
      "fabricOnClick",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int tag = static_cast<int>(args[0].asNumber());
        if (args[1].isNull() || args[1].isUndefined()) {
          state().fabricClickHandlers.erase(tag);
          return jsi::Value::undefined();
        }
        state().fabricClickHandlers[tag] =
            std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));
        return jsi::Value::undefined();
      });

  // Native-driver hook for Animated. Bypasses React/Fabric: JS hands
  // us a stable nativeID and we poke the GTK widget directly, 60 Hz,
  // skipping reconcile → commit → mount per frame. arg0 is either an
  // integer Fabric tag (fallback path) or a string nativeID (preferred
  // — our reconciler doesn't support refs cleanly, so animated.js
  // generates a unique nativeID per Animated.* component and threads
  // it through ViewComponentView::updateProps to register the widget).
  bindMethod(
      rt,
      rnLinux,
      "setNativeProp",
      3,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 3)
          return jsi::Value::undefined();
        const auto& s = state();
        GtkWidget* w = nullptr;
        if (args[0].isString()) {
          const auto id = args[0].asString(rt).utf8(rt);
          auto it = s.animWidgets.find(id);
          if (it != s.animWidgets.end())
            w = it->second;
        } else if (args[0].isNumber() && s.fabricLookup) {
          const int tag = static_cast<int>(args[0].asNumber());
          w = s.fabricLookup(tag);
        }
        if (!w)
          return jsi::Value::undefined();
        const auto prop = args[1].asString(rt).utf8(rt);
        const double v = args[2].asNumber();
        if (prop == "opacity") {
          // gtk_widget_set_opacity invalidates a redraw on every call. Skip
          // when the value is unchanged — Animated.timing fires the same
          // listener for every interpolated value the chain produces, so
          // multiple consumers of the same Animated.Value can stack
          // up no-op calls per frame.
          if (gtk_widget_get_opacity(w) != v) {
            gtk_widget_set_opacity(w, v);
          }
        } else if (prop == "translateX" || prop == "translateY" || prop == "scale" ||
                   prop == "scaleX" || prop == "scaleY") {
          // Use gtk_fixed_set_child_transform (paint-only) instead of
          // gtk_fixed_move (which queues a relayout cascade up the entire
          // ancestor chain — that's death for an Animated.loop running at
          // 60 Hz). The transform composes on top of Yoga's layout origin
          // and only dirties the rendered region.
          //
          // Paper's TextInput.Outlined floating label rides three
          // separate Animated values (translateX, translateY, scale)
          // off the same `labeled` driver — each fires setNativeProp
          // independently, so we have to preserve the OTHER components
          // when one updates. Read the existing GskTransform as an
          // affine 2D matrix (xx · sx, yy · sy, dx, dy), patch the
          // requested field, then rebuild scale · translate.
          GtkWidget* parent = gtk_widget_get_parent(w);
          if (parent && GTK_IS_FIXED(parent)) {
            // Layout origin is stamped onto the widget by
            // LinuxComponentView::updateLayoutMetrics. We anchor the
            // animation translate against it instead of overwriting the
            // GtkFixed transform wholesale — gtk_fixed_move's translate
            // and gsk_transform_translate share the same slot, so a
            // bare write would lose the layout position.
            const float layoutX =
                static_cast<float>(GPOINTER_TO_INT(g_object_get_data(G_OBJECT(w), "rnl-layout-x")));
            const float layoutY =
                static_cast<float>(GPOINTER_TO_INT(g_object_get_data(G_OBJECT(w), "rnl-layout-y")));
            GskTransform* cur = gtk_fixed_get_child_transform(GTK_FIXED(parent), w);
            GskTransformCategory cat =
                cur ? gsk_transform_get_category(cur) : GSK_TRANSFORM_CATEGORY_IDENTITY;
            const bool is2d = cat >= GSK_TRANSFORM_CATEGORY_2D;
            // Start from the layout origin (no scale) — if the existing
            // transform is 2D-decomposable we replace these with its
            // values, otherwise we use the layout origin as the
            // sibling-component baseline. Falling back to (0,0,1,1)
            // here strips layoutX/Y the first time a setNativeProp
            // races a Fabric updateProps that left the transform with
            // category UNKNOWN (gsk_transform_to_2d won't read those).
            float xx = 1, yx = 0, xy = 0, yy = 1, dx = layoutX, dy = layoutY;
            if (cur && is2d) {
              gsk_transform_to_2d(cur, &xx, &yx, &xy, &yy, &dx, &dy);
            }
            float sx = xx;
            float sy = yy;
            const float vf = static_cast<float>(v);
            if (prop == "translateX")
              dx = layoutX + vf;
            else if (prop == "translateY")
              dy = layoutY + vf;
            else if (prop == "scale") {
              sx = vf;
              sy = vf;
            } else if (prop == "scaleX")
              sx = vf;
            else if (prop == "scaleY")
              sy = vf;
            // Compose translate(dx, dy) · scale(sx, sy). For a local
            // point p the final position is (sx·px + dx, sy·py + dy)
            // — origin-at-(0,0) scaling, which is what Paper assumes
            // for its label (no transform-origin set on the animated
            // host so the default `[0,0]` we use here matches RN's
            // native-driver path on iOS/Android).
            graphene_point_t pt = {dx, dy};
            GskTransform* next = gsk_transform_translate(nullptr, &pt);
            next = gsk_transform_scale(next, sx, sy);
            gtk_fixed_set_child_transform(GTK_FIXED(parent), w, next);
            gsk_transform_unref(next);
          }
        }
        return jsi::Value::undefined();
      });

  // Instance-method backing for ref.current.measure / measureInWindow.
  // RN's `measure(callback)` callback receives (x, y, width, height,
  // pageX, pageY); `measureInWindow(callback)` gets (pageX, pageY,
  // width, height). We return all six in one host call so the JS side
  // can fan out without round-tripping.
  //
  // GTK4 unit is logical pixels at the widget's display scale factor —
  // same convention RN uses, so we pass values through untouched.
  bindMethod(
      rt,
      rnLinux,
      "measureFabricView",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isNumber())
          return jsi::Value::null();
        const auto& s = state();
        if (!s.fabricLookup)
          return jsi::Value::null();
        GtkWidget* w = s.fabricLookup(static_cast<int>(args[0].asNumber()));
        if (!w)
          return jsi::Value::null();

        const int width = gtk_widget_get_width(w);
        const int height = gtk_widget_get_height(w);

        // Position relative to the immediate parent (RN's `x` / `y`).
        // GTK doesn't surface a per-widget origin directly — convert the
        // (0,0) point in widget-local coords to the parent's coord space.
        double x = 0, y = 0;
        GtkWidget* parent = gtk_widget_get_parent(w);
        if (parent) {
          graphene_point_t local{0.f, 0.f};
          graphene_point_t out{0.f, 0.f};
          if (gtk_widget_compute_point(w, parent, &local, &out)) {
            x = out.x;
            y = out.y;
          }
        }

        // Position relative to the GtkRoot (RN's `pageX` / `pageY`).
        // The root for our app is the toplevel GtkApplicationWindow.
        double pageX = 0, pageY = 0;
        GtkRoot* root = gtk_widget_get_root(w);
        if (root) {
          graphene_point_t local{0.f, 0.f};
          graphene_point_t out{0.f, 0.f};
          if (gtk_widget_compute_point(w, GTK_WIDGET(root), &local, &out)) {
            pageX = out.x;
            pageY = out.y;
          }
        }

        jsi::Object obj(rt);
        obj.setProperty(rt, "x", jsi::Value(x));
        obj.setProperty(rt, "y", jsi::Value(y));
        obj.setProperty(rt, "width", jsi::Value(static_cast<double>(width)));
        obj.setProperty(rt, "height", jsi::Value(static_cast<double>(height)));
        obj.setProperty(rt, "pageX", jsi::Value(pageX));
        obj.setProperty(rt, "pageY", jsi::Value(pageY));
        return obj;
      });

  // ref.current.focus() / blur() backing. Most useful for TextInput,
  // where libraries (forms, navigation) call .focus() to advance the
  // input. For non-focusable widgets (View, Image) the grab is a no-op
  // at the GTK level — the widget either accepts focus or doesn't.
  bindMethod(
      rt,
      rnLinux,
      "focusFabricView",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isNumber())
          return jsi::Value::undefined();
        const auto& s = state();
        if (!s.fabricLookup)
          return jsi::Value::undefined();
        GtkWidget* w = s.fabricLookup(static_cast<int>(args[0].asNumber()));
        if (!w)
          return jsi::Value::undefined();
        gtk_widget_grab_focus(w);
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "blurFabricView",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isNumber())
          return jsi::Value::undefined();
        const auto& s = state();
        if (!s.fabricLookup)
          return jsi::Value::undefined();
        GtkWidget* w = s.fabricLookup(static_cast<int>(args[0].asNumber()));
        if (!w)
          return jsi::Value::undefined();
        // GTK has no per-widget blur — clear focus at the root so this
        // widget is no longer the focus owner. Other interactions will
        // re-focus as they fire.
        GtkRoot* root = gtk_widget_get_root(w);
        if (root) {
          gtk_root_set_focus(root, nullptr);
        }
        return jsi::Value::undefined();
      });

  // Sibling of fabricOnClick — registers the JS function invoked
  // whenever a TextInput's GtkText "changed" signal fires.
  bindMethod(
      rt,
      rnLinux,
      "fabricOnChangeText",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int tag = static_cast<int>(args[0].asNumber());
        if (args[1].isNull() || args[1].isUndefined()) {
          state().fabricChangeTextHandlers.erase(tag);
          return jsi::Value::undefined();
        }
        state().fabricChangeTextHandlers[tag] =
            std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));
        return jsi::Value::undefined();
      });

  // TextInput "activate" (Enter) → JS onSubmitEditing.
  bindMethod(
      rt,
      rnLinux,
      "fabricOnSubmitEditing",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int tag = static_cast<int>(args[0].asNumber());
        if (args[1].isNull() || args[1].isUndefined()) {
          state().fabricSubmitEditingHandlers.erase(tag);
          return jsi::Value::undefined();
        }
        state().fabricSubmitEditingHandlers[tag] =
            std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));
        return jsi::Value::undefined();
      });

  // TextInput key-press → JS onKeyPress.
  bindMethod(
      rt,
      rnLinux,
      "fabricOnKeyPress",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int tag = static_cast<int>(args[0].asNumber());
        if (args[1].isNull() || args[1].isUndefined()) {
          state().fabricKeyPressHandlers.erase(tag);
          return jsi::Value::undefined();
        }
        state().fabricKeyPressHandlers[tag] =
            std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));
        return jsi::Value::undefined();
      });

  // Sibling of fabricOnClick — registers the JS function invoked
  // whenever a GtkSwitch's active state flips. The callback receives
  // the new boolean value as its only argument.
  bindMethod(
      rt,
      rnLinux,
      "fabricOnSwitchChange",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int tag = static_cast<int>(args[0].asNumber());
        if (args[1].isNull() || args[1].isUndefined()) {
          state().fabricSwitchHandlers.erase(tag);
          return jsi::Value::undefined();
        }
        state().fabricSwitchHandlers[tag] =
            std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));
        return jsi::Value::undefined();
      });

  // Sibling of fabricOnClick — registers the JS function invoked
  // whenever a ScrollView's GtkAdjustment fires "value-changed".
  // The callback receives a single nativeEvent argument; see
  // dispatchFabricScroll for shape.
  bindMethod(
      rt,
      rnLinux,
      "fabricOnScroll",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int tag = static_cast<int>(args[0].asNumber());
        if (args[1].isNull() || args[1].isUndefined()) {
          state().fabricScrollHandlers.erase(tag);
          return jsi::Value::undefined();
        }
        state().fabricScrollHandlers[tag] =
            std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));
        return jsi::Value::undefined();
      });

  // TextInput onFocus / onBlur. Paper relies on these to flip its
  // `focused` state and animate the floating label off the input
  // baseline up to the outline notch.
  bindMethod(
      rt,
      rnLinux,
      "fabricOnFocus",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int tag = static_cast<int>(args[0].asNumber());
        if (args[1].isNull() || args[1].isUndefined()) {
          state().fabricFocusHandlers.erase(tag);
          return jsi::Value::undefined();
        }
        state().fabricFocusHandlers[tag] =
            std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));
        return jsi::Value::undefined();
      });
  bindMethod(
      rt,
      rnLinux,
      "fabricOnBlur",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int tag = static_cast<int>(args[0].asNumber());
        if (args[1].isNull() || args[1].isUndefined()) {
          state().fabricBlurHandlers.erase(tag);
          return jsi::Value::undefined();
        }
        state().fabricBlurHandlers[tag] =
            std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));
        return jsi::Value::undefined();
      });

  // onLayout handler registry — dispatched from
  // LinuxComponentView::updateLayoutMetrics whenever any view's frame
  // changes. JS apps register via `rnLinux.fabricOnLayout(tag, fn)`.
  // Paper's TextInput container width measurement, Reanimated's
  // measurement hooks, FlatList's viewport tracking, and many wrapper
  // libraries depend on this.
  bindMethod(
      rt,
      rnLinux,
      "fabricOnLayout",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        int tag = static_cast<int>(args[0].asNumber());
        if (args[1].isNull() || args[1].isUndefined()) {
          state().fabricLayoutHandlers.erase(tag);
          state().fabricLayoutLast.erase(tag);
          return jsi::Value::undefined();
        }
        state().fabricLayoutHandlers[tag] =
            std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));
        return jsi::Value::undefined();
      });

  // AsyncStorage backing — a simple key/value store kept in a JSON
  // file at $XDG_CONFIG_HOME/<app-id>/async-storage.json. JS calls
  // rnLinux.storageRead(key) / storageWrite(key, value) /
  // storageRemove(key) / storageKeys(). All synchronous since our
  // single-thread model can read+write the file inline without
  // blocking anything meaningful.
  // Forward decls for the storage backing — implementation lives in
  // vnext/src/storage/AsyncStorage.cpp.
  // (Wrapped in this scope so we don't leak the declarations into
  // other translation units that include this header.)
  // Note: these need to be at file scope for linkage, but C++ doesn't
  // let us declare locally and call from a lambda; we use the
  // namespace-qualified names directly inside the lambdas below.

  bindMethod(
      rt,
      rnLinux,
      "storageRead",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::null();
        auto v = asyncStorageRead(args[0].asString(rt).utf8(rt));
        if (v.empty())
          return jsi::Value::null();
        return jsi::Value{jsi::String::createFromUtf8(rt, v)};
      });

  bindMethod(
      rt,
      rnLinux,
      "storageWrite",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        asyncStorageWrite(args[0].asString(rt).utf8(rt), args[1].asString(rt).utf8(rt));
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "storageRemove",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::undefined();
        asyncStorageRemove(args[0].asString(rt).utf8(rt));
        return jsi::Value::undefined();
      });

  bindMethod(rt,
             rnLinux,
             "storageKeys",
             0,
             [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               auto keys = asyncStorageKeys();
               jsi::Array arr{rt, keys.size()};
               for (size_t i = 0; i < keys.size(); ++i) {
                 arr.setValueAtIndex(rt, i, jsi::String::createFromUtf8(rt, keys[i]));
               }
               return arr;
             });

  bindMethod(rt,
             rnLinux,
             "clearInterval",
             1,
             [](jsi::Runtime& /*rt*/, const jsi::Value&, const jsi::Value* args, size_t count)
                 -> jsi::Value {
               if (count < 1)
                 return jsi::Value::undefined();
               int handlerId = static_cast<int>(args[0].asNumber());
               auto it = state().timerHandlers.find(handlerId);
               if (it != state().timerHandlers.end()) {
                 g_source_remove(it->second.first);
                 state().timerHandlers.erase(it);
               }
               return jsi::Value::undefined();
             });

  // Linking.openURL backing. Hands the URI to GIO, which fans out to
  // xdg-open-equivalent app launchers (xdg-mime / desktop-entry MIME
  // handlers). Returns true on success. Async-shaped only to match
  // the RN API surface — the GIO call itself returns synchronously.
  bindMethod(
      rt,
      rnLinux,
      "openURL",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isString())
          return jsi::Value(false);
        const auto uri = args[0].asString(rt).utf8(rt);
        GError* err = nullptr;
        const gboolean ok = g_app_info_launch_default_for_uri(uri.c_str(), nullptr, &err);
        if (!ok) {
          RNL_LOGW("rnLinux") << "openURL failed: "
                              << (err && err->message ? err->message : "(unknown)");
        }
        if (err)
          g_error_free(err);
        return jsi::Value(static_cast<bool>(ok));
      });

  // canOpenURL: GIO can answer "is there a default app for this
  // scheme" via g_app_info_get_default_for_uri_scheme. We split the
  // scheme out manually since the input is the full URI.
  bindMethod(
      rt,
      rnLinux,
      "canOpenURL",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isString())
          return jsi::Value(false);
        const auto uri = args[0].asString(rt).utf8(rt);
        const auto colon = uri.find(':');
        if (colon == std::string::npos)
          return jsi::Value(false);
        const auto scheme = uri.substr(0, colon);
        GAppInfo* info = g_app_info_get_default_for_uri_scheme(scheme.c_str());
        const bool ok = info != nullptr;
        if (info)
          g_object_unref(info);
        return jsi::Value(ok);
      });

  // Clipboard backing. GTK4 exposes the display-level clipboard via
  // gdk_display_get_clipboard; we set/read UTF-8 text on it. Reads
  // are async (GTK fires a callback when the selection holder
  // responds), so getString returns a Promise.
  bindMethod(rt,
             rnLinux,
             "clipboardSetString",
             1,
             [rootView](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count)
                 -> jsi::Value {
               if (count < 1 || !args[0].isString())
                 return jsi::Value::undefined();
               const auto text = args[0].asString(rt).utf8(rt);
               GdkClipboard* cb = gdk_display_get_clipboard(gtk_widget_get_display(rootView));
               if (cb) {
                 gdk_clipboard_set_text(cb, text.c_str());
               }
               return jsi::Value::undefined();
             });

  bindMethod(
      rt,
      rnLinux,
      "clipboardGetStringSync",
      0,
      [rootView](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
        // Pragmatic synchronous read of the clipboard's own write
        // history — covers the common "set then immediately get"
        // round-trip. Cross-app pastes need the async
        // read_text_async + callback path; falls back to "" here.
        GdkClipboard* cb = gdk_display_get_clipboard(gtk_widget_get_display(rootView));
        if (!cb)
          return jsi::String::createFromUtf8(rt, "");
        GdkContentProvider* provider = gdk_clipboard_get_content(cb);
        if (!provider)
          return jsi::String::createFromUtf8(rt, "");
        GValue v = G_VALUE_INIT;
        g_value_init(&v, G_TYPE_STRING);
        if (!gdk_content_provider_get_value(provider, &v, nullptr)) {
          g_value_unset(&v);
          return jsi::String::createFromUtf8(rt, "");
        }
        const char* s = g_value_get_string(&v);
        std::string out = s ? s : "";
        g_value_unset(&v);
        return jsi::String::createFromUtf8(rt, out);
      });

  // Appearance.getColorScheme backing. Reads the GTK setting
  // `gtk-application-prefer-dark-theme` and returns 'dark' or 'light'.
  // GTK exposes this via GtkSettings, which is global per display. The
  // user's chosen system theme (set via the desktop's "Appearance"
  // panel or AdwStyleManager on libadwaita systems) feeds it.
  bindMethod(rt,
             rnLinux,
             "getColorScheme",
             0,
             [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               GtkSettings* settings = gtk_settings_get_default();
               if (!settings)
                 return jsi::String::createFromUtf8(rt, "light");
               gboolean dark = FALSE;
               g_object_get(settings, "gtk-application-prefer-dark-theme", &dark, nullptr);
               return jsi::String::createFromUtf8(rt, dark ? "dark" : "light");
             });

  // Dimensions.get('window') backing — returns the surface size of
  // the root view's window in logical pixels, plus the GDK scale
  // factor. Default RN apps call this from layout hooks; pre-fix we
  // returned a hardcoded 1024x860 which is wrong as soon as the user
  // resizes.
  bindMethod(
      rt,
      rnLinux,
      "getWindowDimensions",
      0,
      [rootView](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
        int w = 0, h = 0;
        int scale = 1;
        if (rootView) {
          GtkNative* nat = gtk_widget_get_native(rootView);
          if (nat) {
            GdkSurface* surface = gtk_native_get_surface(nat);
            if (surface) {
              w = gdk_surface_get_width(surface);
              h = gdk_surface_get_height(surface);
              scale = gdk_surface_get_scale_factor(surface);
            }
          }
        }
        jsi::Object obj(rt);
        obj.setProperty(rt, "width", jsi::Value(static_cast<double>(w)));
        obj.setProperty(rt, "height", jsi::Value(static_cast<double>(h)));
        obj.setProperty(rt, "scale", jsi::Value(static_cast<double>(scale)));
        obj.setProperty(rt, "fontScale", jsi::Value(1.0));
        return obj;
      });

  // Alert backing. JS calls rnLinux.showAlert(title, message, buttons, cb).
  // We build a GtkAlertDialog, set its message/detail, attach the button
  // labels, and async-choose against the toplevel window. The callback
  // receives the chosen button index (or -1 on cancel).
  //
  // GtkAlertDialog was introduced in GTK 4.10. The shared_ptr keeps the
  // JS callback alive until choose_async resolves; the dialog itself is
  // refcounted by GTK.
  bindMethod(
      rt,
      rnLinux,
      "showAlert",
      4,
      [rootView](
          jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::undefined();
        const auto title = args[0].isString() ? args[0].asString(rt).utf8(rt) : std::string();
        const auto detail =
            count > 1 && args[1].isString() ? args[1].asString(rt).utf8(rt) : std::string();

        // Collect button labels into a NULL-terminated GStrv. If the
        // caller passed no buttons, default to a single "OK".
        std::vector<std::string> labels;
        if (count > 2 && args[2].isObject()) {
          auto arr = args[2].asObject(rt);
          if (arr.isArray(rt)) {
            auto a = arr.asArray(rt);
            for (size_t i = 0, n = a.size(rt); i < n; ++i) {
              auto el = a.getValueAtIndex(rt, i);
              labels.push_back(el.isString() ? el.asString(rt).utf8(rt)
                                             : std::string("Button " + std::to_string(i)));
            }
          }
        }
        if (labels.empty())
          labels.emplace_back("OK");

        std::vector<const char*> rawLabels;
        rawLabels.reserve(labels.size() + 1);
        for (auto& s : labels)
          rawLabels.push_back(s.c_str());
        rawLabels.push_back(nullptr);

        GtkAlertDialog* dialog = gtk_alert_dialog_new("%s", title.c_str());
        if (!detail.empty()) {
          gtk_alert_dialog_set_detail(dialog, detail.c_str());
        }
        gtk_alert_dialog_set_buttons(dialog, rawLabels.data());

        // Wrap the JS callback in a shared_ptr so the C-style choose_async
        // userdata can hold it through the async hop and the destructor
        // runs cleanly. We capture by value into a heap struct so GTK
        // can pass it to the callback.
        struct Userdata {
          std::shared_ptr<jsi::Function> cb;
        };
        Userdata* ud = nullptr;
        if (count > 3 && args[3].isObject() && args[3].asObject(rt).isFunction(rt)) {
          ud = new Userdata{std::make_shared<jsi::Function>(args[3].asObject(rt).asFunction(rt))};
        }

        GtkWindow* parent = nullptr;
        if (rootView) {
          GtkRoot* root = gtk_widget_get_root(rootView);
          if (GTK_IS_WINDOW(root))
            parent = GTK_WINDOW(root);
        }

        gtk_alert_dialog_choose(
            dialog,
            parent,
            /*cancellable=*/nullptr,
            +[](GObject* source, GAsyncResult* result, gpointer userData) {
              auto* d = GTK_ALERT_DIALOG(source);
              GError* err = nullptr;
              const int picked = gtk_alert_dialog_choose_finish(d, result, &err);
              auto* ud = static_cast<Userdata*>(userData);
              if (ud) {
                auto& s = state();
                if (s.runtime) {
                  try {
                    ud->cb->call(*s.runtime, jsi::Value(picked));
                    s.runtime->drainMicrotasks();
                  } catch (const std::exception& e) {
                    RNL_LOGE("rnLinux") << "alert callback threw: " << e.what();
                  }
                }
                delete ud;
              }
              if (err)
                g_error_free(err);
            },
            ud);
        g_object_unref(dialog);
        return jsi::Value::undefined();
      });

  // JS-callable reload. Same destination as Ctrl+R, but the actual
  // host->reload() is deferred via g_idle_add so it fires *after*
  // the current JS call stack unwinds. Calling reload synchronously
  // from inside a JS click handler re-evaluates the bundle while
  // we're still inside the click's microtask drain — and the
  // post-reload performReactRefresh then deadlocks for tens of
  // seconds remounting a stale family on top of a tree that
  // setState just mounted. The GTK shortcut path (Ctrl+R) doesn't
  // hit this because it fires outside any click handler. Routing
  // both through the same idle source makes them behave identically.
  // rnLinux.deviceInfoSync() — returns a JS object with every field
  // the JS shim for react-native-device-info needs. Most values are
  // gathered from one-shot reads of sysfs / /proc / /etc files in
  // DeviceInfo.cpp; we re-call gather() on every JS access rather
  // than cache so dynamic values (battery, free disk, used memory)
  // stay live without the JS layer having to know which fields are
  // static vs dynamic.
  bindMethod(rt,
             rnLinux,
             "deviceInfoSync",
             0,
             [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               auto d = rnlinux::deviceinfo::gather();
               jsi::Object o(rt);
               auto setStr = [&](const char* k, const std::string& v) {
                 o.setProperty(rt, k, jsi::String::createFromUtf8(rt, v));
               };
               auto setNum = [&](const char* k, double v) { o.setProperty(rt, k, jsi::Value(v)); };
               auto setBool = [&](const char* k, bool v) { o.setProperty(rt, k, jsi::Value(v)); };
               setStr("brand", d.brand);
               setStr("model", d.model);
               setStr("manufacturer", d.manufacturer);
               setStr("deviceId", d.deviceId);
               setStr("deviceName", d.deviceName);
               setStr("systemName", d.systemName);
               setStr("systemVersion", d.systemVersion);
               setStr("buildId", d.buildId);
               setStr("baseOs", d.baseOs);
               setStr("product", d.product);
               setStr("codename", d.codename);
               setStr("display", d.display);
               setStr("fingerprint", d.fingerprint);
               setStr("hardware", d.hardware);
               setStr("host", d.host);
               setStr("bootloader", d.bootloader);
               setStr("serialNumber", d.serialNumber);
               setStr("uniqueId", d.uniqueId);
               setStr("instanceId", d.instanceId);
               setStr("applicationName", d.applicationName);
               setStr("bundleId", d.bundleId);
               setStr("installerPackageName", d.installerPackageName);
               setStr("version", d.version);
               setStr("buildNumber", d.buildNumber);
               setStr("ipAddress", d.ipAddress);
               setStr("macAddress", d.macAddress);
               setStr("carrier", d.carrier);
               setNum("apiLevel", d.apiLevel);
               setNum("fontScale", d.fontScale);
               setNum("firstInstallTime", static_cast<double>(d.firstInstallTime));
               setNum("lastUpdateTime", static_cast<double>(d.lastUpdateTime));
               setNum("startupTime", static_cast<double>(d.startupTime));
               setBool("isTablet", d.isTablet);
               setBool("isEmulator", d.isEmulator);
               setBool("hasNotch", d.hasNotch);
               setBool("hasDynamicIsland", d.hasDynamicIsland);
               setNum("totalMemory", static_cast<double>(d.totalMemory));
               setNum("maxMemory", static_cast<double>(d.maxMemory));
               setNum("usedMemory", static_cast<double>(d.usedMemory));
               setNum("freeDiskStorage", static_cast<double>(d.freeDiskStorage));
               setNum("totalDiskCapacity", static_cast<double>(d.totalDiskCapacity));
               setBool("isCameraPresent", d.isCameraPresent);
               setBool("isLandscape", d.isLandscape);
               setBool("isKeyboardConnected", d.isKeyboardConnected);
               setBool("isMouseConnected", d.isMouseConnected);
               setBool("isBatteryCharging", d.isBatteryCharging);
               {
                 jsi::Object ps(rt);
                 ps.setProperty(rt, "batteryLevel", jsi::Value(d.power.batteryLevel));
                 ps.setProperty(
                     rt, "batteryState", jsi::String::createFromUtf8(rt, d.power.batteryState));
                 ps.setProperty(rt, "lowPowerMode", jsi::Value(d.power.lowPowerMode));
                 o.setProperty(rt, "powerState", ps);
               }
               {
                 jsi::Array arr(rt, d.hostNames.size());
                 for (size_t i = 0; i < d.hostNames.size(); ++i)
                   arr.setValueAtIndex(rt, i, jsi::String::createFromUtf8(rt, d.hostNames[i]));
                 o.setProperty(rt, "hostNames", arr);
               }
               {
                 jsi::Array arr(rt, d.supportedAbis.size());
                 for (size_t i = 0; i < d.supportedAbis.size(); ++i)
                   arr.setValueAtIndex(rt, i, jsi::String::createFromUtf8(rt, d.supportedAbis[i]));
                 o.setProperty(rt, "supportedAbis", arr);
               }
               return o;
             });

  // ─── GeoClue2 location (expo-location backing) ────────────────────
  // Single-watcher native model: locationStartWatch installs the JS
  // fix/error callbacks and spins up a GeoClue2 client. JS layers
  // multi-subscriber semantics on top via the shim's reference
  // counting. locationGetCurrent is also expressed in JS by chaining
  // start → first fix → stop.

  bindMethod(rt,
             rnLinux,
             "locationIsAvailable",
             0,
             [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               auto& s = state();
               if (!s.location) {
                 s.location =
                     std::make_unique<rnlinux::location::LocationClient>("rn-linux-playground");
               }
               return jsi::Value(s.location->isAvailable());
             });

  bindMethod(
      rt,
      rnLinux,
      "locationStartWatch",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2 || !args[0].isObject() || !args[0].asObject(rt).isFunction(rt)) {
          return jsi::Value(false);
        }
        auto& s = state();
        if (!s.location) {
          s.location = std::make_unique<rnlinux::location::LocationClient>("rn-linux-playground");
        }
        s.locationOnFix = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
        if (args[1].isObject() && args[1].asObject(rt).isFunction(rt)) {
          s.locationOnError = std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));
        } else {
          s.locationOnError.reset();
        }

        const bool ok = s.location->startWatch(
            // onFix — fires on every LocationUpdated from GeoClue. The
            // signal callback runs on the GTK main loop thread, which
            // is the same thread that owns the runtime, so calling
            // into JS inline is safe.
            [](const rnlinux::location::LocationFix& fix) {
              auto& st = state();
              if (!st.runtime || !st.locationOnFix)
                return;
              jsi::Runtime& jrt = *st.runtime;
              try {
                jsi::Object obj(jrt);
                obj.setProperty(jrt, "latitude", jsi::Value(fix.latitude));
                obj.setProperty(jrt, "longitude", jsi::Value(fix.longitude));
                obj.setProperty(jrt, "accuracy", jsi::Value(fix.accuracy));
                obj.setProperty(jrt, "altitude", jsi::Value(fix.altitude));
                obj.setProperty(jrt, "speed", jsi::Value(fix.speed));
                obj.setProperty(jrt, "heading", jsi::Value(fix.heading));
                obj.setProperty(jrt, "timestamp", jsi::Value(static_cast<double>(fix.timestampMs)));
                st.locationOnFix->call(jrt, obj);
                jrt.drainMicrotasks();
              } catch (const jsi::JSError& e) {
                RNL_LOGE("rnLinux.location") << "fix handler threw: " << e.getMessage();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.location") << "fix handler threw: " << e.what();
              }
            },
            // onError — fires once if start sequence fails or the
            // bus/agent isn't reachable.
            [](const std::string& msg) {
              auto& st = state();
              if (!st.runtime || !st.locationOnError)
                return;
              jsi::Runtime& jrt = *st.runtime;
              try {
                st.locationOnError->call(jrt, jsi::String::createFromUtf8(jrt, msg));
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.location") << "err handler threw: " << e.what();
              }
            });
        if (!ok) {
          s.locationOnFix.reset();
          s.locationOnError.reset();
        }
        return jsi::Value(ok);
      });

  bindMethod(rt,
             rnLinux,
             "locationStopWatch",
             0,
             [](jsi::Runtime& /*rt*/, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               auto& s = state();
               if (s.location) {
                 s.location->stopWatch();
               }
               s.locationOnFix.reset();
               s.locationOnError.reset();
               return jsi::Value::undefined();
             });

  // ─── File system (expo-file-system) ──────────────────────────────
  // Most operations are sync — file IO on local disk is fast and
  // bounded, and the JS shim wraps them in Promise.resolve so the
  // upstream async signature is preserved. Errors throw on the JSI
  // side; tryProbe / Promise rejection paths surface them to JS.

  bindMethod(
      rt,
      rnLinux,
      "fsConstants",
      0,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
        const auto& c = rnlinux::filesystem::constants("rn-linux-playground");
        jsi::Object o(rt);
        o.setProperty(
            rt, "documentDirectory", jsi::String::createFromUtf8(rt, c.documentDirectory));
        o.setProperty(rt, "cacheDirectory", jsi::String::createFromUtf8(rt, c.cacheDirectory));
        o.setProperty(rt, "bundleDirectory", jsi::String::createFromUtf8(rt, c.bundleDirectory));
        return o;
      });

  bindMethod(
      rt,
      rnLinux,
      "fsReadString",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::null();
        const auto path = args[0].asString(rt).utf8(rt);
        const auto enc =
            (count >= 2 && args[1].isString() && args[1].asString(rt).utf8(rt) == "base64")
                ? rnlinux::filesystem::Encoding::Base64
                : rnlinux::filesystem::Encoding::UTF8;
        try {
          return jsi::String::createFromUtf8(rt, rnlinux::filesystem::readString(path, enc));
        } catch (const std::exception& e) {
          throw jsi::JSError(rt, e.what());
        }
      });

  bindMethod(
      rt,
      rnLinux,
      "fsWriteString",
      3,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        const auto path = args[0].asString(rt).utf8(rt);
        const auto contents = args[1].asString(rt).utf8(rt);
        const auto enc =
            (count >= 3 && args[2].isString() && args[2].asString(rt).utf8(rt) == "base64")
                ? rnlinux::filesystem::Encoding::Base64
                : rnlinux::filesystem::Encoding::UTF8;
        try {
          rnlinux::filesystem::writeString(path, contents, enc);
        } catch (const std::exception& e) {
          throw jsi::JSError(rt, e.what());
        }
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "fsGetInfo",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::null();
        const auto path = args[0].asString(rt).utf8(rt);
        const bool wantMd5 = count >= 2 && args[1].isBool() && args[1].getBool();
        const auto info = rnlinux::filesystem::getInfo(path, wantMd5);
        jsi::Object o(rt);
        o.setProperty(rt, "exists", jsi::Value(info.exists));
        o.setProperty(rt, "uri", jsi::String::createFromUtf8(rt, info.uri));
        if (info.exists) {
          o.setProperty(rt, "isDirectory", jsi::Value(info.isDirectory));
          o.setProperty(rt, "size", jsi::Value(static_cast<double>(info.size)));
          o.setProperty(rt,
                        "modificationTime",
                        jsi::Value(static_cast<double>(info.modificationTime) / 1000.0));
          if (!info.md5.empty()) {
            o.setProperty(rt, "md5", jsi::String::createFromUtf8(rt, info.md5));
          }
        }
        return o;
      });

  bindMethod(
      rt,
      rnLinux,
      "fsDelete",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value(false);
        const auto path = args[0].asString(rt).utf8(rt);
        const bool idempotent = count >= 2 && args[1].isBool() && args[1].getBool();
        try {
          return jsi::Value(rnlinux::filesystem::deleteFile(path, idempotent));
        } catch (const std::exception& e) {
          throw jsi::JSError(rt, e.what());
        }
      });

  bindMethod(
      rt,
      rnLinux,
      "fsMakeDirectory",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::undefined();
        const auto path = args[0].asString(rt).utf8(rt);
        const bool intermediates = count >= 2 && args[1].isBool() && args[1].getBool();
        try {
          rnlinux::filesystem::makeDirectory(path, intermediates);
        } catch (const std::exception& e) {
          throw jsi::JSError(rt, e.what());
        }
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "fsReadDirectory",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Array(rt, 0);
        try {
          const auto entries = rnlinux::filesystem::readDirectory(args[0].asString(rt).utf8(rt));
          jsi::Array arr(rt, entries.size());
          for (size_t i = 0; i < entries.size(); ++i) {
            arr.setValueAtIndex(rt, i, jsi::String::createFromUtf8(rt, entries[i]));
          }
          return arr;
        } catch (const std::exception& e) {
          throw jsi::JSError(rt, e.what());
        }
      });

  bindMethod(
      rt,
      rnLinux,
      "fsCopy",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        try {
          rnlinux::filesystem::copy(args[0].asString(rt).utf8(rt), args[1].asString(rt).utf8(rt));
        } catch (const std::exception& e) {
          throw jsi::JSError(rt, e.what());
        }
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "fsMove",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        try {
          rnlinux::filesystem::move(args[0].asString(rt).utf8(rt), args[1].asString(rt).utf8(rt));
        } catch (const std::exception& e) {
          throw jsi::JSError(rt, e.what());
        }
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "fsDownload",
      4,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 4)
          return jsi::Value::undefined();
        const auto url = args[0].asString(rt).utf8(rt);
        const auto dest = args[1].asString(rt).utf8(rt);
        auto okCb = std::make_shared<jsi::Function>(args[2].asObject(rt).asFunction(rt));
        auto errCb = std::make_shared<jsi::Function>(args[3].asObject(rt).asFunction(rt));
        rnlinux::filesystem::download(
            url,
            dest,
            [okCb](const std::string& path, int status, int64_t bytes) {
              auto& s = state();
              if (!s.runtime)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                jsi::Object o(jrt);
                o.setProperty(jrt, "uri", jsi::String::createFromUtf8(jrt, "file://" + path));
                o.setProperty(jrt, "status", jsi::Value(status));
                o.setProperty(jrt, "size", jsi::Value(static_cast<double>(bytes)));
                okCb->call(jrt, o);
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.fs") << "download ok handler threw: " << e.what();
              }
            },
            [errCb](const std::string& msg) {
              auto& s = state();
              if (!s.runtime)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                errCb->call(jrt, jsi::String::createFromUtf8(jrt, msg));
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.fs") << "download err handler threw: " << e.what();
              }
            });
        return jsi::Value::undefined();
      });

  // ─── Notifications (expo-notifications) ─────────────────────────
  // Single response listener; replaces on each call. C++ stores the
  // jsi::Function shared_ptr so libnotify's closed-signal trampoline
  // can call into JS without needing to track per-notification state.

  bindMethod(
      rt,
      rnLinux,
      "notificationsPresent",
      3,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 3)
          return jsi::Value(false);
        const auto id = args[0].asString(rt).utf8(rt);
        const auto title = args[1].asString(rt).utf8(rt);
        const auto body = args[2].asString(rt).utf8(rt);
        return jsi::Value(rnlinux::notifications::present(id, title, body));
      });

  bindMethod(
      rt,
      rnLinux,
      "notificationsSchedule",
      4,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 4)
          return jsi::Value(false);
        const auto id = args[0].asString(rt).utf8(rt);
        const int delayMs = static_cast<int>(args[1].asNumber());
        const auto title = args[2].asString(rt).utf8(rt);
        const auto body = args[3].asString(rt).utf8(rt);
        return jsi::Value(rnlinux::notifications::schedule(id, delayMs, title, body));
      });

  bindMethod(
      rt,
      rnLinux,
      "notificationsCancel",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::undefined();
        rnlinux::notifications::cancel(args[0].asString(rt).utf8(rt));
        return jsi::Value::undefined();
      });

  bindMethod(rt,
             rnLinux,
             "notificationsCancelAll",
             0,
             [](jsi::Runtime& /*rt*/, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               rnlinux::notifications::cancelAll();
               return jsi::Value::undefined();
             });

  bindMethod(rt,
             rnLinux,
             "notificationsListScheduled",
             0,
             [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               const auto list = rnlinux::notifications::listScheduled();
               jsi::Array arr(rt, list.size());
               for (size_t i = 0; i < list.size(); ++i) {
                 jsi::Object o(rt);
                 o.setProperty(rt, "id", jsi::String::createFromUtf8(rt, list[i].id));
                 o.setProperty(rt, "title", jsi::String::createFromUtf8(rt, list[i].title));
                 o.setProperty(rt, "body", jsi::String::createFromUtf8(rt, list[i].body));
                 o.setProperty(rt, "fireAt", jsi::Value(static_cast<double>(list[i].fireAtMs)));
                 arr.setValueAtIndex(rt, i, o);
               }
               return arr;
             });

  bindMethod(
      rt,
      rnLinux,
      "notificationsSetResponseListener",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || args[0].isNull() || args[0].isUndefined()) {
          rnlinux::notifications::setResponseCallback(nullptr);
          return jsi::Value::undefined();
        }
        auto fn = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
        rnlinux::notifications::setResponseCallback(
            [fn](const std::string& id, const std::string& action) {
              auto& s = state();
              if (!s.runtime)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                fn->call(jrt,
                         jsi::String::createFromUtf8(jrt, id),
                         jsi::String::createFromUtf8(jrt, action));
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.notif") << "response handler threw: " << e.what();
              }
            });
        return jsi::Value::undefined();
      });

  // ─── Camera one-shot capture (expo-camera.takePictureAsync) ──────
  // GStreamer pipeline runs to EOS off the JS thread; the result /
  // error callback fires back on the GTK main loop, which is the JS
  // thread, so calling into the runtime is safe without locking.

  bindMethod(rt,
             rnLinux,
             "cameraHasDevice",
             0,
             [](jsi::Runtime& /*rt*/, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               return jsi::Value(rnlinux::camera::hasV4l2Device());
             });

  bindMethod(
      rt,
      rnLinux,
      "cameraSnap",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        auto resultCb = (count > 0 && args[0].isObject() && args[0].asObject(rt).isFunction(rt))
                            ? std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt))
                            : nullptr;
        auto errCb = (count > 1 && args[1].isObject() && args[1].asObject(rt).isFunction(rt))
                         ? std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt))
                         : nullptr;
        rnlinux::camera::snap(
            [resultCb](const rnlinux::camera::SnapResult& r) {
              auto& st = state();
              if (!st.runtime || !resultCb)
                return;
              jsi::Runtime& jrt = *st.runtime;
              try {
                jsi::Object obj(jrt);
                obj.setProperty(jrt, "uri", jsi::String::createFromUtf8(jrt, r.uri));
                obj.setProperty(jrt, "width", jsi::Value(r.width));
                obj.setProperty(jrt, "height", jsi::Value(r.height));
                resultCb->call(jrt, obj);
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.camera") << "snap result handler threw: " << e.what();
              }
            },
            [errCb](const std::string& msg) {
              auto& st = state();
              if (!st.runtime || !errCb)
                return;
              jsi::Runtime& jrt = *st.runtime;
              try {
                errCb->call(jrt, jsi::String::createFromUtf8(jrt, msg));
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.camera") << "snap error handler threw: " << e.what();
              }
            });
        return jsi::Value::undefined();
      });

  bindMethod(rt,
             rnLinux,
             "reloadApp",
             0,
             [](jsi::Runtime& /*rt*/, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               g_idle_add(
                   +[](gpointer) -> gboolean {
                     const auto& s = state();
                     if (s.reload) {
                       s.reload();
                     }
                     return G_SOURCE_REMOVE;
                   },
                   nullptr);
               return jsi::Value::undefined();
             });

  rt.global().setProperty(rt, "rnLinux", rnLinux);
  RNL_LOGI("rnLinux") << "JSI bindings installed";
}

} // namespace rnlinux
