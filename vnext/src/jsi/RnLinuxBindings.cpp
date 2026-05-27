#include "RnLinuxBindings.h"

#include "../camera/Camera.h"
#include "../deviceinfo/DeviceInfo.h"
#include "../filepicker/FilePicker.h"
#include "../filesystem/FileSystem.h"
#include "../keepawake/KeepAwake.h"
#include "../locale/Locale.h"
#include "../location/Location.h"
#include "../network/Network.h"
#include "../notifications/Notifications.h"
#include "../print/Print.h"
#include "../securestore/SecureStore.h"
#include "../views/ImageComponentView.h"
#include "react-native-linux/Logging.h"

#include <array>
#include <atomic>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <gtk/gtk.h>
#include <jsi/jsi.h>
#include <string>
#include <sys/random.h>
#include <unordered_map>
#include <vector>

#ifdef RNL_FS_HAVE_SOUP
#include <libsoup/soup.h>
#endif

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

  // expo-clipboard's addClipboardListener fan-out target. One
  // GdkClipboard `changed` signal handler; JS shim fans it out
  // to N subscribers. Stored here so reset() can release the
  // jsi::Function before the runtime gets destroyed.
  std::shared_ptr<jsi::Function> clipboardOnChange;
  gulong clipboardOnChangeSignalId{0};
  GdkClipboard* clipboardOnChangeSrc{nullptr};

  // expo-localization listener — same shape as clipboard. The
  // GFileMonitor watches /etc/locale.conf (and /etc/default/locale
  // on Debian/Ubuntu) so a `localectl set-locale` from another
  // shell wakes the running app. Held as two monitors because
  // either file may be absent depending on the distro.
  std::shared_ptr<jsi::Function> localeOnChange;
  GFileMonitor* localeMonitorEtc{nullptr};
  GFileMonitor* localeMonitorDefault{nullptr};
  gulong localeMonitorEtcSignalId{0};
  gulong localeMonitorDefaultSignalId{0};

  // Phase 5.8: every C++→JS callback (dispatchFabric*, fetch result,
  // GIO/libsoup signals) posts through this executor instead of
  // dereferencing `runtime` directly. The runtime lives on a worker
  // pthread now, so a direct call from a GTK / libsoup handler would
  // trap Hermes' pthread-binding guard.
  RuntimeExecutor executor;

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
  rnlinux::keepawake::reset();
  rnlinux::network::reset();
  // Disconnect the clipboard `changed` signal so post-reload
  // signal emissions don't fire into the freed Hermes through
  // the captured shared_ptr<jsi::Function>.
  if (state().clipboardOnChangeSrc && state().clipboardOnChangeSignalId != 0) {
    g_signal_handler_disconnect(state().clipboardOnChangeSrc, state().clipboardOnChangeSignalId);
    state().clipboardOnChangeSignalId = 0;
  }
  state().clipboardOnChange.reset();
  state().clipboardOnChangeSrc = nullptr;
  // Same shape for the locale file-monitor pair.
  if (state().localeMonitorEtc && state().localeMonitorEtcSignalId != 0) {
    g_signal_handler_disconnect(state().localeMonitorEtc, state().localeMonitorEtcSignalId);
    state().localeMonitorEtcSignalId = 0;
  }
  if (state().localeMonitorEtc) {
    g_object_unref(state().localeMonitorEtc);
    state().localeMonitorEtc = nullptr;
  }
  if (state().localeMonitorDefault && state().localeMonitorDefaultSignalId != 0) {
    g_signal_handler_disconnect(state().localeMonitorDefault, state().localeMonitorDefaultSignalId);
    state().localeMonitorDefaultSignalId = 0;
  }
  if (state().localeMonitorDefault) {
    g_object_unref(state().localeMonitorDefault);
    state().localeMonitorDefault = nullptr;
  }
  state().localeOnChange.reset();
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
  if (!s.executor)
    return;
  s.executor([tag](jsi::Runtime& rt) {
    auto& s = state();
    auto it = s.fabricClickHandlers.find(tag);
    if (it == s.fabricClickHandlers.end())
      return;
    try {
      it->second->call(rt);
      // React schedules state-update work on a microtask; drain so the
      // resulting commit happens before this turn yields.
      rt.drainMicrotasks();
    } catch (const jsi::JSError& e) {
      RNL_LOGE("rnLinux") << "fabric click handler threw: " << e.getMessage();
      reportJsErrorToErrorUtils(rt, e);
    } catch (const std::exception& e) {
      RNL_LOGE("rnLinux") << "fabric click handler threw: " << e.what();
    }
  });
}

void setFabricWidgetLookupForJsi(std::function<GtkWidget*(int)> lookup) {
  state().fabricLookup = std::move(lookup);
}

void setReloadCallbackForJsi(std::function<void()> reload) {
  state().reload = std::move(reload);
}

void setRuntimeExecutorForJsi(RuntimeExecutor executor) {
  state().executor = std::move(executor);
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
  if (!s.executor)
    return;
  s.executor([tag, text](jsi::Runtime& rt) {
    auto& s = state();
    auto it = s.fabricChangeTextHandlers.find(tag);
    if (it == s.fabricChangeTextHandlers.end())
      return;
    try {
      it->second->call(rt, jsi::String::createFromUtf8(rt, text));
      rt.drainMicrotasks();
    } catch (const jsi::JSError& e) {
      RNL_LOGE("rnLinux") << "fabric changeText handler threw: " << e.getMessage();
    } catch (const std::exception& e) {
      RNL_LOGE("rnLinux") << "fabric changeText handler threw: " << e.what();
    }
  });
}

void dispatchFabricSubmitEditing(int tag) {
  auto& s = state();
  if (!s.executor)
    return;
  s.executor([tag](jsi::Runtime& rt) {
    auto& s = state();
    auto it = s.fabricSubmitEditingHandlers.find(tag);
    if (it == s.fabricSubmitEditingHandlers.end())
      return;
    try {
      it->second->call(rt);
      rt.drainMicrotasks();
    } catch (const std::exception& e) {
      RNL_LOGE("rnLinux") << "fabric submitEditing handler threw: " << e.what();
    }
  });
}

void dispatchFabricKeyPress(int tag, const std::string& key) {
  auto& s = state();
  if (!s.executor)
    return;
  s.executor([tag, key](jsi::Runtime& rt) {
    auto& s = state();
    auto it = s.fabricKeyPressHandlers.find(tag);
    if (it == s.fabricKeyPressHandlers.end())
      return;
    try {
      it->second->call(rt, jsi::String::createFromUtf8(rt, key));
      rt.drainMicrotasks();
    } catch (const std::exception& e) {
      RNL_LOGE("rnLinux") << "fabric keyPress handler threw: " << e.what();
    }
  });
}

void dispatchFabricSwitchChange(int tag, bool value) {
  auto& s = state();
  if (!s.executor)
    return;
  s.executor([tag, value](jsi::Runtime& rt) {
    auto& s = state();
    auto it = s.fabricSwitchHandlers.find(tag);
    if (it == s.fabricSwitchHandlers.end())
      return;
    try {
      it->second->call(rt, jsi::Value(value));
      rt.drainMicrotasks();
    } catch (const jsi::JSError& e) {
      RNL_LOGE("rnLinux") << "fabric switchChange handler threw: " << e.getMessage();
    } catch (const std::exception& e) {
      RNL_LOGE("rnLinux") << "fabric switchChange handler threw: " << e.what();
    }
  });
}

void dispatchFabricScroll(int tag,
                          double offsetX,
                          double offsetY,
                          double contentWidth,
                          double contentHeight,
                          double viewportWidth,
                          double viewportHeight) {
  auto& s = state();
  if (!s.executor)
    return;
  s.executor([tag, offsetX, offsetY, contentWidth, contentHeight, viewportWidth, viewportHeight](
                 jsi::Runtime& rt) {
    auto& s = state();
    auto it = s.fabricScrollHandlers.find(tag);
    if (it == s.fabricScrollHandlers.end())
      return;
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
  });
}

void dispatchFabricFocus(int tag) {
  auto& s = state();
  if (!s.executor)
    return;
  s.executor([tag](jsi::Runtime& rt) {
    auto& s = state();
    auto it = s.fabricFocusHandlers.find(tag);
    if (it == s.fabricFocusHandlers.end())
      return;
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
  });
}

void dispatchFabricBlur(int tag) {
  auto& s = state();
  if (!s.executor)
    return;
  s.executor([tag](jsi::Runtime& rt) {
    auto& s = state();
    auto it = s.fabricBlurHandlers.find(tag);
    if (it == s.fabricBlurHandlers.end())
      return;
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
  });
}

