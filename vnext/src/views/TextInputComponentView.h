#pragma once

#include "../fabric/LinuxComponentView.h"

#include <string>

typedef struct _GtkWidget GtkWidget;
typedef void* gpointer;

namespace rnlinux {

// Single-line text entry backed by GtkText. value / placeholder /
// placeholderTextColor / maxLength flow through from BaseTextInputProps.
// onChangeText fires JS via the rnLinux.fabricOnChangeText registry.
class TextInputComponentView final : public LinuxComponentView {
 public:
  explicit TextInputComponentView(Tag tag);
  ~TextInputComponentView() override;

  void updateProps(facebook::react::Props const& oldProps,
                   facebook::react::Props const& newProps) override;

 private:
  // Guard so programmatic gtk_editable_set_text from updateProps
  // doesn't re-enter and recurse via the changed signal.
  bool suppressChangeSignal_ = false;
  // Mirror of the GtkText widget's current text — updated synchronously
  // from the "changed" signal handler before we dispatch to JS.
  std::string lastText_;
  // Last value we dispatched to JS for this tag. updateProps treats a
  // matching tp.text as a controlled-input echo (JS catching up) and
  // skips the write-back, otherwise rapid typing races against a JS
  // re-render and overwrites characters the user just typed.
  std::string lastDispatched_;
  // Pending g_idle source ID for the deferred dispatch. Zero = nothing
  // queued; the next "changed" signal will schedule one. Non-zero =
  // already pending; we just update lastText_ and the idle reads the
  // latest value when it fires.
  unsigned int dispatchIdleId_ = 0;
  // Per-instance CSS provider so we can style the placeholder colour
  // (and text colour) per-widget — GtkText draws the placeholder via
  // a separate "placeholder" CSS node child, so the only way to honour
  // RN's `placeholderTextColor` is a stylesheet that targets it.
  void* cssProvider_ = nullptr; // GtkCssProvider*
  std::string lastCss_;

  static void onTextChanged(GtkWidget* editable, gpointer userData);
};

} // namespace rnlinux
