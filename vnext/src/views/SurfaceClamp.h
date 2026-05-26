#pragma once

#include <gtk/gtk.h>

G_BEGIN_DECLS

// A pin-down wrapper for the React root widget. Holds exactly one
// child; reports min/natural = (0, 0) so its own size never grows
// with the child's content; allocates the child to the wrapper's
// own allocation.
//
// Why this exists: GtkFixed (used as our React rootView) reports
// natural = max child extent, and any nested GtkLabel / GtkFixed /
// GtkScrolledWindow happily reports a natural larger than its
// Yoga-allocated frame (GtkLabel = full text width, GtkScrolledWindow
// = child natural unless explicitly capped). That huge natural walks
// up through every ancestor until it hits the GtkApplicationWindow,
// which then either auto-grows past the monitor or — when wrapped in
// a GtkScrolledWindow to absorb it — scrolls the entire React tree
// (tab bar and all) the moment the user touches a wheel. Putting
// rootView inside this wrapper breaks the propagation chain: the
// wrapper says "I don't care what's inside, my preferred size is 0",
// the window honours its default size, and rootView still gets the
// full window content area to render into.

#define RNL_TYPE_SURFACE_CLAMP (rnl_surface_clamp_get_type())
G_DECLARE_FINAL_TYPE(RnlSurfaceClamp, rnl_surface_clamp, RNL, SURFACE_CLAMP, GtkWidget)

GtkWidget* rnl_surface_clamp_new(GtkWidget* child);

G_END_DECLS