void dispatchFabricLayout(int tag, float x, float y, float w, float h) {
  auto& s = state();
  if (!s.executor)
    return;
  // Skip if this view's layout hasn't actually changed since the last
  // dispatch — a single React commit can fire updateLayoutMetrics
  // multiple times (Yoga relayout passes, state-driven re-runs), and
  // RN apps loop forever if onLayout keeps re-firing for the same
  // metrics (handler calls setState → re-render → re-layout → re-fire).
  // The dedupe is intentionally on the *main* thread side: layout
  // events fire at high rate (every Yoga pass) and we want to drop
  // duplicates before they queue up on the worker.
  std::array<float, 4> next{x, y, w, h};
  auto& last = s.fabricLayoutLast[tag];
  if (last == next)
    return;
  last = next;
  s.executor([tag, x, y, w, h](jsi::Runtime& rt) {
    auto& s = state();
    auto it = s.fabricLayoutHandlers.find(tag);
    if (it == s.fabricLayoutHandlers.end())
      return;
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
  });
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
  // setTimeout — one-shot timer mirroring setInterval's plumbing but
  // returning G_SOURCE_REMOVE on the first tick. The JS shim layer
  // had been polyfilling setTimeout to Promise.resolve().then which
  // ignored the delay; that broke any future-scheduled work (the
  // expo-notifications JS scheduler fired everything immediately).
  bindMethod(
      rt,
      rnLinux,
      "setTimeout",
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
                RNL_LOGE("rnLinux") << "timeout threw: " << e.getMessage();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux") << "timeout threw: " << e.what();
              }
              // One-shot — drop our handle so a subsequent clearTimeout
              // call on a stale id is a no-op.
              state().timerHandlers.erase(hid);
              return G_SOURCE_REMOVE;
            },
            GINT_TO_POINTER(handlerId));
        state().timerHandlers[handlerId] = {sourceId, std::move(fn)};
        return jsi::Value{handlerId};
      });

  bindMethod(
      rt,
      rnLinux,
      "clearTimeout",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
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

  // expo-crypto backing. CSPRNG random bytes and SHA-1/256/384/512
  // digests. Both surface to JS as base64 strings so the JSI marshal
  // doesn't have to deal with ArrayBuffers / typed arrays — the JS
  // shim decodes back to Uint8Array when expo's API needs it.
  //
  // Random bytes come from getrandom(2) — the right CSPRNG syscall
  // on Linux ≥3.17 (we already require newer kernels for V4L2 /
  // logind). Falls back to /dev/urandom on older kernels via libc's
  // wrapper. Digests use GChecksum which is the same primitive the
  // file-system MD5 path already uses.
  bindMethod(
      rt,
      rnLinux,
      "cryptoRandomBytes",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isNumber())
          throw jsi::JSError(rt, "cryptoRandomBytes: byteCount required");
        const int n = static_cast<int>(args[0].asNumber());
        if (n <= 0 || n > 1024 * 1024) {
          // Cap at 1 MiB — DPoP signing wants 32 bytes, UUIDs want 16,
          // larger requests are almost always a bug.
          throw jsi::JSError(rt, "cryptoRandomBytes: byteCount out of range");
        }
        std::vector<unsigned char> buf(n);
        // glib's GRand is *not* cryptographically secure; getrandom
        // is. The flags=0 mode blocks on first boot if the kernel's
        // entropy pool isn't seeded yet (rare on real systems, never
        // on the smoke VM).
        ssize_t got = 0;
        while (got < n) {
          const ssize_t r = ::getrandom(buf.data() + got, n - got, 0);
          if (r < 0) {
            if (errno == EINTR)
              continue;
            throw jsi::JSError(rt, std::string{"cryptoRandomBytes: "} + std::strerror(errno));
          }
          got += r;
        }
        char* enc = g_base64_encode(buf.data(), buf.size());
        std::string out = enc ? std::string(enc) : std::string{};
        if (enc)
          g_free(enc);
        return jsi::String::createFromUtf8(rt, out);
      });

  bindMethod(
      rt,
      rnLinux,
      "cryptoDigest",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2 || !args[0].isString() || !args[1].isString())
          throw jsi::JSError(rt, "cryptoDigest(algorithm, base64Data) required");
        const auto algo = args[0].asString(rt).utf8(rt);
        const auto b64 = args[1].asString(rt).utf8(rt);
        GChecksumType type;
        if (algo == "SHA-1")
          type = G_CHECKSUM_SHA1;
        else if (algo == "SHA-256")
          type = G_CHECKSUM_SHA256;
        else if (algo == "SHA-384")
          type = G_CHECKSUM_SHA384;
        else if (algo == "SHA-512")
          type = G_CHECKSUM_SHA512;
        else if (algo == "MD5")
          type = G_CHECKSUM_MD5;
        else
          throw jsi::JSError(rt, std::string{"cryptoDigest: unsupported algorithm "} + algo);
        gsize decodedLen = 0;
        guchar* decoded = g_base64_decode(b64.c_str(), &decodedLen);
        if (!decoded)
          throw jsi::JSError(rt, "cryptoDigest: invalid base64 input");
        GChecksum* ck = g_checksum_new(type);
        if (!ck) {
          g_free(decoded);
          throw jsi::JSError(rt, "cryptoDigest: g_checksum_new failed");
        }
        g_checksum_update(ck, decoded, static_cast<gssize>(decodedLen));
        const char* hex = g_checksum_get_string(ck);
        std::string out = hex ? std::string{hex} : std::string{};
        g_checksum_free(ck);
        g_free(decoded);
        return jsi::String::createFromUtf8(rt, out);
      });

  // RFC 4122 v4 UUID via glib. Format matches expo's:
  // 36-char lowercase with dashes (8-4-4-4-12).
  bindMethod(rt,
             rnLinux,
             "cryptoUUID",
             0,
             [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               char* u = g_uuid_string_random();
               std::string out = u ? std::string{u} : std::string{};
               if (u)
                 g_free(u);
               return jsi::String::createFromUtf8(rt, out);
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

  // Cross-app clipboard read. The sync getter above only sees the
  // same process's own writes (GdkClipboard's content provider
  // holds those locally); fetching text another app put on the
  // selection requires the async read_text_async path that
  // negotiates the MIME transfer with the source app.
  bindMethod(
      rt,
      rnLinux,
      "clipboardGetStringAsync",
      2,
      [rootView](
          jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isObject() || !args[0].asObject(rt).isFunction(rt))
          return jsi::Value::undefined();
        auto onResult = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
        auto onError = count >= 2 && args[1].isObject() && args[1].asObject(rt).isFunction(rt)
                           ? std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt))
                           : nullptr;
        GdkClipboard* cb = gdk_display_get_clipboard(gtk_widget_get_display(rootView));
        if (!cb) {
          if (onError) {
            auto& s = state();
            if (s.runtime) {
              try {
                onError->call(*s.runtime, jsi::String::createFromUtf8(*s.runtime, "no clipboard"));
                s.runtime->drainMicrotasks();
              } catch (...) {
              }
            }
          }
          return jsi::Value::undefined();
        }
        // The async callback can fire after a JS reload swaps the
        // runtime out. Capture by shared_ptr; the trampoline
        // checks state().runtime is still live before calling.
        struct Ctx {
          std::shared_ptr<jsi::Function> onResult;
          std::shared_ptr<jsi::Function> onError;
        };
        auto* ctx = new Ctx{std::move(onResult), std::move(onError)};
        gdk_clipboard_read_text_async(
            cb,
            nullptr,
            +[](GObject* src, GAsyncResult* res, gpointer userData) {
              auto* ctx = static_cast<Ctx*>(userData);
              auto& s = state();
              GError* err = nullptr;
              gchar* text = gdk_clipboard_read_text_finish(GDK_CLIPBOARD(src), res, &err);
              if (s.runtime) {
                jsi::Runtime& jrt = *s.runtime;
                try {
                  if (text) {
                    if (ctx->onResult)
                      ctx->onResult->call(jrt, jsi::String::createFromUtf8(jrt, text));
                  } else if (err && ctx->onError) {
                    ctx->onError->call(jrt,
                                       jsi::String::createFromUtf8(
                                           jrt, err->message ? err->message : "(read failed)"));
                  } else if (ctx->onResult) {
                    // No text on the clipboard right now — that's
                    // not an error; expo's contract is empty
                    // string for "nothing readable as text".
                    ctx->onResult->call(jrt, jsi::String::createFromUtf8(jrt, ""));
                  }
                  jrt.drainMicrotasks();
                } catch (const std::exception& e) {
                  RNL_LOGE("rnLinux.clipboard") << "async cb threw: " << e.what();
                }
              }
              if (text)
                g_free(text);
              if (err)
                g_error_free(err);
              delete ctx;
            },
            ctx);
        return jsi::Value::undefined();
      });

  // clipboardSetImage / clipboardGetImageAsync — PNG round-trip
  // through GdkTexture. Encoded as base64 across the JSI boundary
  // because Hermes JSI doesn't have a fast path for binary blobs
  // (ArrayBuffer would copy through a TypedArray anyway, and base64
  // matches the upstream expo-clipboard API shape).
  bindMethod(
      rt,
      rnLinux,
      "clipboardSetImage",
      1,
      [rootView](
          jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isString())
          return jsi::Value(false);
        const auto base64 = args[0].asString(rt).utf8(rt);
        gsize decodedLen = 0;
        guchar* decoded = g_base64_decode(base64.c_str(), &decodedLen);
        if (!decoded || decodedLen == 0) {
          if (decoded)
            g_free(decoded);
          return jsi::Value(false);
        }
        // gdk_texture_new_from_bytes covers PNG/JPEG; the bytes
        // wrapper takes ownership so the buffer frees with the
        // texture's lifecycle. The texture itself drops out of
        // scope after gdk_clipboard_set_texture, which retains its
        // own ref.
        GBytes* bytes = g_bytes_new_take(decoded, decodedLen);
        GError* err = nullptr;
        GdkTexture* tex = gdk_texture_new_from_bytes(bytes, &err);
        g_bytes_unref(bytes);
        if (!tex) {
          RNL_LOGW("rnLinux.clipboard")
              << "image decode failed: " << (err && err->message ? err->message : "(unknown)");
          if (err)
            g_error_free(err);
          return jsi::Value(false);
        }
        GdkClipboard* cb = gdk_display_get_clipboard(gtk_widget_get_display(rootView));
        if (!cb) {
          g_object_unref(tex);
          return jsi::Value(false);
        }
        gdk_clipboard_set_texture(cb, tex);
        g_object_unref(tex);
        return jsi::Value(true);
      });

  bindMethod(
      rt,
      rnLinux,
      "clipboardGetImageAsync",
      2,
      [rootView](
          jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isObject() || !args[0].asObject(rt).isFunction(rt))
          return jsi::Value::undefined();
        auto onResult = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
        auto onError = count >= 2 && args[1].isObject() && args[1].asObject(rt).isFunction(rt)
                           ? std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt))
                           : nullptr;
        GdkClipboard* cb = gdk_display_get_clipboard(gtk_widget_get_display(rootView));
        if (!cb) {
          auto& s = state();
          if (s.runtime && onError) {
            try {
              onError->call(*s.runtime, jsi::String::createFromUtf8(*s.runtime, "no clipboard"));
              s.runtime->drainMicrotasks();
            } catch (...) {
            }
          }
          return jsi::Value::undefined();
        }
        struct ImgCtx {
          std::shared_ptr<jsi::Function> onResult;
          std::shared_ptr<jsi::Function> onError;
        };
        auto* ctx = new ImgCtx{std::move(onResult), std::move(onError)};
        gdk_clipboard_read_texture_async(
            cb,
            nullptr,
            +[](GObject* src, GAsyncResult* res, gpointer userData) {
              auto* ctx = static_cast<ImgCtx*>(userData);
              auto& s = state();
              GError* err = nullptr;
              GdkTexture* tex = gdk_clipboard_read_texture_finish(GDK_CLIPBOARD(src), res, &err);
              if (s.runtime) {
                jsi::Runtime& jrt = *s.runtime;
                try {
                  if (tex) {
                    // Re-encode as PNG so JS gets a self-describing
                    // payload. gdk_texture_save_to_png_bytes uses
                    // the same loader libpixbuf knows about.
                    GBytes* png = gdk_texture_save_to_png_bytes(tex);
                    if (png) {
                      gsize len = 0;
                      const void* data = g_bytes_get_data(png, &len);
                      char* enc = g_base64_encode(static_cast<const guchar*>(data), len);
                      if (ctx->onResult) {
                        ctx->onResult->call(jrt,
                                            jsi::String::createFromUtf8(jrt, enc ? enc : ""),
                                            jsi::String::createFromUtf8(jrt, "image/png"));
                      }
                      if (enc)
                        g_free(enc);
                      g_bytes_unref(png);
                    } else if (ctx->onResult) {
                      // Texture but PNG encode failed — return empty
                      // payload so consumers can branch on it the
                      // same way they would for "nothing copied".
                      ctx->onResult->call(jrt,
                                          jsi::String::createFromUtf8(jrt, ""),
                                          jsi::String::createFromUtf8(jrt, ""));
                    }
                    g_object_unref(tex);
                  } else if (err && ctx->onError) {
                    ctx->onError->call(jrt,
                                       jsi::String::createFromUtf8(
                                           jrt, err->message ? err->message : "(read failed)"));
                  } else if (ctx->onResult) {
                    // Empty clipboard or no image on it — match the
                    // text-async contract of "empty string for nothing".
                    ctx->onResult->call(jrt,
                                        jsi::String::createFromUtf8(jrt, ""),
                                        jsi::String::createFromUtf8(jrt, ""));
                  }
                  jrt.drainMicrotasks();
                } catch (const std::exception& e) {
                  RNL_LOGE("rnLinux.clipboard") << "image read cb threw: " << e.what();
                }
              }
              if (err)
                g_error_free(err);
              delete ctx;
            },
            ctx);
        return jsi::Value::undefined();
      });

  // clipboardSetHtml — publishes a unioned content provider with
  // both text/html (the rich payload) and text/plain (an extracted
  // fallback the JS shim supplies). Two providers because a lot of
  // consumers — terminals, search bars, many GTK apps — only ask
  // for text/plain and would miss the HTML branch otherwise.
  bindMethod(
      rt,
      rnLinux,
      "clipboardSetHtml",
      2,
      [rootView](
          jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isString())
          return jsi::Value(false);
        const auto html = args[0].asString(rt).utf8(rt);
        const auto plain = count >= 2 && args[1].isString() ? args[1].asString(rt).utf8(rt) : html;
        GdkClipboard* cb = gdk_display_get_clipboard(gtk_widget_get_display(rootView));
        if (!cb)
          return jsi::Value(false);
        GBytes* htmlBytes = g_bytes_new(html.data(), html.size());
        GBytes* plainBytes = g_bytes_new(plain.data(), plain.size());
        GdkContentProvider* htmlProvider =
            gdk_content_provider_new_for_bytes("text/html", htmlBytes);
        GdkContentProvider* plainProvider =
            gdk_content_provider_new_for_bytes("text/plain;charset=utf-8", plainBytes);
        g_bytes_unref(htmlBytes);
        g_bytes_unref(plainBytes);
        // `gdk_content_provider_new_union` is transfer-full on the
        // providers array — it takes over our refs, so we don't
        // unref the inner providers afterwards (doing so frees them
        // out from under the union, which segfaults later reads).
        GdkContentProvider* providers[] = {htmlProvider, plainProvider};
        GdkContentProvider* unionProvider = gdk_content_provider_new_union(providers, 2);
        const gboolean ok = gdk_clipboard_set_content(cb, unionProvider);
        g_object_unref(unionProvider);
        return jsi::Value(static_cast<bool>(ok));
      });

  // clipboardGetHtmlAsync — asks the selection holder for text/html
  // specifically. The async read returns a GInputStream plus the
  // negotiated MIME; we drain the stream synchronously inside the
  // callback (HTML payloads are bounded — clipboards aren't a
  // streaming surface). Returns empty string when nothing on the
  // clipboard advertises text/html.
  bindMethod(
      rt,
      rnLinux,
      "clipboardGetHtmlAsync",
      2,
      [rootView](
          jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isObject() || !args[0].asObject(rt).isFunction(rt))
          return jsi::Value::undefined();
        auto onResult = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
        auto onError = count >= 2 && args[1].isObject() && args[1].asObject(rt).isFunction(rt)
                           ? std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt))
                           : nullptr;
        GdkClipboard* cb = gdk_display_get_clipboard(gtk_widget_get_display(rootView));
        if (!cb) {
          auto& s = state();
          if (s.runtime && onError) {
            try {
              onError->call(*s.runtime, jsi::String::createFromUtf8(*s.runtime, "no clipboard"));
              s.runtime->drainMicrotasks();
            } catch (...) {
            }
          }
          return jsi::Value::undefined();
        }
        struct HtmlCtx {
          std::shared_ptr<jsi::Function> onResult;
          std::shared_ptr<jsi::Function> onError;
        };
        auto* ctx = new HtmlCtx{std::move(onResult), std::move(onError)};
        static const char* mimes[] = {"text/html", nullptr};
        gdk_clipboard_read_async(
            cb,
            mimes,
            G_PRIORITY_DEFAULT,
            nullptr,
            +[](GObject* src, GAsyncResult* res, gpointer userData) {
              auto* ctx = static_cast<HtmlCtx*>(userData);
              auto& s = state();
              GError* err = nullptr;
              const char* outMime = nullptr;
              GInputStream* stream =
                  gdk_clipboard_read_finish(GDK_CLIPBOARD(src), res, &outMime, &err);
              std::string body;
              if (stream) {
                // 8 KiB chunks — HTML payloads usually fit in one
                // iteration; this caps memory use if some misbehaved
                // app pastes a huge document.
                char buf[8192];
                gssize n = 0;
                while ((n = g_input_stream_read(stream, buf, sizeof(buf), nullptr, nullptr)) > 0) {
                  body.append(buf, static_cast<size_t>(n));
                }
                g_object_unref(stream);
              }
              if (s.runtime) {
                jsi::Runtime& jrt = *s.runtime;
                try {
                  if (stream) {
                    if (ctx->onResult)
                      ctx->onResult->call(jrt, jsi::String::createFromUtf8(jrt, body));
                  } else if (err && ctx->onError) {
                    ctx->onError->call(jrt,
                                       jsi::String::createFromUtf8(
                                           jrt, err->message ? err->message : "(read failed)"));
                  } else if (ctx->onResult) {
                    ctx->onResult->call(jrt, jsi::String::createFromUtf8(jrt, ""));
                  }
                  jrt.drainMicrotasks();
                } catch (const std::exception& e) {
                  RNL_LOGE("rnLinux.clipboard") << "html read cb threw: " << e.what();
                }
              }
              if (err)
                g_error_free(err);
              delete ctx;
            },
            ctx);
        return jsi::Value::undefined();
      });

  // clipboardSetFiles — publishes a GdkFileList content provider so
  // file managers can paste the file refs as a real list (not just
  // text URIs). Accepts a JS array of absolute paths; converts to a
  // GSList<GFile*> on the way through.
  bindMethod(
      rt,
      rnLinux,
      "clipboardSetFiles",
      1,
      [rootView](
          jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isObject() || !args[0].asObject(rt).isArray(rt))
          return jsi::Value(false);
        auto arr = args[0].asObject(rt).asArray(rt);
        const size_t n = arr.size(rt);
        if (n == 0)
          return jsi::Value(false);
        GdkClipboard* cb = gdk_display_get_clipboard(gtk_widget_get_display(rootView));
        if (!cb)
          return jsi::Value(false);
        GSList* list = nullptr;
        for (size_t i = 0; i < n; ++i) {
          auto v = arr.getValueAtIndex(rt, i);
          if (!v.isString())
            continue;
          const auto path = v.asString(rt).utf8(rt);
          // Strip file:// so a JS caller can pass URIs that came out
          // of file pickers / fsConstants without the C++ side caring.
          const std::string clean = path.rfind("file://", 0) == 0 ? path.substr(7) : path;
          GFile* gf = g_file_new_for_path(clean.c_str());
          if (gf)
            list = g_slist_prepend(list, gf);
        }
        if (!list)
          return jsi::Value(false);
        list = g_slist_reverse(list);
        GdkFileList* fileList = gdk_file_list_new_from_list(list);
        // gdk_file_list_new_from_list takes its own refs on each
        // GFile, so we own + free both the slist nodes AND the
        // initial g_object_unref of each.
        g_slist_free_full(list, g_object_unref);
        GdkContentProvider* provider = gdk_content_provider_new_typed(GDK_TYPE_FILE_LIST, fileList);
        g_boxed_free(GDK_TYPE_FILE_LIST, fileList);
        const gboolean ok = gdk_clipboard_set_content(cb, provider);
        g_object_unref(provider);
        return jsi::Value(static_cast<bool>(ok));
      });

  // clipboardSetChangeListener — fan-out trampoline for
  // GdkClipboard's `changed` signal. The signal fires on every
  // clipboard write from any source (this app or another), so
  // expo-clipboard apps that subscribe via addClipboardListener
  // get real cross-app notifications. State lives in the shared
  // `state()` struct so resetRnLinuxBindings can release the
  // jsi::Function before the runtime dies.
  bindMethod(
      rt,
      rnLinux,
      "clipboardSetChangeListener",
      1,
      [rootView](
          jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        auto& s = state();
        if (s.clipboardOnChangeSrc && s.clipboardOnChangeSignalId != 0) {
          g_signal_handler_disconnect(s.clipboardOnChangeSrc, s.clipboardOnChangeSignalId);
          s.clipboardOnChangeSignalId = 0;
        }
        s.clipboardOnChange.reset();
        if (count < 1 || args[0].isNull() || args[0].isUndefined()) {
          return jsi::Value::undefined();
        }
        GdkClipboard* cb = gdk_display_get_clipboard(gtk_widget_get_display(rootView));
        if (!cb)
          return jsi::Value::undefined();
        s.clipboardOnChange = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
        s.clipboardOnChangeSrc = cb;
        s.clipboardOnChangeSignalId = g_signal_connect(cb,
                                                       "changed",
                                                       G_CALLBACK(+[](GdkClipboard*, gpointer) {
                                                         auto& s = state();
                                                         if (!s.runtime || !s.clipboardOnChange)
                                                           return;
                                                         jsi::Runtime& jrt = *s.runtime;
                                                         try {
                                                           // expo's addClipboardListener fires with
                                                           // a {} payload (the iOS/Android payload
                                                           // is content- type metadata we don't
                                                           // carry). Consumers re-call
                                                           // getStringAsync if they want the new
                                                           // text — matches the expo idiom.
                                                           jsi::Object o(jrt);
                                                           s.clipboardOnChange->call(jrt, o);
                                                           jrt.drainMicrotasks();
                                                         } catch (const std::exception& e) {
                                                           RNL_LOGE("rnLinux.clipboard")
                                                               << "change listener threw: "
                                                               << e.what();
                                                         }
                                                       }),
                                                       nullptr);
        return jsi::Value::undefined();
      });

  // Appearance.getColorScheme backing. Reads, in priority order:
  //   1. the RN_LINUX_COLOR_SCHEME env var ("dark", "light", "auto")
  //      — useful for forcing a theme inside the dev VM where Xfce
  //      doesn't drive GTK4's app-prefer-dark setting on its own;
  //   2. the GTK setting `gtk-application-prefer-dark-theme`, which a
  //      GNOME / libadwaita desktop wires to the system "Appearance"
  //      panel.
  bindMethod(rt,
             rnLinux,
             "getColorScheme",
             0,
             [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               if (const char* env = std::getenv("RN_LINUX_COLOR_SCHEME")) {
                 if (g_ascii_strcasecmp(env, "dark") == 0)
                   return jsi::String::createFromUtf8(rt, "dark");
                 if (g_ascii_strcasecmp(env, "light") == 0)
                   return jsi::String::createFromUtf8(rt, "light");
                 // anything else (including "auto") falls through to the
                 // GtkSettings read below.
               }
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

  // ─── Localization (expo-localization) ────────────────────────────
  // Pure libc + sysfs reads — synchronous and cheap. JS shim
  // wraps in Promise.resolve where the upstream API is async.

  auto snapshotToObj = [](jsi::Runtime& rt,
                          const rnlinux::locale::LocaleSnapshot& s) -> jsi::Object {
    jsi::Object o(rt);
    o.setProperty(rt, "languageTag", jsi::String::createFromUtf8(rt, s.languageTag));
    o.setProperty(rt, "languageCode", jsi::String::createFromUtf8(rt, s.languageCode));
    o.setProperty(rt, "regionCode", jsi::String::createFromUtf8(rt, s.regionCode));
    o.setProperty(rt, "scriptCode", jsi::String::createFromUtf8(rt, s.scriptCode));
    o.setProperty(rt, "currencyCode", jsi::String::createFromUtf8(rt, s.currencyCode));
    o.setProperty(rt, "currencySymbol", jsi::String::createFromUtf8(rt, s.currencySymbol));
    o.setProperty(rt, "decimalSeparator", jsi::String::createFromUtf8(rt, s.decimalSeparator));
    o.setProperty(
        rt, "digitGroupingSeparator", jsi::String::createFromUtf8(rt, s.digitGroupingSeparator));
    o.setProperty(rt, "measuresTemperatureInCelsius", jsi::Value(s.measuresTemperatureInCelsius));
    o.setProperty(rt, "usesMetricSystem", jsi::Value(s.usesMetricSystem));
    o.setProperty(rt, "measurementSystem", jsi::String::createFromUtf8(rt, s.measurementSystem));
    o.setProperty(rt, "temperatureUnit", jsi::String::createFromUtf8(rt, s.temperatureUnit));
    o.setProperty(rt, "textDirection", jsi::String::createFromUtf8(rt, s.isRTL ? "rtl" : "ltr"));
    o.setProperty(rt, "isRTL", jsi::Value(s.isRTL));
    o.setProperty(rt, "timezone", jsi::String::createFromUtf8(rt, s.timezone));
    o.setProperty(rt, "firstWeekday", jsi::Value(s.firstWeekday));
    return o;
  };
  bindMethod(rt,
             rnLinux,
             "localeSnapshot",
             0,
             [snapshotToObj](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t)
                 -> jsi::Value { return snapshotToObj(rt, rnlinux::locale::snapshot()); });
  bindMethod(rt,
             rnLinux,
             "localePreferred",
             0,
             [snapshotToObj](
                 jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               const auto list = rnlinux::locale::preferredLocales();
               jsi::Array arr(rt, list.size());
               for (size_t i = 0; i < list.size(); ++i) {
                 arr.setValueAtIndex(rt, i, snapshotToObj(rt, list[i]));
               }
               return arr;
             });

  // Live locale-change subscription. GFileMonitor on the two
  // freedesktop / Debian-family paths fires on `localectl
  // set-locale`. The trampoline re-snapshots through libc — the
  // existing snapshot() reads LANG/LC_* from the environment, and
  // the GLib runtime updates that env on file change automatically
  // (so a fresh snapshot reflects the new locale without needing
  // an exec).
  bindMethod(
      rt,
      rnLinux,
      "localeSetListener",
      1,
      [snapshotToObj](
          jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        auto& s = state();
        // Tear any existing subscription down first — re-registering
        // is the documented way to swap the JS callback.
        if (s.localeMonitorEtc && s.localeMonitorEtcSignalId != 0) {
          g_signal_handler_disconnect(s.localeMonitorEtc, s.localeMonitorEtcSignalId);
          s.localeMonitorEtcSignalId = 0;
        }
        if (s.localeMonitorEtc) {
          g_object_unref(s.localeMonitorEtc);
          s.localeMonitorEtc = nullptr;
        }
        if (s.localeMonitorDefault && s.localeMonitorDefaultSignalId != 0) {
          g_signal_handler_disconnect(s.localeMonitorDefault, s.localeMonitorDefaultSignalId);
          s.localeMonitorDefaultSignalId = 0;
        }
        if (s.localeMonitorDefault) {
          g_object_unref(s.localeMonitorDefault);
          s.localeMonitorDefault = nullptr;
        }
        s.localeOnChange.reset();
        if (count < 1 || args[0].isNull() || args[0].isUndefined()) {
          return jsi::Value::undefined();
        }
        s.localeOnChange = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
        auto fireFromCallback = +[](GFileMonitor*, GFile*, GFile*, GFileMonitorEvent, gpointer ud) {
          auto* snapToObj = static_cast<
              std::function<jsi::Object(jsi::Runtime&, const rnlinux::locale::LocaleSnapshot&)>*>(
              ud);
          auto& st = state();
          if (!st.runtime || !st.localeOnChange)
            return;
          jsi::Runtime& jrt = *st.runtime;
          try {
            st.localeOnChange->call(jrt, (*snapToObj)(jrt, rnlinux::locale::snapshot()));
            jrt.drainMicrotasks();
          } catch (const std::exception& e) {
            RNL_LOGE("rnLinux.locale") << "listener threw: " << e.what();
          }
        };
        // Heap-allocate one copy of the snapshot-to-obj lambda so
        // both monitors share it; lifetime matches the listener
        // (cleared on next setListener call or reset()).
        static std::function<jsi::Object(jsi::Runtime&, const rnlinux::locale::LocaleSnapshot&)>
            sharedSnapshotToObj;
        sharedSnapshotToObj = snapshotToObj;
        auto attachMonitor = [&](const char* path, GFileMonitor*& slot, gulong& sigSlot) {
          GFile* f = g_file_new_for_path(path);
          if (!f)
            return;
          GError* err = nullptr;
          slot = g_file_monitor_file(f, G_FILE_MONITOR_NONE, nullptr, &err);
          g_object_unref(f);
          if (err) {
            g_error_free(err);
            slot = nullptr;
            return;
          }
          if (slot) {
            sigSlot = g_signal_connect(
                slot, "changed", G_CALLBACK(fireFromCallback), &sharedSnapshotToObj);
          }
        };
        attachMonitor("/etc/locale.conf", s.localeMonitorEtc, s.localeMonitorEtcSignalId);
        attachMonitor(
            "/etc/default/locale", s.localeMonitorDefault, s.localeMonitorDefaultSignalId);
        return jsi::Value::undefined();
      });

  // ─── Secure store (expo-secure-store) ────────────────────────────
  // Direct libsecret wrappers; all three ops synchronous and the JS
  // shim wraps in Promise.resolve. Throw on hard failure so the
  // shim rejects.

  bindMethod(rt,
             rnLinux,
             "secureStoreIsAvailable",
             0,
             [](jsi::Runtime& /*rt*/, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               return jsi::Value(rnlinux::securestore::isAvailable());
             });

  // The third arg on all three is the keychainService — expo's
  // per-app namespace inside the shared user keyring. Empty string
  // selects the default unscoped namespace.
  bindMethod(
      rt,
      rnLinux,
      "secureStoreSetItem",
      3,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        const std::string service =
            (count >= 3 && args[2].isString()) ? args[2].asString(rt).utf8(rt) : std::string{};
        try {
          rnlinux::securestore::setItem(
              args[0].asString(rt).utf8(rt), args[1].asString(rt).utf8(rt), service);
        } catch (const std::exception& e) {
          throw jsi::JSError(rt, e.what());
        }
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "secureStoreGetItem",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::null();
        const std::string service =
            (count >= 2 && args[1].isString()) ? args[1].asString(rt).utf8(rt) : std::string{};
        try {
          auto v = rnlinux::securestore::getItem(args[0].asString(rt).utf8(rt), service);
          if (!v)
            return jsi::Value::null();
          return jsi::String::createFromUtf8(rt, *v);
        } catch (const std::exception& e) {
          throw jsi::JSError(rt, e.what());
        }
      });

  bindMethod(
      rt,
      rnLinux,
      "secureStoreDeleteItem",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::undefined();
        const std::string service =
            (count >= 2 && args[1].isString()) ? args[1].asString(rt).utf8(rt) : std::string{};
        try {
          rnlinux::securestore::deleteItem(args[0].asString(rt).utf8(rt), service);
        } catch (const std::exception& e) {
          throw jsi::JSError(rt, e.what());
        }
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

  // fsDownload(url, dest, options, onProgress, onSuccess, onError)
  // — returns an opaque handle string the JS shim passes back to
  // fsDownloadCancel for resumable/pause flows.
  // options = {resumeFromBytes?: number}; onProgress is nullable.
  bindMethod(
      rt,
      rnLinux,
      "fsDownload",
      6,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 5)
          return jsi::Value::undefined();
        const auto url = args[0].asString(rt).utf8(rt);
        const auto dest = args[1].asString(rt).utf8(rt);
        rnlinux::filesystem::DownloadOptions opts;
        if (args[2].isObject()) {
          auto o = args[2].asObject(rt);
          if (o.hasProperty(rt, "resumeFromBytes")) {
            auto v = o.getProperty(rt, "resumeFromBytes");
            if (v.isNumber())
              opts.resumeFromBytes = static_cast<int64_t>(v.asNumber());
          }
        }
        auto progressCb = args[3].isObject() && args[3].asObject(rt).isFunction(rt)
                              ? std::make_shared<jsi::Function>(args[3].asObject(rt).asFunction(rt))
                              : std::shared_ptr<jsi::Function>{};
        auto okCb = std::make_shared<jsi::Function>(args[4].asObject(rt).asFunction(rt));
        auto errCb = count >= 6 && args[5].isObject() && args[5].asObject(rt).isFunction(rt)
                         ? std::make_shared<jsi::Function>(args[5].asObject(rt).asFunction(rt))
                         : std::shared_ptr<jsi::Function>{};
        const auto handle = rnlinux::filesystem::download(
            url,
            dest,
            opts,
            progressCb ? rnlinux::filesystem::DownloadProgress{[progressCb](int64_t written,
                                                                            int64_t total) {
              auto& s = state();
              if (!s.runtime)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                progressCb->call(jrt,
                                 jsi::Value(static_cast<double>(written)),
                                 jsi::Value(static_cast<double>(total)));
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.fs") << "download progress threw: " << e.what();
              }
            }}
                       : nullptr,
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
              if (!s.runtime || !errCb)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                errCb->call(jrt, jsi::String::createFromUtf8(jrt, msg));
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.fs") << "download err handler threw: " << e.what();
              }
            });
        return jsi::String::createFromUtf8(rt, handle);
      });

  bindMethod(
      rt,
      rnLinux,
      "fsDownloadCancel",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isString())
          return jsi::Value::undefined();
        rnlinux::filesystem::downloadCancel(args[0].asString(rt).utf8(rt));
        return jsi::Value::undefined();
      });

  // fsUploadMultipart(url, method, fields[], headers[], onSuccess, onError)
  // fields[i] = {name, isFile, textValue?, filePath?, filename?, mimeType?}
  // headers[i] = [name, value]
  bindMethod(
      rt,
      rnLinux,
      "fsUploadMultipart",
      6,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 5)
          return jsi::Value::undefined();
        const auto url = args[0].asString(rt).utf8(rt);
        const auto method = args[1].isString() ? args[1].asString(rt).utf8(rt) : std::string{};
        std::vector<rnlinux::filesystem::UploadField> fields;
        if (args[2].isObject() && args[2].asObject(rt).isArray(rt)) {
          auto arr = args[2].asObject(rt).asArray(rt);
          const size_t n = arr.size(rt);
          fields.reserve(n);
          for (size_t i = 0; i < n; ++i) {
            auto v = arr.getValueAtIndex(rt, i);
            if (!v.isObject())
              continue;
            auto o = v.asObject(rt);
            rnlinux::filesystem::UploadField f;
            if (o.hasProperty(rt, "name") && o.getProperty(rt, "name").isString())
              f.name = o.getProperty(rt, "name").asString(rt).utf8(rt);
            if (o.hasProperty(rt, "isFile") && o.getProperty(rt, "isFile").isBool())
              f.isFile = o.getProperty(rt, "isFile").getBool();
            if (o.hasProperty(rt, "textValue") && o.getProperty(rt, "textValue").isString())
              f.textValue = o.getProperty(rt, "textValue").asString(rt).utf8(rt);
            if (o.hasProperty(rt, "filePath") && o.getProperty(rt, "filePath").isString())
              f.filePath = o.getProperty(rt, "filePath").asString(rt).utf8(rt);
            if (o.hasProperty(rt, "filename") && o.getProperty(rt, "filename").isString())
              f.filename = o.getProperty(rt, "filename").asString(rt).utf8(rt);
            if (o.hasProperty(rt, "mimeType") && o.getProperty(rt, "mimeType").isString())
              f.mimeType = o.getProperty(rt, "mimeType").asString(rt).utf8(rt);
            fields.push_back(std::move(f));
          }
        }
        std::vector<std::pair<std::string, std::string>> headers;
        if (args[3].isObject() && args[3].asObject(rt).isArray(rt)) {
          auto arr = args[3].asObject(rt).asArray(rt);
          const size_t n = arr.size(rt);
          headers.reserve(n);
          for (size_t i = 0; i < n; ++i) {
            auto v = arr.getValueAtIndex(rt, i);
            if (!v.isObject() || !v.asObject(rt).isArray(rt))
              continue;
            auto pair = v.asObject(rt).asArray(rt);
            if (pair.size(rt) < 2)
              continue;
            const auto k = pair.getValueAtIndex(rt, 0);
            const auto val = pair.getValueAtIndex(rt, 1);
            if (k.isString() && val.isString())
              headers.emplace_back(k.asString(rt).utf8(rt), val.asString(rt).utf8(rt));
          }
        }
        auto okCb = std::make_shared<jsi::Function>(args[4].asObject(rt).asFunction(rt));
        auto errCb = count >= 6 && args[5].isObject() && args[5].asObject(rt).isFunction(rt)
                         ? std::make_shared<jsi::Function>(args[5].asObject(rt).asFunction(rt))
                         : std::shared_ptr<jsi::Function>{};
        rnlinux::filesystem::uploadMultipart(
            url,
            method,
            fields,
            headers,
            [okCb](int status, const std::string& body) {
              auto& s = state();
              if (!s.runtime)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                jsi::Object o(jrt);
                o.setProperty(jrt, "status", jsi::Value(status));
                o.setProperty(jrt, "body", jsi::String::createFromUtf8(jrt, body));
                okCb->call(jrt, o);
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.fs") << "upload ok handler threw: " << e.what();
              }
            },
            [errCb](const std::string& msg) {
              auto& s = state();
              if (!s.runtime || !errCb)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                errCb->call(jrt, jsi::String::createFromUtf8(jrt, msg));
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.fs") << "upload err handler threw: " << e.what();
              }
            });
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "fsUploadBinary",
      6,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 5)
          return jsi::Value::undefined();
        const auto url = args[0].asString(rt).utf8(rt);
        const auto method = args[1].isString() ? args[1].asString(rt).utf8(rt) : std::string{};
        const auto filePath = args[2].asString(rt).utf8(rt);
        const auto mimeType = args[3].isString() ? args[3].asString(rt).utf8(rt) : std::string{};
        std::vector<std::pair<std::string, std::string>> headers;
        if (args[4].isObject() && args[4].asObject(rt).isArray(rt)) {
          auto arr = args[4].asObject(rt).asArray(rt);
          for (size_t i = 0; i < arr.size(rt); ++i) {
            auto v = arr.getValueAtIndex(rt, i);
            if (!v.isObject() || !v.asObject(rt).isArray(rt))
              continue;
            auto pair = v.asObject(rt).asArray(rt);
            if (pair.size(rt) < 2)
              continue;
            const auto k = pair.getValueAtIndex(rt, 0);
            const auto val = pair.getValueAtIndex(rt, 1);
            if (k.isString() && val.isString())
              headers.emplace_back(k.asString(rt).utf8(rt), val.asString(rt).utf8(rt));
          }
        }
        auto okCb = std::make_shared<jsi::Function>(args[5].asObject(rt).asFunction(rt));
        auto errCb = count >= 7 && args[6].isObject() && args[6].asObject(rt).isFunction(rt)
                         ? std::make_shared<jsi::Function>(args[6].asObject(rt).asFunction(rt))
                         : std::shared_ptr<jsi::Function>{};
        rnlinux::filesystem::uploadBinary(
            url,
            method,
            filePath,
            mimeType,
            headers,
            [okCb](int status, const std::string& body) {
              auto& s = state();
              if (!s.runtime)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                jsi::Object o(jrt);
                o.setProperty(jrt, "status", jsi::Value(status));
                o.setProperty(jrt, "body", jsi::String::createFromUtf8(jrt, body));
                okCb->call(jrt, o);
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.fs") << "upload ok handler threw: " << e.what();
              }
            },
            [errCb](const std::string& msg) {
              auto& s = state();
              if (!s.runtime || !errCb)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                errCb->call(jrt, jsi::String::createFromUtf8(jrt, msg));
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.fs") << "upload err handler threw: " << e.what();
              }
            });
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "fsFreeDiskBytes",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        // No-arg form asks for the FS holding documentDirectory —
        // that's what an expo app actually wants when it calls
        // getFreeDiskStorageAsync().
        std::string path =
            (count >= 1 && args[0].isString()) ? args[0].asString(rt).utf8(rt) : std::string{"/"};
        return jsi::Value(static_cast<double>(rnlinux::filesystem::freeDiskBytes(path)));
      });

  bindMethod(
      rt,
      rnLinux,
      "fsTotalDiskBytes",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        std::string path =
            (count >= 1 && args[0].isString()) ? args[0].asString(rt).utf8(rt) : std::string{"/"};
        return jsi::Value(static_cast<double>(rnlinux::filesystem::totalDiskBytes(path)));
      });

  // ─── Notifications (expo-notifications) ─────────────────────────
  // Single response listener; replaces on each call. C++ stores the
  // jsi::Function shared_ptr so libnotify's closed-signal trampoline
  // can call into JS without needing to track per-notification state.

  // Optional 4th arg on present, 5th on schedule: categoryId.
  // When set, looks up actions registered via
  // rnLinux.notificationsSetCategory and attaches them as libnotify
  // action buttons.
  bindMethod(
      rt,
      rnLinux,
      "notificationsPresent",
      4,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 3)
          return jsi::Value(false);
        const auto id = args[0].asString(rt).utf8(rt);
        const auto title = args[1].asString(rt).utf8(rt);
        const auto body = args[2].asString(rt).utf8(rt);
        const auto category =
            count >= 4 && args[3].isString() ? args[3].asString(rt).utf8(rt) : std::string{};
        return jsi::Value(rnlinux::notifications::present(id, title, body, category));
      });

  bindMethod(
      rt,
      rnLinux,
      "notificationsSchedule",
      5,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 4)
          return jsi::Value(false);
        const auto id = args[0].asString(rt).utf8(rt);
        const int delayMs = static_cast<int>(args[1].asNumber());
        const auto title = args[2].asString(rt).utf8(rt);
        const auto body = args[3].asString(rt).utf8(rt);
        const auto category =
            count >= 5 && args[4].isString() ? args[4].asString(rt).utf8(rt) : std::string{};
        return jsi::Value(rnlinux::notifications::schedule(id, delayMs, title, body, category));
      });

  // setCategory(id, [{key, label}, ...]) — register action buttons
  // that get attached to any notification presented/scheduled with
  // this category id. Empty actions == clear.
  bindMethod(
      rt,
      rnLinux,
      "notificationsSetCategory",
      2,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value(false);
        const auto id = args[0].asString(rt).utf8(rt);
        std::vector<rnlinux::notifications::CategoryAction> actions;
        if (count >= 2 && args[1].isObject() && args[1].asObject(rt).isArray(rt)) {
          auto arr = args[1].asObject(rt).asArray(rt);
          const size_t n = arr.size(rt);
          actions.reserve(n);
          for (size_t i = 0; i < n; ++i) {
            auto v = arr.getValueAtIndex(rt, i);
            if (!v.isObject())
              continue;
            auto o = v.asObject(rt);
            std::string key;
            std::string label;
            if (o.hasProperty(rt, "key")) {
              auto k = o.getProperty(rt, "key");
              if (k.isString())
                key = k.asString(rt).utf8(rt);
            }
            if (o.hasProperty(rt, "label")) {
              auto l = o.getProperty(rt, "label");
              if (l.isString())
                label = l.asString(rt).utf8(rt);
            }
            if (!key.empty())
              actions.push_back({key, label.empty() ? key : label});
          }
        }
        rnlinux::notifications::setCategory(id, std::move(actions));
        return jsi::Value(true);
      });

  bindMethod(
      rt,
      rnLinux,
      "notificationsClearCategory",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::undefined();
        rnlinux::notifications::clearCategory(args[0].asString(rt).utf8(rt));
        return jsi::Value::undefined();
      });

  bindMethod(rt,
             rnLinux,
             "notificationsListCategories",
             0,
             [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               const auto ids = rnlinux::notifications::listCategoryIds();
               jsi::Array arr(rt, ids.size());
               for (size_t i = 0; i < ids.size(); ++i) {
                 jsi::Object o(rt);
                 o.setProperty(rt, "identifier", jsi::String::createFromUtf8(rt, ids[i]));
                 const auto actions = rnlinux::notifications::getCategoryActions(ids[i]);
                 jsi::Array actionsArr(rt, actions.size());
                 for (size_t j = 0; j < actions.size(); ++j) {
                   jsi::Object a(rt);
                   a.setProperty(rt, "key", jsi::String::createFromUtf8(rt, actions[j].key));
                   a.setProperty(rt, "label", jsi::String::createFromUtf8(rt, actions[j].label));
                   actionsArr.setValueAtIndex(rt, j, a);
                 }
                 o.setProperty(rt, "actions", actionsArr);
                 arr.setValueAtIndex(rt, i, o);
               }
               return arr;
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

  bindMethod(rt,
             rnLinux,
             "cameraDeviceCount",
             0,
             [](jsi::Runtime& /*rt*/, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               return jsi::Value(rnlinux::camera::v4l2CaptureDeviceCount());
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

  // expo-image's Image.clearDiskCache lands here. Wipes both the
  // in-memory SoupCache entries and the on-disk cache directory
  // (XDG_CACHE_HOME/rn-linux-playground/soup-image-cache).
  bindMethod(rt,
             rnLinux,
             "imageClearCache",
             0,
             [](jsi::Runtime& /*rt*/, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               rnlinux::clearImageCache();
               return jsi::Value(true);
             });

  bindMethod(rt,
             rnLinux,
             "imageCacheDir",
             0,
             [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               return jsi::String::createFromUtf8(rt, rnlinux::imageCacheDir());
             });

  // Reads only the image header via gdk_pixbuf_get_file_info, so
  // it stays cheap on multi-MB images. The JS shim wraps it so
  // expo-image's `useImage` and `Image.getSize` can resolve
  // {width, height} without loading the full pixels. Returns
  // {width: 0, height: 0} when the path doesn't exist or the
  // format isn't recognized.
  bindMethod(
      rt,
      rnLinux,
      "imageGetFileSize",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        jsi::Object out(rt);
        out.setProperty(rt, "width", jsi::Value(0));
        out.setProperty(rt, "height", jsi::Value(0));
        if (count < 1 || !args[0].isString())
          return out;
        const std::string path = args[0].asString(rt).utf8(rt);
        int w = 0;
        int h = 0;
        if (gdk_pixbuf_get_file_info(path.c_str(), &w, &h)) {
          out.setProperty(rt, "width", jsi::Value(w));
          out.setProperty(rt, "height", jsi::Value(h));
        }
        return out;
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

  // ─── Print (expo-print) ──────────────────────────────────────────
  // GtkPrintOperation for the dialog path, cairo PDF surface for
  // printToFile. Both render via Pango — HTML input is stripped to
  // plaintext on the JS side (full HTML rendering would need
  // WebKitGTK, see docs/realworld-expo-print.md).

  // Build a LayoutOptions from a JS opts object. Missing keys keep
  // the defaults from the struct (Sans 11pt, 50pt margin, portrait).
  auto layoutFromObj = [](jsi::Runtime& rt, const jsi::Value& v) -> rnlinux::print::LayoutOptions {
    rnlinux::print::LayoutOptions out;
    if (!v.isObject())
      return out;
    auto o = v.asObject(rt);
    if (o.hasProperty(rt, "fontFamily")) {
      auto p = o.getProperty(rt, "fontFamily");
      if (p.isString())
        out.fontFamily = p.asString(rt).utf8(rt);
    }
    if (o.hasProperty(rt, "fontPointSize")) {
      auto p = o.getProperty(rt, "fontPointSize");
      if (p.isNumber())
        out.fontPointSize = static_cast<int>(p.asNumber());
    }
    if (o.hasProperty(rt, "marginPts")) {
      auto p = o.getProperty(rt, "marginPts");
      if (p.isNumber())
        out.marginPts = p.asNumber();
    }
    if (o.hasProperty(rt, "landscape")) {
      auto p = o.getProperty(rt, "landscape");
      if (p.isBool())
        out.landscape = p.getBool();
    }
    return out;
  };

  bindMethod(
      rt,
      rnLinux,
      "printText",
      4,
      [layoutFromObj](
          jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::undefined();
        const auto text = args[0].asString(rt).utf8(rt);
        const auto layout =
            count >= 2 ? layoutFromObj(rt, args[1]) : rnlinux::print::LayoutOptions{};
        auto okCb = count >= 3 && args[2].isObject() && args[2].asObject(rt).isFunction(rt)
                        ? std::make_shared<jsi::Function>(args[2].asObject(rt).asFunction(rt))
                        : nullptr;
        auto errCb = count >= 4 && args[3].isObject() && args[3].asObject(rt).isFunction(rt)
                         ? std::make_shared<jsi::Function>(args[3].asObject(rt).asFunction(rt))
                         : nullptr;
        GtkWidget* parent = state().rootView;
        rnlinux::print::printText(
            parent,
            text,
            layout,
            [okCb]() {
              auto& s = state();
              if (!s.runtime || !okCb)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                okCb->call(jrt);
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.print") << "ok handler threw: " << e.what();
              }
            },
            [errCb](const std::string& msg) {
              auto& s = state();
              if (!s.runtime || !errCb)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                errCb->call(jrt, jsi::String::createFromUtf8(jrt, msg));
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.print") << "err handler threw: " << e.what();
              }
            });
        return jsi::Value::undefined();
      });

  bindMethod(
      rt,
      rnLinux,
      "printExportPdf",
      5,
      [layoutFromObj](
          jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2)
          return jsi::Value::undefined();
        const auto text = args[0].asString(rt).utf8(rt);
        const auto outPath = args[1].asString(rt).utf8(rt);
        const auto layout =
            count >= 3 ? layoutFromObj(rt, args[2]) : rnlinux::print::LayoutOptions{};
        auto okCb = count >= 4 && args[3].isObject() && args[3].asObject(rt).isFunction(rt)
                        ? std::make_shared<jsi::Function>(args[3].asObject(rt).asFunction(rt))
                        : nullptr;
        auto errCb = count >= 5 && args[4].isObject() && args[4].asObject(rt).isFunction(rt)
                         ? std::make_shared<jsi::Function>(args[4].asObject(rt).asFunction(rt))
                         : nullptr;
        rnlinux::print::exportToPdf(
            text,
            outPath,
            layout,
            [okCb, outPath](int pageCount) {
              auto& s = state();
              if (!s.runtime || !okCb)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                // Two-arg call: (uri, numberOfPages). The JS shim
                // resolves the printToFileAsync promise with both
                // so callers get expo-print's documented shape.
                okCb->call(jrt,
                           jsi::String::createFromUtf8(jrt, "file://" + outPath),
                           jsi::Value(pageCount));
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.print") << "ok handler threw: " << e.what();
              }
            },
            [errCb](const std::string& msg) {
              auto& s = state();
              if (!s.runtime || !errCb)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                errCb->call(jrt, jsi::String::createFromUtf8(jrt, msg));
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.print") << "err handler threw: " << e.what();
              }
            });
        return jsi::Value::undefined();
      });

  // ─── File picker (expo-document-picker / expo-image-picker) ──────
  // GtkFileDialog-backed. opts is {title, mimeFilters[], multiple};
  // callbacks fire on the main loop with picked paths or cancel/
  // error.

  bindMethod(
      rt,
      rnLinux,
      "pickFiles",
      3,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 2 || !args[0].isObject())
          return jsi::Value::undefined();
        rnlinux::filepicker::PickOptions opts;
        auto optObj = args[0].asObject(rt);
        if (optObj.hasProperty(rt, "title"))
          opts.title = optObj.getProperty(rt, "title").asString(rt).utf8(rt);
        if (optObj.hasProperty(rt, "multiple") && optObj.getProperty(rt, "multiple").isBool())
          opts.multiple = optObj.getProperty(rt, "multiple").getBool();
        if (optObj.hasProperty(rt, "mimeFilters")) {
          auto v = optObj.getProperty(rt, "mimeFilters");
          if (v.isObject() && v.asObject(rt).isArray(rt)) {
            auto arr = v.asObject(rt).asArray(rt);
            const size_t n = arr.size(rt);
            for (size_t i = 0; i < n; ++i) {
              auto el = arr.getValueAtIndex(rt, i);
              if (el.isString())
                opts.mimeFilters.push_back(el.asString(rt).utf8(rt));
            }
          }
        }
        auto okCb = std::make_shared<jsi::Function>(args[1].asObject(rt).asFunction(rt));
        auto errCb = count >= 3 && args[2].isObject() && args[2].asObject(rt).isFunction(rt)
                         ? std::make_shared<jsi::Function>(args[2].asObject(rt).asFunction(rt))
                         : nullptr;
        GtkWidget* parent = state().rootView;
        rnlinux::filepicker::pickFiles(
            parent,
            opts,
            [okCb](const std::vector<rnlinux::filepicker::PickedFile>& picked) {
              auto& s = state();
              if (!s.runtime)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                jsi::Array arr(jrt, picked.size());
                for (size_t i = 0; i < picked.size(); ++i) {
                  jsi::Object o(jrt);
                  o.setProperty(jrt, "path", jsi::String::createFromUtf8(jrt, picked[i].path));
                  o.setProperty(jrt, "name", jsi::String::createFromUtf8(jrt, picked[i].name));
                  o.setProperty(jrt, "size", jsi::Value(static_cast<double>(picked[i].size)));
                  o.setProperty(
                      jrt, "mimeType", jsi::String::createFromUtf8(jrt, picked[i].mimeType));
                  // width / height come from gdk-pixbuf (images) or
                  // GstDiscoverer (videos); durationMs from
                  // GstDiscoverer (videos). The JS shims map 0 →
                  // null so expo's contract holds for non-media
                  // picks.
                  o.setProperty(jrt, "width", jsi::Value(picked[i].width));
                  o.setProperty(jrt, "height", jsi::Value(picked[i].height));
                  o.setProperty(
                      jrt, "durationMs", jsi::Value(static_cast<double>(picked[i].durationMs)));
                  arr.setValueAtIndex(jrt, i, o);
                }
                jsi::Object result(jrt);
                result.setProperty(jrt, "canceled", jsi::Value(false));
                result.setProperty(jrt, "assets", arr);
                okCb->call(jrt, result);
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.filepicker") << "ok handler threw: " << e.what();
              }
            },
            [okCb]() {
              auto& s = state();
              if (!s.runtime)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                jsi::Object result(jrt);
                result.setProperty(jrt, "canceled", jsi::Value(true));
                okCb->call(jrt, result);
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.filepicker") << "cancel handler threw: " << e.what();
              }
            },
            [errCb](const std::string& msg) {
              auto& s = state();
              if (!s.runtime || !errCb)
                return;
              jsi::Runtime& jrt = *s.runtime;
              try {
                errCb->call(jrt, jsi::String::createFromUtf8(jrt, msg));
                jrt.drainMicrotasks();
              } catch (const std::exception& e) {
                RNL_LOGE("rnLinux.filepicker") << "err handler threw: " << e.what();
              }
            });
        return jsi::Value::undefined();
      });

  // ─── Network (expo-network) ──────────────────────────────────────
  // Synchronous snapshot from GNetworkMonitor + /sys/class/net.
  // networkState + networkSetStateListener. The state snapshot is
  // sync; the listener subscribes to GNetworkMonitor::network-changed
  // and re-emits the snapshot on the next idle tick.

  // Materialize one NetworkState into a JS object. Used by both the
  // sync getter and the listener trampoline below.
  auto stateToJs = [](jsi::Runtime& rt, const rnlinux::network::NetworkState& s) {
    jsi::Object o(rt);
    o.setProperty(
        rt, "type", jsi::String::createFromUtf8(rt, rnlinux::network::typeString(s.type)));
    o.setProperty(rt, "isConnected", jsi::Value(s.isConnected));
    o.setProperty(rt, "isInternetReachable", jsi::Value(s.isInternetReachable));
    o.setProperty(rt, "ipAddress", jsi::String::createFromUtf8(rt, s.ipAddress));
    o.setProperty(rt, "macAddress", jsi::String::createFromUtf8(rt, s.macAddress));
    o.setProperty(rt, "interfaceName", jsi::String::createFromUtf8(rt, s.interfaceName));
    return o;
  };

  bindMethod(
      rt,
      rnLinux,
      "networkState",
      0,
      [stateToJs](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
        return stateToJs(rt, rnlinux::network::getState());
      });

  bindMethod(rt,
             rnLinux,
             "networkAirplaneMode",
             0,
             [](jsi::Runtime& /*rt*/, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               return jsi::Value(rnlinux::network::isAirplaneModeEnabled());
             });

  bindMethod(rt,
             rnLinux,
             "networkInterfaces",
             0,
             [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               const auto list = rnlinux::network::listInterfaces();
               jsi::Array arr(rt, list.size());
               for (size_t i = 0; i < list.size(); ++i) {
                 jsi::Object o(rt);
                 o.setProperty(rt, "name", jsi::String::createFromUtf8(rt, list[i].name));
                 o.setProperty(
                     rt,
                     "type",
                     jsi::String::createFromUtf8(rt, rnlinux::network::typeString(list[i].type)));
                 o.setProperty(rt, "isUp", jsi::Value(list[i].isUp));
                 o.setProperty(rt, "ipv4", jsi::String::createFromUtf8(rt, list[i].ipv4));
                 o.setProperty(rt, "ipv6", jsi::String::createFromUtf8(rt, list[i].ipv6));
                 o.setProperty(
                     rt, "macAddress", jsi::String::createFromUtf8(rt, list[i].macAddress));
                 arr.setValueAtIndex(rt, i, o);
               }
               return arr;
             });

  bindMethod(rt,
             rnLinux,
             "networkSetStateListener",
             1,
             [stateToJs](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count)
                 -> jsi::Value {
               if (count < 1 || args[0].isNull() || args[0].isUndefined()) {
                 rnlinux::network::setStateListener(nullptr);
                 return jsi::Value::undefined();
               }
               auto fn = std::make_shared<jsi::Function>(args[0].asObject(rt).asFunction(rt));
               rnlinux::network::setStateListener(
                   [fn, stateToJs](const rnlinux::network::NetworkState& s) {
                     auto& st = state();
                     if (!st.runtime)
                       return;
                     jsi::Runtime& jrt = *st.runtime;
                     try {
                       fn->call(jrt, stateToJs(jrt, s));
                       jrt.drainMicrotasks();
                     } catch (const std::exception& e) {
                       RNL_LOGE("rnLinux.network") << "state listener threw: " << e.what();
                     }
                   });
               return jsi::Value::undefined();
             });

  // ─── Keep awake (expo-keep-awake) ────────────────────────────────
  // Wraps systemd-logind's Manager.Inhibit. Tag-keyed so multiple
  // overlapping inhibitors (one per active route, component, …)
  // can release independently.

  bindMethod(rt,
             rnLinux,
             "keepAwakeIsAvailable",
             0,
             [](jsi::Runtime& /*rt*/, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               return jsi::Value(rnlinux::keepawake::isAvailable());
             });

  // Optional 3rd / 4th args: `who` (string shown in
  // `systemd-inhibit --list`) and `mode` ("block" | "delay").
  bindMethod(
      rt,
      rnLinux,
      "keepAwakeActivate",
      4,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value(false);
        const auto tag = args[0].asString(rt).utf8(rt);
        const auto reason =
            count >= 2 && args[1].isString() ? args[1].asString(rt).utf8(rt) : std::string{};
        const auto who =
            count >= 3 && args[2].isString() ? args[2].asString(rt).utf8(rt) : std::string{};
        const auto mode =
            count >= 4 && args[3].isString() ? args[3].asString(rt).utf8(rt) : std::string{};
        return jsi::Value(rnlinux::keepawake::activate(tag, reason, who, mode));
      });

  bindMethod(
      rt,
      rnLinux,
      "keepAwakeDeactivate",
      1,
      [](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1)
          return jsi::Value::undefined();
        rnlinux::keepawake::deactivate(args[0].asString(rt).utf8(rt));
        return jsi::Value::undefined();
      });

  // ─── Haptics / bell (expo-haptics) ───────────────────────────────
  // GTK has no haptics. gdk_display_beep is the closest analog —
  // the display server's bell, routed by the WM / sound theme.
  // Silent in the Lima VM (no audio sink wired) but real on
  // hardware. The JS shim wraps every impactAsync /
  // notificationAsync / selectionAsync call through this one beep.
  bindMethod(rt,
             rnLinux,
             "haptic",
             0,
             [](jsi::Runtime& /*rt*/, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
               GdkDisplay* d = gdk_display_get_default();
               if (d)
                 gdk_display_beep(d);
               return jsi::Value::undefined();
             });

