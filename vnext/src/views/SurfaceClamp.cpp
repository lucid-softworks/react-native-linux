#include "SurfaceClamp.h"

struct _RnlSurfaceClamp {
  GtkWidget parent_instance;
  GtkWidget* child;
};

G_DEFINE_FINAL_TYPE(RnlSurfaceClamp, rnl_surface_clamp, GTK_TYPE_WIDGET)

static void rnl_surface_clamp_measure(GtkWidget* widget,
                                      GtkOrientation orientation,
                                      int /*for_size*/,
                                      int* minimum,
                                      int* natural,
                                      int* minimum_baseline,
                                      int* natural_baseline) {
  // Report set_size_request as BOTH min and natural. The point is to
  // hide the child's content-derived natural from the parent — without
  // that, a GtkFixed ancestor allocates us to the child's full natural
  // (e.g. a FlatList's 4 200 px of items), making the inner scrolled
  // window's viewport equal to the content and breaking scrolling.
  //
  // For the top-level "no size_request set" case (rootView clamp under
  // GtkApplicationWindow), set_size_request returns -1 / -1 and we
  // report 0 / 0, which lets the window honour its default size.
  // For inner cases (e.g. wrapping a ScrollView), the caller sets
  // set_size_request to the Yoga frame and we report that, so the
  // ancestor allocates us to Yoga's frame size exactly.
  int reqW = 0, reqH = 0;
  gtk_widget_get_size_request(widget, &reqW, &reqH);
  const int v = (orientation == GTK_ORIENTATION_HORIZONTAL) ? reqW : reqH;
  const int clamped = v > 0 ? v : 0;
  *minimum = clamped;
  *natural = clamped;
  if (minimum_baseline)
    *minimum_baseline = -1;
  if (natural_baseline)
    *natural_baseline = -1;
}

static void
rnl_surface_clamp_size_allocate(GtkWidget* widget, int width, int height, int baseline) {
  RnlSurfaceClamp* self = RNL_SURFACE_CLAMP(widget);
  if (self->child && gtk_widget_should_layout(self->child)) {
    GtkAllocation alloc = {0, 0, width, height};
    gtk_widget_size_allocate(self->child, &alloc, baseline);
  }
}

static void rnl_surface_clamp_dispose(GObject* obj) {
  RnlSurfaceClamp* self = RNL_SURFACE_CLAMP(obj);
  g_clear_pointer(&self->child, gtk_widget_unparent);
  G_OBJECT_CLASS(rnl_surface_clamp_parent_class)->dispose(obj);
}

static void rnl_surface_clamp_class_init(RnlSurfaceClampClass* klass) {
  GtkWidgetClass* widget_class = GTK_WIDGET_CLASS(klass);
  widget_class->measure = rnl_surface_clamp_measure;
  widget_class->size_allocate = rnl_surface_clamp_size_allocate;
  G_OBJECT_CLASS(klass)->dispose = rnl_surface_clamp_dispose;
}

static void rnl_surface_clamp_init(RnlSurfaceClamp* self) {
  (void)self;
}

GtkWidget* rnl_surface_clamp_new(GtkWidget* child) {
  RnlSurfaceClamp* self = RNL_SURFACE_CLAMP(g_object_new(RNL_TYPE_SURFACE_CLAMP, nullptr));
  self->child = child;
  gtk_widget_set_parent(child, GTK_WIDGET(self));
  return GTK_WIDGET(self);
}
