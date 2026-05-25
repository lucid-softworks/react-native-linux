#include "LinuxComponentViewRegistry.h"
#include "react-native-linux/Logging.h"

#include "../views/ParagraphComponentView.h"
#include "../views/ScrollViewComponentView.h"
#include "../views/ViewComponentView.h"

namespace rnlinux {

LinuxComponentViewRegistry::LinuxComponentViewRegistry() {
  registerComponent("View", [](Tag t) {
    return std::make_unique<ViewComponentView>(t);
  });
  // RN's text system splits into Paragraph (the layout root) and RawText
  // (the leaf string). Only Paragraph maps to a real widget.
  registerComponent("Paragraph", [](Tag t) {
    return std::make_unique<ParagraphComponentView>(t);
  });
  registerComponent("RawText", [](Tag) -> std::unique_ptr<LinuxComponentView> {
    return nullptr;  // RawText is data only; no widget.
  });
  registerComponent("ScrollView", [](Tag t) {
    return std::make_unique<ScrollViewComponentView>(t);
  });
}

void LinuxComponentViewRegistry::registerComponent(std::string name,
                                                   Factory factory) {
  factories_[std::move(name)] = std::move(factory);
}

std::unique_ptr<LinuxComponentView> LinuxComponentViewRegistry::create(
    const std::string& name, Tag tag) {
  auto it = factories_.find(name);
  if (it == factories_.end()) {
    RNL_LOGW("ComponentViewRegistry")
        << "no factory for component '" << name << "' (tag=" << tag << ")";
    return nullptr;
  }
  return it->second(tag);
}

LinuxComponentView* LinuxComponentViewRegistry::lookup(Tag tag) const {
  auto it = views_.find(tag);
  return it == views_.end() ? nullptr : it->second.get();
}

void LinuxComponentViewRegistry::insert(
    std::unique_ptr<LinuxComponentView> view) {
  Tag t = view->tag();
  views_[t] = std::move(view);
}

std::unique_ptr<LinuxComponentView> LinuxComponentViewRegistry::take(Tag tag) {
  auto it = views_.find(tag);
  if (it == views_.end()) return nullptr;
  auto v = std::move(it->second);
  views_.erase(it);
  return v;
}

}  // namespace rnlinux