#ifdef RNL_FS_HAVE_SOUP
  // ──────────────────────────────────────────────────────────────
  // rnLinux.fetch(url, method, headersObj, body, onResult, onError)
  //
  // Backs globalThis.fetch (installed JS-side in runtime/shims.js).
  // libsoup-3 handles HTTP(S) including the bsky.social / plc.directory
  // calls atproto handle-resolution needs. Without this, every
  // PDS-detection call returned null and akari's sign-in surfaced
  // "Could not detect PDS server for this handle".
  //
  // The callback runs on the GLib main loop; we capture onResult /
  // onError as shared_ptr<jsi::Function> and check state().runtime is
  // still live before calling — guards against a JS reload mid-flight.
  //
  // Body is passed as a UTF-8 string today. Binary payloads would need
  // an ArrayBuffer round-trip; the akari PDS calls are all GET/JSON
  // so we defer that.
  struct FetchCtx {
    std::shared_ptr<jsi::Function> onResult;
    std::shared_ptr<jsi::Function> onError;
    std::string url;
  };
  // Pre-bundle the response into a thread-safe POD on the main /
  // libsoup thread, then post the JSI work onto the JS worker.
  // Building jsi::Object on the libsoup callback's thread would trap
  // Hermes' pthread-binding guard — every member of the response
  // (status, headers, body bytes) has to be flattened to plain C++
  // types before crossing the queue boundary.
  struct FetchResponsePayload {
    bool ok = false;
    std::string errorMessage;
    guint status = 0;
    std::string statusText;
    std::string finalUrl;
    std::vector<std::pair<std::string, std::string>> headers;
    std::string body;
  };
  auto onFetchDone = +[](GObject* source, GAsyncResult* res, gpointer user) {
    std::unique_ptr<FetchCtx> ctx(static_cast<FetchCtx*>(user));
    SoupMessage* msg = soup_session_get_async_result_message(SOUP_SESSION(source), res);
    GError* err = nullptr;
    GBytes* bytes = soup_session_send_and_read_finish(SOUP_SESSION(source), res, &err);

    auto payload = std::make_shared<FetchResponsePayload>();
    if (!bytes) {
      payload->ok = false;
      payload->errorMessage = err ? err->message : "network error";
      if (err)
        g_error_free(err);
    } else {
      payload->ok = true;
      gsize len = 0;
      const void* data = g_bytes_get_data(bytes, &len);
      payload->body.assign(static_cast<const char*>(data), len);
      payload->status = msg ? soup_message_get_status(msg) : 0;
      if (msg) {
        const char* reason = soup_message_get_reason_phrase(msg);
        if (reason)
          payload->statusText = reason;
        GUri* uri = soup_message_get_uri(msg);
        char* finalUri = uri ? g_uri_to_string(uri) : nullptr;
        if (finalUri) {
          payload->finalUrl = finalUri;
          g_free(finalUri);
        }
      }
      if (payload->finalUrl.empty())
        payload->finalUrl = ctx->url;
      SoupMessageHeaders* mh = msg ? soup_message_get_response_headers(msg) : nullptr;
      if (mh) {
        SoupMessageHeadersIter it;
        soup_message_headers_iter_init(&it, mh);
        const char* name = nullptr;
        const char* value = nullptr;
        while (soup_message_headers_iter_next(&it, &name, &value)) {
          std::string key = name ? name : "";
          for (auto& c : key)
            c = static_cast<char>(g_ascii_tolower(c));
          payload->headers.emplace_back(std::move(key), value ? value : "");
        }
      }
      g_bytes_unref(bytes);
    }

    auto& s = state();
    if (!s.executor) {
      // Executor not yet set (start-up race) — silently drop the
      // response. The corresponding fetch promise will reject via
      // its own timeout / abort path.
      return;
    }
    // Move ctx (jsi::Function refs) into the lambda so the worker
    // thread owns them when it dereferences the callbacks. Once the
    // lambda runs, ctx is destroyed on the worker, which is the
    // right thread to release jsi::Function.
    s.executor(
        [ctx = std::shared_ptr<FetchCtx>(std::move(ctx)), payload](jsi::Runtime& rt) mutable {
          try {
            if (!payload->ok) {
              if (ctx->onError) {
                ctx->onError->call(rt, jsi::String::createFromUtf8(rt, payload->errorMessage));
              }
              return;
            }

            jsi::Object headers = jsi::Object(rt);
            for (const auto& [key, value] : payload->headers) {
              headers.setProperty(rt, key.c_str(), jsi::String::createFromUtf8(rt, value));
            }

            jsi::Object out(rt);
            out.setProperty(rt, "status", jsi::Value(static_cast<int>(payload->status)));
            out.setProperty(rt, "statusText", jsi::String::createFromUtf8(rt, payload->statusText));
            out.setProperty(rt, "url", jsi::String::createFromUtf8(rt, payload->finalUrl));
            out.setProperty(rt, "headers", headers);
            out.setProperty(rt, "body", jsi::String::createFromUtf8(rt, payload->body));
            if (ctx->onResult)
              ctx->onResult->call(rt, std::move(out));

            rt.drainMicrotasks();
          } catch (const std::exception& e) {
            RNL_LOGW("rnLinux") << "fetch trampoline threw: " << e.what();
          }
        });
  };

  bindMethod(
      rt,
      rnLinux,
      "fetch",
      6,
      [onFetchDone](
          jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isString())
          return jsi::Value::undefined();
        const auto url = args[0].asString(rt).utf8(rt);
        const auto method =
            (count >= 2 && args[1].isString()) ? args[1].asString(rt).utf8(rt) : std::string{"GET"};
        SoupMessage* msg = soup_message_new(method.c_str(), url.c_str());
        if (!msg) {
          if (count >= 6 && args[5].isObject() && args[5].asObject(rt).isFunction(rt)) {
            args[5].asObject(rt).asFunction(rt).call(
                rt, jsi::String::createFromUtf8(rt, "soup_message_new failed (bad URL?)"));
          }
          return jsi::Value::undefined();
        }

        // Pull content-type out of the JS headers FIRST so we can pass
        // it directly to soup_message_set_request_body_from_bytes —
        // appending it via soup_message_headers_append before setting
        // the body caused the bsky XRPC server to reply "request
        // encoding Content-Type required but not provided" (libsoup3's
        // set_request_body_from_bytes was clearing the value we'd
        // already appended). Everything else passes through unchanged.
        std::string contentType;
        if (count >= 3 && args[2].isObject()) {
          auto headers = args[2].asObject(rt);
          auto names = headers.getPropertyNames(rt);
          const size_t n = names.size(rt);
          SoupMessageHeaders* mh = soup_message_get_request_headers(msg);
          for (size_t i = 0; i < n; ++i) {
            auto k = names.getValueAtIndex(rt, i).asString(rt).utf8(rt);
            auto v = headers.getProperty(rt, k.c_str()).toString(rt).utf8(rt);
            if (g_ascii_strcasecmp(k.c_str(), "content-type") == 0) {
              contentType = v;
              continue;
            }
            soup_message_headers_append(mh, k.c_str(), v.c_str());
          }
        }

        // Body — UTF-8 string. set_request_body_from_bytes is the only
        // libsoup3 API that publishes both the bytes and Content-Type
        // atomically; passing the value via this call rather than
        // appending via the header loop avoids the "header lost on
        // body attach" footgun.
        if (count >= 4 && args[3].isString()) {
          auto body = args[3].asString(rt).utf8(rt);
          GBytes* gb = g_bytes_new(body.data(), body.size());
          soup_message_set_request_body_from_bytes(
              msg, contentType.empty() ? "text/plain" : contentType.c_str(), gb);
          g_bytes_unref(gb);
        } else if (!contentType.empty()) {
          // Body-less request that still carries a Content-Type (rare —
          // e.g. some bearer-only POSTs). Append now.
          soup_message_headers_append(
              soup_message_get_request_headers(msg), "Content-Type", contentType.c_str());
        }

        auto ctx = std::make_unique<FetchCtx>();
        ctx->url = url;
        if (count >= 5 && args[4].isObject() && args[4].asObject(rt).isFunction(rt))
          ctx->onResult = std::make_shared<jsi::Function>(args[4].asObject(rt).asFunction(rt));
        if (count >= 6 && args[5].isObject() && args[5].asObject(rt).isFunction(rt))
          ctx->onError = std::make_shared<jsi::Function>(args[5].asObject(rt).asFunction(rt));

        static SoupSession* session = soup_session_new();
        soup_session_send_and_read_async(
            session, msg, G_PRIORITY_DEFAULT, nullptr, onFetchDone, ctx.release());
        g_object_unref(msg);
        return jsi::Value::undefined();
      });
#endif // RNL_FS_HAVE_SOUP

  rt.global().setProperty(rt, "rnLinux", rnLinux);
  RNL_LOGI("rnLinux") << "JSI bindings installed";
}

} // namespace rnlinux
