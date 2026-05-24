#pragma once

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

}  // namespace rnlinux
