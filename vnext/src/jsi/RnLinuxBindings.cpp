#include "RnLinuxBindings.h"

#include "react-native-linux/Logging.h"

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

  // nativeID-string → widget map for the Animated native-driver path.
  // Populated by ViewComponentView::updateProps when JS sets a
  // `nativeID` prop; consumed by rnLinux.setNativeProp(stringId, …).
  std::unordered_map<std::string, GtkWidget*> animWidgets;

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
  state().fabricScrollHandlers.clear();
  state().nodes.clear();
  state().nextId = 1;
  state().nextTimerId = 1;
  state().runtime = nullptr;
  state().rootView = nullptr;
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
  } catch (const std::exception& e) {
    RNL_LOGE("rnLinux") << "fabric click handler threw: " << e.what();
  }
}

void setFabricWidgetLookupForJsi(std::function<GtkWidget*(int)> lookup) {
  state().fabricLookup = std::move(lookup);
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
        } else if (prop == "translateX" || prop == "translateY") {
          // Use gtk_fixed_set_child_transform (paint-only) instead of
          // gtk_fixed_move (which queues a relayout cascade up the entire
          // ancestor chain — that's death for an Animated.loop running at
          // 60 Hz). The transform composes on top of Yoga's layout origin
          // and only dirties the rendered region.
          GtkWidget* parent = gtk_widget_get_parent(w);
          if (parent && GTK_IS_FIXED(parent)) {
            // Read the current transform so we preserve the other axis.
            GskTransform* cur = gtk_fixed_get_child_transform(GTK_FIXED(parent), w);
            float curX = 0, curY = 0;
            if (cur) {
              // GskTransform of category 2D_TRANSLATE has a simple offset
              // we can read; fall through to 0 for anything else (we never
              // generate non-translate transforms from here).
              gsk_transform_to_translate(cur, &curX, &curY);
            }
            graphene_point_t pt = (prop == "translateX")
                                      ? graphene_point_t{static_cast<float>(v), curY}
                                      : graphene_point_t{curX, static_cast<float>(v)};
            // gsk_transform_translate consumes the existing transform (it
            // takes ownership of `next`) and returns a fresh ref-counted
            // GskTransform. Passing nullptr means "translate from
            // identity". set_child_transform takes ownership too.
            GskTransform* next = gsk_transform_translate(nullptr, &pt);
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

  rt.global().setProperty(rt, "rnLinux", rnLinux);
  RNL_LOGI("rnLinux") << "JSI bindings installed";
}

} // namespace rnlinux
