#include "SwitchComponentView.h"

#include "../components/Switch.h"
#include "../jsi/RnLinuxBindings.h"

#include <gtk/gtk.h>

namespace rnlinux {

SwitchComponentView::SwitchComponentView(Tag tag)
    : LinuxComponentView(tag) {
  widget_ = gtk_switch_new();
  takeWidgetRef();
  // notify::active fires whenever the switch's bound `active` property
  // changes — covers user clicks, drags, keyboard activation, and
  // programmatic gtk_switch_set_active calls (we guard the last via
  // suppressChangeSignal_).
  g_signal_connect_data(widget_,
                        "notify::active",
                        G_CALLBACK(&SwitchComponentView::onActiveNotify),
                        this,
                        /*destroy=*/nullptr,
                        /*flags=*/static_cast<GConnectFlags>(0));
}

SwitchComponentView::~SwitchComponentView() = default;

void SwitchComponentView::onActiveNotify(GtkWidget* widget,
                                         GParamSpec* /*pspec*/,
                                         gpointer userData) {
  auto* self = static_cast<SwitchComponentView*>(userData);
  if (self->suppressChangeSignal_)
    return;
  const bool active = gtk_switch_get_active(GTK_SWITCH(widget));
  if (active == self->lastValue_)
    return;
  self->lastValue_ = active;
  dispatchFabricSwitchChange(self->tag_, active);
}

void SwitchComponentView::updateProps(facebook::react::Props const& /*oldProps*/,
                                      facebook::react::Props const& newProps) {
  const auto& sp = static_cast<const SwitchProps&>(newProps);

  gtk_widget_set_sensitive(widget_, !sp.disabled);

  // value: only push to the widget when it actually differs — guards
  // the signal so the dispatch doesn't ricochet back to JS.
  const bool current = gtk_switch_get_active(GTK_SWITCH(widget_));
  if (current != sp.value) {
    suppressChangeSignal_ = true;
    gtk_switch_set_active(GTK_SWITCH(widget_), sp.value);
    lastValue_ = sp.value;
    suppressChangeSignal_ = false;
  }
}

} // namespace rnlinux
