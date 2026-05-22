// Smoke tests for LinuxComponentViewRegistry. Because component construction
// drags in GTK4 (gtk_fixed_new, etc.), these tests register a stub factory
// and verify the registry's bookkeeping rather than instantiating concrete
// views. Once we have a way to mock GtkWidget*, expand coverage to the
// concrete *ComponentView subclasses.

#include <gtest/gtest.h>

#include "fabric/LinuxComponentView.h"
#include "fabric/LinuxComponentViewRegistry.h"

namespace rnlinux::tests {

namespace {

class StubComponentView final : public LinuxComponentView {
 public:
  explicit StubComponentView(Tag tag) : LinuxComponentView(tag) {}
  void updateProps(facebook::react::Props const&,
                   facebook::react::Props const&) override {}
};

}  // namespace

TEST(LinuxComponentViewRegistry, ReturnsNullptrForUnknownComponent) {
  LinuxComponentViewRegistry registry;
  EXPECT_EQ(registry.create("NonexistentComponent", 42), nullptr);
}

TEST(LinuxComponentViewRegistry, RegistersAndLooksUpByTag) {
  LinuxComponentViewRegistry registry;
  registry.registerComponent("Stub", [](Tag t) {
    return std::unique_ptr<LinuxComponentView>(new StubComponentView{t});
  });

  auto view = registry.create("Stub", 7);
  ASSERT_NE(view, nullptr);
  EXPECT_EQ(view->tag(), 7);

  auto* raw = view.get();
  registry.insert(std::move(view));
  EXPECT_EQ(registry.lookup(7), raw);

  auto taken = registry.take(7);
  EXPECT_EQ(taken.get(), raw);
  EXPECT_EQ(registry.lookup(7), nullptr);
}

TEST(LinuxComponentViewRegistry, RawTextFactoryYieldsNullViewByDesign) {
  LinuxComponentViewRegistry registry;
  // The default ctor registers "RawText" as a data-only component that
  // returns nullptr — RawText is consumed by ParagraphComponentView, not
  // mounted on its own.
  EXPECT_EQ(registry.create("RawText", 1), nullptr);
}

}  // namespace rnlinux::tests
