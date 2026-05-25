#pragma once

#include <functional>
#include <memory>
#include <string>
#include <unordered_map>

#include "LinuxComponentView.h"

namespace rnlinux {

// Factory + lookup for component views. The mounting manager calls
// `create(componentName, tag)` for each ::Create mutation and stashes the
// resulting view under its Tag.
class LinuxComponentViewRegistry {
 public:
  using Factory = std::function<std::unique_ptr<LinuxComponentView>(Tag)>;

  LinuxComponentViewRegistry();

  void registerComponent(std::string componentName, Factory factory);

  // Construct a view for `componentName` with the given tag. Returns nullptr
  // if the component is unknown (the caller should log + skip).
  std::unique_ptr<LinuxComponentView> create(const std::string& componentName,
                                             Tag tag);

  LinuxComponentView* lookup(Tag tag) const;
  void insert(std::unique_ptr<LinuxComponentView> view);
  std::unique_ptr<LinuxComponentView> take(Tag tag);

  // Iteration helper used by the mounting manager to fire the
  // postLayoutPass hook on every registered view at end-of-transaction.
  const std::unordered_map<Tag, std::unique_ptr<LinuxComponentView>>&
      views() const { return views_; }

 private:
  std::unordered_map<std::string, Factory> factories_;
  std::unordered_map<Tag, std::unique_ptr<LinuxComponentView>> views_;
};

}  // namespace rnlinux
