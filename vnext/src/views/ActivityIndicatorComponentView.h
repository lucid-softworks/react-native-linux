#pragma once

#include "../fabric/LinuxComponentView.h"

typedef struct _GtkWidget GtkWidget;

namespace rnlinux {

// Spinning progress indicator backed by GtkSpinner. `animating` toggles
// gtk_spinner_start/stop; `hidesWhenStopped` hides the widget when not
// animating (default true, RN-idiomatic).
class ActivityIndicatorComponentView final : public LinuxComponentView {
 public:
  explicit ActivityIndicatorComponentView(Tag tag);
  ~ActivityIndicatorComponentView() override;

  void updateProps(facebook::react::Props const& oldProps,
                   facebook::react::Props const& newProps) override;
};

} // namespace rnlinux
