#include "TintedPaintable.h"

#include <graphene.h>

struct _RnLinuxTintedPaintable {
  GObject parent_instance;
  GdkPaintable* source;
  GdkRGBA tint;
  gulong invalidate_contents_id;
  gulong invalidate_size_id;
};

static void rn_linux_tinted_paintable_iface_init(GdkPaintableInterface* iface);

G_DEFINE_FINAL_TYPE_WITH_CODE(RnLinuxTintedPaintable,
                              rn_linux_tinted_paintable,
                              G_TYPE_OBJECT,
                              G_IMPLEMENT_INTERFACE(GDK_TYPE_PAINTABLE,
                                                    rn_linux_tinted_paintable_iface_init))

static void disconnect_source(RnLinuxTintedPaintable* self) {
  if (!self->source)
    return;
  if (self->invalidate_contents_id) {
    g_signal_handler_disconnect(self->source, self->invalidate_contents_id);
    self->invalidate_contents_id = 0;
  }
  if (self->invalidate_size_id) {
    g_signal_handler_disconnect(self->source, self->invalidate_size_id);
    self->invalidate_size_id = 0;
  }
}

static void on_source_invalidate_contents(GdkPaintable* /*source*/, gpointer user_data) {
  gdk_paintable_invalidate_contents(GDK_PAINTABLE(user_data));
}

static void on_source_invalidate_size(GdkPaintable* /*source*/, gpointer user_data) {
  gdk_paintable_invalidate_size(GDK_PAINTABLE(user_data));
}

static void connect_source(RnLinuxTintedPaintable* self) {
  if (!self->source)
    return;
  self->invalidate_contents_id = g_signal_connect(
      self->source, "invalidate-contents", G_CALLBACK(on_source_invalidate_contents), self);
  self->invalidate_size_id = g_signal_connect(
      self->source, "invalidate-size", G_CALLBACK(on_source_invalidate_size), self);
}

static void rn_linux_tinted_paintable_dispose(GObject* object) {
  RnLinuxTintedPaintable* self = RN_LINUX_TINTED_PAINTABLE(object);
  disconnect_source(self);
  g_clear_object(&self->source);
  G_OBJECT_CLASS(rn_linux_tinted_paintable_parent_class)->dispose(object);
}

static void rn_linux_tinted_paintable_class_init(RnLinuxTintedPaintableClass* klass) {
  GObjectClass* object_class = G_OBJECT_CLASS(klass);
  object_class->dispose = rn_linux_tinted_paintable_dispose;
}

static void rn_linux_tinted_paintable_init(RnLinuxTintedPaintable* self) {
  self->source = nullptr;
  self->tint = {0, 0, 0, 0};
  self->invalidate_contents_id = 0;
  self->invalidate_size_id = 0;
}

// ─── GdkPaintable interface ─────────────────────────────────────────

static void
snapshot_impl(GdkPaintable* paintable, GdkSnapshot* snapshot, double width, double height) {
  RnLinuxTintedPaintable* self = RN_LINUX_TINTED_PAINTABLE(paintable);
  if (!self->source)
    return;

  // GSK color-matrix: out = matrix * in + offset, with vec4(r,g,b,a).
  // graphene matrices are column-major: values[col*4 + row]. To turn a
  // grayscale-alpha mask into a flat tint we want
  //   out.rgba = (in.a*tint.r, in.a*tint.g, in.a*tint.b, in.a*tint.a)
  // i.e. zero columns for in.r/g/b and the alpha column carries the
  // tint. tint.a multiplies into the output alpha — usually 1.0, but
  // lets `rgba(…, .5)` darken/fade the tint correctly.
  const float values[16] = {
      0.0f,
      0.0f,
      0.0f,
      0.0f,
      0.0f,
      0.0f,
      0.0f,
      0.0f,
      0.0f,
      0.0f,
      0.0f,
      0.0f,
      self->tint.red,
      self->tint.green,
      self->tint.blue,
      self->tint.alpha,
  };
  graphene_matrix_t matrix;
  graphene_matrix_init_from_float(&matrix, values);
  graphene_vec4_t offset;
  graphene_vec4_init(&offset, 0.0f, 0.0f, 0.0f, 0.0f);

  GtkSnapshot* gtk_snap = GTK_SNAPSHOT(snapshot);
  gtk_snapshot_push_color_matrix(gtk_snap, &matrix, &offset);
  gdk_paintable_snapshot(self->source, snapshot, width, height);
  gtk_snapshot_pop(gtk_snap);
}

