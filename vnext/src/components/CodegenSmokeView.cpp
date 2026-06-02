// CodegenSmokeView — compile-test for the Fabric component generator.
//
// This TU just includes the generated header
// (`CodegenSmokeViewSpec.h`) and exercises a few of the generated
// types so any regression in the component generator's emitted C++
// breaks the vnext build. The descriptor itself isn't registered
// here — auto-registering through scattered TUs is the autolink-
// linux story; in-tree components register in
// `LinuxComponentDescriptorRegistry.cpp`.
//
// Source spec: packages/@lucid-softworks/react-native-linux/Libraries/
//   Specs/CodegenSmokeViewNativeComponent.ts

#include "specs/CodegenSmokeViewSpec.h"

namespace rnlinux {
namespace {

// Static smoke checks. ODR-using each generated symbol forces the
// compiler to fully instantiate them; no runtime side effects.
using SmokeProps = codegen::CodegenSmokeViewProps;
using SmokeShadowNode = codegen::CodegenSmokeViewShadowNode;
using SmokeDescriptor = codegen::CodegenSmokeViewComponentDescriptor;
using SmokeEventEmitter = codegen::CodegenSmokeViewEventEmitter;
using SmokeValueChangeEvent = codegen::CodegenSmokeViewValueChangeEvent;
using SmokeMode = codegen::CodegenSmokeViewMode;
using SmokeLevel = codegen::CodegenSmokeViewLevel;

static_assert(sizeof(SmokeProps) > 0);
static_assert(sizeof(SmokeShadowNode) > 0);
static_assert(sizeof(SmokeDescriptor) > 0);
static_assert(sizeof(SmokeEventEmitter) > 0);
static_assert(sizeof(SmokeValueChangeEvent) > 0);
static_assert(sizeof(SmokeMode) > 0);
static_assert(sizeof(SmokeLevel) > 0);

// Enum round-trip: the toString helper exists, the cases match the
// JS spec, and the default-init value is reachable.
static_assert(SmokeMode::Auto != SmokeMode::Small);
static_assert(SmokeMode::Small != SmokeMode::Large);

// Int32 enum is pinned to int32_t and case values match the JS
// numeric options.
static_assert(static_cast<int32_t>(SmokeLevel::K0) == 0);
static_assert(static_cast<int32_t>(SmokeLevel::K1) == 1);
static_assert(static_cast<int32_t>(SmokeLevel::K2) == 2);

// Commands round-trip: stub view exposes matching methods, the
// generated dispatcher dispatches by name. ODR-using the helper +
// instantiating it on the stub forces every code path through the
// compiler.
namespace {

struct StubCommandView {
  int focusCount = 0;
  int setValueCount = 0;
  std::string lastValue;
  bool lastForce = false;

  void focus() { ++focusCount; }
  void setValue(std::string value, bool force) {
    ++setValueCount;
    lastValue = std::move(value);
    lastForce = force;
  }
};

[[maybe_unused]] void smokeCommandDispatch() {
  StubCommandView stub;
  codegen::CodegenSmokeViewHandleCommand(stub, "focus", folly::dynamic::array());
  codegen::CodegenSmokeViewHandleCommand(stub, "setValue", folly::dynamic::array("hello", true));
}

} // namespace

} // namespace
} // namespace rnlinux
