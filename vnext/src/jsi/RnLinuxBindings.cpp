#include "RnLinuxBindings.h"
#include "react-native-linux/Logging.h"

#include <gtk/gtk.h>
#include <jsi/jsi.h>

#include <atomic>
#include <cstdio>
#include <string>
#include <unordered_map>

namespace rnlinux {

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

void installRnLinuxBindings(jsi::Runtime& rt, GtkWidget* rootView) {
  state().rootView = rootView;

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

  rt.global().setProperty(rt, "rnLinux", rnLinux);
  RNL_LOGI("rnLinux") << "JSI bindings installed";
}

}  // namespace rnlinux
