#include "RnLinuxBindings.h"
#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>
#include <jsi/jsi.h>

#include <atomic>
#include <cstdio>
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
  std::unordered_map<int, std::shared_ptr<jsi::Function>>
      fabricChangeTextHandlers;

  // Active intervals/timers. `handlerId → (sourceId, fn)`. We keep the
  // jsi::Function alive here so the GTK source can call back into JS
  // safely; resetRnLinuxBindings drops these on reload so dangling
  // sources don't fire into a destroyed runtime.
  std::unordered_map<int, std::pair<guint, std::shared_ptr<jsi::Function>>>
      timerHandlers;
  int nextTimerId{1};

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
void bindMethod(jsi::Runtime& rt, jsi::Object& target,
                const char* name, unsigned nargs, Fn&& fn) {
  auto propName = jsi::PropNameID::forUtf8(rt, name);
  target.setProperty(rt, propName,
      jsi::Function::createFromHostFunction(rt, propName, nargs,
        std::forward<Fn>(fn)));
}

// Convenience: build a per-widget CSS provider so JS can change background
// colors without leaking style across siblings.
GtkCssProvider* ensureCssProvider(GtkWidget* w) {
  auto* p = static_cast<GtkCssProvider*>(
      g_object_get_data(G_OBJECT(w), "rnl-css-provider"));
  if (p) return p;
  p = gtk_css_provider_new();
  g_object_set_data_full(G_OBJECT(w), "rnl-css-provider", p, g_object_unref);
  gtk_style_context_add_provider_for_display(
      gtk_widget_get_display(w),
      GTK_STYLE_PROVIDER(p),
      GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
  return p;
}

}  // namespace

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
  state().nodes.clear();
  state().nextId = 1;
  state().nextTimerId = 1;
  state().runtime = nullptr;
  state().rootView = nullptr;
}

