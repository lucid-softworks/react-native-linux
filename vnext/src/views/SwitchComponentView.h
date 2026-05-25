#pragma once

#include "../fabric/LinuxComponentView.h"

typedef struct _GtkWidget GtkWidget;
typedef void* gpointer;
typedef struct _GParamSpec GParamSpec;

namespace rnlinux {

// On/off toggle backed by GtkSwitch. `value` and `disabled` flow
// through from SwitchProps. The GtkSwitch::notify::active signal
// fires whenever the active state changes — we dispatch into JS via
// the rnLinux.fabricOnSwitchChange registry keyed by tag.
class SwitchComponentView final : public LinuxComponentView {
 public:
  explicit SwitchComponentView(Tag tag);
  ~SwitchComponentView() override;

  void updateProps(facebook::react::Props const& oldProps,
                   facebook::react::Props const& newProps) override;

 private:
  // Skip the dispatch when we set the value programmatically from
  // updateProps so React's controlled-component pattern doesn't
  // bounce updates back to JS.
  bool suppressChangeSignal_ = false;
  bool lastValue_ = false;

  static void onActiveNotify(GtkWidget* widget, GParamSpec* pspec, gpointer userData);
};

} // namespace rnlinux
