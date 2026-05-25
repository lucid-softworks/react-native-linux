#pragma once

#include <functional>
#include <string>

typedef struct _GtkWidget GtkWidget;

namespace facebook::jsi {
class Runtime;
}

namespace rnlinux {

// Install `globalThis.rnLinux` on the given JSI runtime. The bindings let a
// JS bundle (running on this runtime) construct and manipulate GTK widgets
// directly — the "JSI bridge" lightning path that gets React onto the
// screen without Fabric.
//
// API surface from JS:
//
//   const id  = rnLinux.createLabel();          // → number node id
//   const id  = rnLinux.createBox();
//   rnLinux.setText(id, "hello");
//   rnLinux.setBounds(id, x, y, w, h);
//   rnLinux.setBackgroundColor(id, "#RRGGBB");
//   rnLinux.appendChild(parentId, childId);
//   rnLinux.removeChild(parentId, childId);
//   rnLinux.setRoot(id);                         // attach as the window's tree root
//   rnLinux.log("info"|"warn"|"error", "msg…");
//
// All ops must run on the GTK main thread. For our single-threaded MVP
// (host evaluates JS on the same thread that runs the GTK main loop)
// this is naturally satisfied; future JS-thread work will route through
// g_idle_add.
void installRnLinuxBindings(facebook::jsi::Runtime& rt, GtkWidget* rootView);

// Hand the bindings a back-pointer to the Fabric mount registry so JS
// can look up widgets by tag. This is what `rnLinux.setNativeProp`
// uses to drive Animated.View directly from JS, bypassing the
// React → reconcile → Fabric commit → mount path each frame.
//
// Pass a function rather than a pointer to a class so we can keep the
// LinuxComponentView header out of this one (the JSI bindings .cpp is
// already a heavy include site).
void setFabricWidgetLookupForJsi(std::function<GtkWidget*(int tag)> lookup);

// Maintains a global nativeId-string → widget map for the Animated
// native driver. ViewComponentView calls these from its updateProps as
// the View's nativeID prop changes. JS-side animated.js generates
// unique nativeIds per Animated.* component and uses them as the
// first arg to rnLinux.setNativeProp.
void registerAnimWidget(const std::string& nativeId, GtkWidget* widget);
void unregisterAnimWidget(const std::string& nativeId);

// Drop everything we hold onto the current runtime (jsi::Function click
// handlers, the runtime pointer itself). Must be called by the host on
// reload() *before* the runtime is destroyed — otherwise the destructors
// of the stored jsi::Function objects dereference a dead runtime and we
// crash inside std::unordered_map::clear().
void resetRnLinuxBindings();

// Dispatch a "click" event to a Fabric-tag handler the app registered
// via `rnLinux.fabricOnClick(tag, fn)`. Called by the Linux component-
// view layer (e.g. ViewComponentView's gesture controller). Safe to
// call from the GTK main thread; the call into the runtime drains
// microtasks so any setState scheduled inside fires its commit before
// returning.
void dispatchFabricClick(int tag);

// Same shape, for text-input "changed" events. The string is passed
// as the first argument to the JS handler registered via
// `rnLinux.fabricOnChangeText(tag, fn)`.
void dispatchFabricChangeText(int tag, const std::string& text);

// Dispatch a scroll event for the given tag. Args mirror RN's
// nativeEvent.contentOffset + layoutMeasurement so JS can pluck the
// values it needs. Called by ScrollViewComponentView from the
// GtkAdjustment value-changed signal.
void dispatchFabricScroll(int tag,
                          double offsetX,
                          double offsetY,
                          double contentWidth,
                          double contentHeight,
                          double viewportWidth,
                          double viewportHeight);

} // namespace rnlinux
