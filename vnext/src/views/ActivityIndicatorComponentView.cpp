#include "ActivityIndicatorComponentView.h"

#include "../components/ActivityIndicator.h"

#include <gtk/gtk.h>

namespace rnlinux {

ActivityIndicatorComponentView::ActivityIndicatorComponentView(Tag tag)
    : LinuxComponentView(tag) {
  widget_ = gtk_spinner_new();
  takeWidgetRef();
  // Default RN behavior: animating=true on mount.
  gtk_spinner_start(GTK_SPINNER(widget_));
}

ActivityIndicatorComponentView::~ActivityIndicatorComponentView() = default;

void ActivityIndicatorComponentView::updateProps(facebook::react::Props const& /*oldProps*/,
                                                 facebook::react::Props const& newProps) {
  const auto& ap = static_cast<const ActivityIndicatorProps&>(newProps);

  // animating: start/stop the spinner. GtkSpinner handles its own
  // animation timer when started; stopping it just stops the timer.
  if (ap.animating) {
    gtk_spinner_start(GTK_SPINNER(widget_));
  } else {
    gtk_spinner_stop(GTK_SPINNER(widget_));
  }

  // hidesWhenStopped: when off and not animating, hide the widget so
  // the layout shrinks. When on or animating, keep visible.
  const bool visible = ap.animating || !ap.hidesWhenStopped;
  gtk_widget_set_visible(widget_, visible);
}

} // namespace rnlinux