static int get_intrinsic_width_impl(GdkPaintable* paintable) {
  RnLinuxTintedPaintable* self = RN_LINUX_TINTED_PAINTABLE(paintable);
  return self->source ? gdk_paintable_get_intrinsic_width(self->source) : 0;
}

static int get_intrinsic_height_impl(GdkPaintable* paintable) {
  RnLinuxTintedPaintable* self = RN_LINUX_TINTED_PAINTABLE(paintable);
  return self->source ? gdk_paintable_get_intrinsic_height(self->source) : 0;
}

static double get_intrinsic_aspect_ratio_impl(GdkPaintable* paintable) {
  RnLinuxTintedPaintable* self = RN_LINUX_TINTED_PAINTABLE(paintable);
  return self->source ? gdk_paintable_get_intrinsic_aspect_ratio(self->source) : 0.0;
}

static GdkPaintableFlags get_flags_impl(GdkPaintable* paintable) {
  RnLinuxTintedPaintable* self = RN_LINUX_TINTED_PAINTABLE(paintable);
  return self->source ? gdk_paintable_get_flags(self->source) : (GdkPaintableFlags)0;
}

static void rn_linux_tinted_paintable_iface_init(GdkPaintableInterface* iface) {
  iface->snapshot = snapshot_impl;
  iface->get_intrinsic_width = get_intrinsic_width_impl;
  iface->get_intrinsic_height = get_intrinsic_height_impl;
  iface->get_intrinsic_aspect_ratio = get_intrinsic_aspect_ratio_impl;
  iface->get_flags = get_flags_impl;
}

// ─── Public API ─────────────────────────────────────────────────────

GdkPaintable* rn_linux_tinted_paintable_new(GdkPaintable* source, const GdkRGBA* rgba) {
  auto* self = RN_LINUX_TINTED_PAINTABLE(g_object_new(RN_LINUX_TYPE_TINTED_PAINTABLE, nullptr));
  if (rgba)
    self->tint = *rgba;
  rn_linux_tinted_paintable_set_source(self, source);
  return GDK_PAINTABLE(self);
}

void rn_linux_tinted_paintable_set_source(RnLinuxTintedPaintable* self, GdkPaintable* source) {
  g_return_if_fail(RN_LINUX_IS_TINTED_PAINTABLE(self));
  if (self->source == source)
    return;
  disconnect_source(self);
  g_clear_object(&self->source);
  if (source) {
    self->source = GDK_PAINTABLE(g_object_ref(source));
    connect_source(self);
  }
  // Source swap is both a contents and a size invalidation: the new
  // paintable can have entirely different intrinsic dimensions.
  gdk_paintable_invalidate_size(GDK_PAINTABLE(self));
  gdk_paintable_invalidate_contents(GDK_PAINTABLE(self));
}

void rn_linux_tinted_paintable_set_tint(RnLinuxTintedPaintable* self, const GdkRGBA* rgba) {
  g_return_if_fail(RN_LINUX_IS_TINTED_PAINTABLE(self));
  if (!rgba)
    return;
  if (gdk_rgba_equal(&self->tint, rgba))
    return;
  self->tint = *rgba;
  gdk_paintable_invalidate_contents(GDK_PAINTABLE(self));
}

const GdkRGBA* rn_linux_tinted_paintable_get_tint(RnLinuxTintedPaintable* self) {
  g_return_val_if_fail(RN_LINUX_IS_TINTED_PAINTABLE(self), nullptr);
  return &self->tint;
}

GdkPaintable* rn_linux_tinted_paintable_get_source(RnLinuxTintedPaintable* self) {
  g_return_val_if_fail(RN_LINUX_IS_TINTED_PAINTABLE(self), nullptr);
  return self->source;
}
