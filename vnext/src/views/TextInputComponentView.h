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
  std::string lastText_;

  static void onTextChanged(GtkWidget* editable, gpointer userData);
};

}  // namespace rnlinux