void dispatchFabricClick(int tag) {
  auto& s = state();
  if (!s.runtime) return;
  auto it = s.fabricClickHandlers.find(tag);
  if (it == s.fabricClickHandlers.end()) return;
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

void dispatchFabricChangeText(int tag, const std::string& text) {
  auto& s = state();
  if (!s.runtime) return;
  auto it = s.fabricChangeTextHandlers.find(tag);
  if (it == s.fabricChangeTextHandlers.end()) return;
  try {
    it->second->call(*s.runtime,
                      jsi::String::createFromUtf8(*s.runtime, text));
    s.runtime->drainMicrotasks();
  } catch (const jsi::JSError& e) {
    RNL_LOGE("rnLinux") << "fabric changeText handler threw: " << e.getMessage();
  } catch (const std::exception& e) {
    RNL_LOGE("rnLinux") << "fabric changeText handler threw: " << e.what();
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

  bindMethod(rt, rnLinux, "createLabel", 0,
      [](jsi::Runtime& rt, const jsi::Value& /*thisVal*/,
         const jsi::Value* /*args*/, size_t /*count*/) -> jsi::Value {
    auto* label = gtk_label_new("");
    gtk_label_set_xalign(GTK_LABEL(label), 0.0f);
    gtk_label_set_yalign(GTK_LABEL(label), 0.0f);
    int id = state().registerWidget(label);
    return jsi::Value{id};
  });

  bindMethod(rt, rnLinux, "createBox", 0,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value*, size_t) -> jsi::Value {
    auto* box = gtk_fixed_new();
    int id = state().registerWidget(box);
    return jsi::Value{id};
  });

  bindMethod(rt, rnLinux, "setText", 2,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 2) return jsi::Value::undefined();
    int id = static_cast<int>(args[0].asNumber());
    std::string text = args[1].asString(rt).utf8(rt);
    GtkWidget* w = state().lookup(id);
    if (w && GTK_IS_LABEL(w)) gtk_label_set_text(GTK_LABEL(w), text.c_str());
    return jsi::Value::undefined();
  });

  bindMethod(rt, rnLinux, "setBounds", 5,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 5) return jsi::Value::undefined();
    int id = static_cast<int>(args[0].asNumber());
    int x = static_cast<int>(args[1].asNumber());
    int y = static_cast<int>(args[2].asNumber());
    int w = static_cast<int>(args[3].asNumber());
    int h = static_cast<int>(args[4].asNumber());
    GtkWidget* widget = state().lookup(id);
    if (!widget) return jsi::Value::undefined();
    gtk_widget_set_size_request(widget, w, h);
    GtkWidget* parent = gtk_widget_get_parent(widget);
    if (parent && GTK_IS_FIXED(parent)) {
      gtk_fixed_move(GTK_FIXED(parent), widget, x, y);
    }
    return jsi::Value::undefined();
  });

  bindMethod(rt, rnLinux, "setBackgroundColor", 2,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 2) return jsi::Value::undefined();
    int id = static_cast<int>(args[0].asNumber());
    std::string color = args[1].asString(rt).utf8(rt);
    GtkWidget* w = state().lookup(id);
    if (!w) return jsi::Value::undefined();
    auto* provider = ensureCssProvider(w);
    // Tag the widget with a CSS name we can target.
    char name[32];
    std::snprintf(name, sizeof(name), "rnl-%d", id);
    gtk_widget_set_name(w, name);
    char css[128];
    std::snprintf(css, sizeof(css),
        "#%s { background-color: %s; }", name, color.c_str());
    gtk_css_provider_load_from_string(provider, css);
    return jsi::Value::undefined();
  });

  bindMethod(rt, rnLinux, "appendChild", 2,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 2) return jsi::Value::undefined();
    int parentId = static_cast<int>(args[0].asNumber());
    int childId = static_cast<int>(args[1].asNumber());
    GtkWidget* parent = state().lookup(parentId);
    GtkWidget* child = state().lookup(childId);
    if (!parent || !child) return jsi::Value::undefined();
    if (!GTK_IS_FIXED(parent)) {
      RNL_LOGW("rnLinux") << "appendChild: parent " << parentId
                          << " is not a GtkFixed";
      return jsi::Value::undefined();
    }
    // If already parented somewhere, detach first.
    if (auto* current = gtk_widget_get_parent(child)) {
      if (GTK_IS_FIXED(current)) gtk_fixed_remove(GTK_FIXED(current), child);
    }
    gtk_fixed_put(GTK_FIXED(parent), child, 0, 0);
    return jsi::Value::undefined();
  });

  bindMethod(rt, rnLinux, "removeChild", 2,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 2) return jsi::Value::undefined();
    int parentId = static_cast<int>(args[0].asNumber());
    int childId = static_cast<int>(args[1].asNumber());
    GtkWidget* parent = state().lookup(parentId);
    GtkWidget* child = state().lookup(childId);
    if (parent && child && GTK_IS_FIXED(parent)) {
      gtk_fixed_remove(GTK_FIXED(parent), child);
    }
    return jsi::Value::undefined();
  });

  bindMethod(rt, rnLinux, "setRoot", 1,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 1) return jsi::Value::undefined();
    int id = static_cast<int>(args[0].asNumber());
    GtkWidget* child = state().lookup(id);
    GtkWidget* root = state().rootView;
    if (!child || !root || !GTK_IS_FIXED(root)) return jsi::Value::undefined();
    // Remove any existing children so React owns the canvas.
    GtkWidget* existing = gtk_widget_get_first_child(root);
    while (existing) {
      GtkWidget* next = gtk_widget_get_next_sibling(existing);
      gtk_fixed_remove(GTK_FIXED(root), existing);
      existing = next;
    }
    if (auto* current = gtk_widget_get_parent(child)) {
      if (GTK_IS_FIXED(current)) gtk_fixed_remove(GTK_FIXED(current), child);
    }
    gtk_fixed_put(GTK_FIXED(root), child, 0, 0);
    return jsi::Value::undefined();
  });

  bindMethod(rt, rnLinux, "log", 2,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    std::string level = count > 0 ? args[0].asString(rt).utf8(rt) : "info";
    std::string msg = count > 1 ? args[1].asString(rt).utf8(rt) : "";
    if (level == "error") RNL_LOGE("js") << msg;
    else if (level == "warn") RNL_LOGW("js") << msg;
    else RNL_LOGI("js") << msg;
    return jsi::Value::undefined();
  });

  // `rnLinux.onClick(nodeId, fn | null)` — install / replace / remove a
  // press handler. fn is invoked once per click (released-after-press)
  // with no arguments. Passing null detaches the handler; the
  // GtkGestureClick controller stays attached (cheap) but inert.
  bindMethod(rt, rnLinux, "onClick", 2,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 2) return jsi::Value::undefined();
    int id = static_cast<int>(args[0].asNumber());
    GtkWidget* w = state().lookup(id);
    if (!w) return jsi::Value::undefined();

    if (args[1].isNull() || args[1].isUndefined()) {
      state().clickHandlers.erase(id);
      return jsi::Value::undefined();
    }
    state().clickHandlers[id] = std::make_shared<jsi::Function>(
        args[1].asObject(rt).asFunction(rt));

    // Add a GtkGestureClick once per widget; subsequent calls just
    // replace the stored jsi::Function above.
    if (!g_object_get_data(G_OBJECT(w), "rnl-click-gesture")) {
      auto* gesture = gtk_gesture_click_new();
      g_object_set_data_full(G_OBJECT(w), "rnl-click-gesture",
                             gesture, g_object_unref);
      auto idPayload = GINT_TO_POINTER(id);
      g_signal_connect_data(
          gesture, "released",
          G_CALLBACK(+[](GtkGestureClick* /*gc*/, int /*n_press*/,
                          double /*x*/, double /*y*/, gpointer ud) {
            int nodeId = GPOINTER_TO_INT(ud);
            auto it = state().clickHandlers.find(nodeId);
            if (it == state().clickHandlers.end() || !state().runtime) return;
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
              RNL_LOGE("rnLinux") << "click handler threw: " << e.getMessage();
            } catch (const std::exception& e) {
              RNL_LOGE("rnLinux") << "click handler threw: " << e.what();
            }
          }),
          idPayload, /*destroy=*/nullptr, /*flags=*/static_cast<GConnectFlags>(0));
      gtk_widget_add_controller(w, GTK_EVENT_CONTROLLER(gesture));
    }
    return jsi::Value::undefined();
  });

  // requestAnimationFrame backed by g_timeout_add at ~60fps. Real RN
  // schedules these on the platform's native compositor vsync; we'd
  // wire to GdkFrameClock for that, but a 16ms tick is fine for the
  // playground demo work.
  bindMethod(rt, rnLinux, "requestAnimationFrame", 1,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 1) return jsi::Value::undefined();
    auto fn = std::make_shared<jsi::Function>(
        args[0].asObject(rt).asFunction(rt));
    int handlerId = state().nextTimerId++;
    // One-shot — return G_SOURCE_REMOVE inside the callback.
    guint sourceId = g_timeout_add(16,
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
            fn->call(*state().runtime, jsi::Value{tMs});
            state().runtime->drainMicrotasks();
          } catch (const jsi::JSError& e) {
            RNL_LOGE("rnLinux") << "rAF threw: " << e.getMessage();
          } catch (const std::exception& e) {
            RNL_LOGE("rnLinux") << "rAF threw: " << e.what();
          }
          return G_SOURCE_REMOVE;
        },
        GINT_TO_POINTER(handlerId));
    state().timerHandlers[handlerId] = {sourceId, std::move(fn)};
    return jsi::Value{handlerId};
  });

  bindMethod(rt, rnLinux, "cancelAnimationFrame", 1,
      [](jsi::Runtime& /*rt*/, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 1) return jsi::Value::undefined();
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
  bindMethod(rt, rnLinux, "setInterval", 2,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 2) return jsi::Value::undefined();
    auto fn = std::make_shared<jsi::Function>(
        args[0].asObject(rt).asFunction(rt));
    guint ms = static_cast<guint>(args[1].asNumber());
    int handlerId = state().nextTimerId++;
    guint sourceId = g_timeout_add(ms,
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
  bindMethod(rt, rnLinux, "fabricOnClick", 2,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 2) return jsi::Value::undefined();
    int tag = static_cast<int>(args[0].asNumber());
    if (args[1].isNull() || args[1].isUndefined()) {
      state().fabricClickHandlers.erase(tag);
      return jsi::Value::undefined();
    }
    state().fabricClickHandlers[tag] = std::make_shared<jsi::Function>(
        args[1].asObject(rt).asFunction(rt));
    return jsi::Value::undefined();
  });

  // Sibling of fabricOnClick — registers the JS function invoked
  // whenever a TextInput's GtkText "changed" signal fires.
  bindMethod(rt, rnLinux, "fabricOnChangeText", 2,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 2) return jsi::Value::undefined();
    int tag = static_cast<int>(args[0].asNumber());
    if (args[1].isNull() || args[1].isUndefined()) {
      state().fabricChangeTextHandlers.erase(tag);
      return jsi::Value::undefined();
    }
    state().fabricChangeTextHandlers[tag] = std::make_shared<jsi::Function>(
        args[1].asObject(rt).asFunction(rt));
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

  bindMethod(rt, rnLinux, "storageRead", 1,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 1) return jsi::Value::null();
    auto v = asyncStorageRead(args[0].asString(rt).utf8(rt));
    if (v.empty()) return jsi::Value::null();
    return jsi::Value{jsi::String::createFromUtf8(rt, v)};
  });

  bindMethod(rt, rnLinux, "storageWrite", 2,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 2) return jsi::Value::undefined();
    asyncStorageWrite(args[0].asString(rt).utf8(rt),
                      args[1].asString(rt).utf8(rt));
    return jsi::Value::undefined();
  });

  bindMethod(rt, rnLinux, "storageRemove", 1,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 1) return jsi::Value::undefined();
    asyncStorageRemove(args[0].asString(rt).utf8(rt));
    return jsi::Value::undefined();
  });

  bindMethod(rt, rnLinux, "storageKeys", 0,
      [](jsi::Runtime& rt, const jsi::Value&,
         const jsi::Value*, size_t) -> jsi::Value {
    auto keys = asyncStorageKeys();
    jsi::Array arr{rt, keys.size()};
    for (size_t i = 0; i < keys.size(); ++i) {
      arr.setValueAtIndex(rt, i,
                          jsi::String::createFromUtf8(rt, keys[i]));
    }
    return arr;
  });

  bindMethod(rt, rnLinux, "clearInterval", 1,
      [](jsi::Runtime& /*rt*/, const jsi::Value&,
         const jsi::Value* args, size_t count) -> jsi::Value {
    if (count < 1) return jsi::Value::undefined();
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

}  // namespace rnlinux
