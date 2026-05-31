#pragma once

#include <gtk/gtk.h>

G_BEGIN_DECLS

// GdkPaintable wrapper that recolors a source paintable: output RGB is
// replaced by the tint colour, scaled by the source's per-pixel alpha,
// so transparent regions stay transparent and opaque pixels take the
// tint. Mirrors React Native's `<Image tintColor=…>` semantics (the
// source's RGB is discarded; only its alpha shapes the result).
//
// Forwards intrinsic size + invalidation from the source. Setting a
// new source disconnects from the previous one.

#define RN_LINUX_TYPE_TINTED_PAINTABLE (rn_linux_tinted_paintable_get_type())

G_DECLARE_FINAL_TYPE(
    RnLinuxTintedPaintable, rn_linux_tinted_paintable, RN_LINUX, TINTED_PAINTABLE, GObject)

// Take a strong ref on `source` (transfer none) and tint with `rgba`.
GdkPaintable* rn_linux_tinted_paintable_new(GdkPaintable* source, const GdkRGBA* rgba);

// Swap the wrapped source. Disconnects invalidation signals from the
// old source and reconnects on the new one. Passing nullptr clears it.
void rn_linux_tinted_paintable_set_source(RnLinuxTintedPaintable* self, GdkPaintable* source);

// Update the tint colour in place and invalidate so GtkPicture
// re-snapshots. Used when only the tint prop changed.
void rn_linux_tinted_paintable_set_tint(RnLinuxTintedPaintable* self, const GdkRGBA* rgba);

const GdkRGBA* rn_linux_tinted_paintable_get_tint(RnLinuxTintedPaintable* self);

GdkPaintable* rn_linux_tinted_paintable_get_source(RnLinuxTintedPaintable* self);

G_END_DECLS
