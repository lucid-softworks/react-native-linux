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

static_assert(sizeof(SmokeProps) > 0);
static_assert(sizeof(SmokeShadowNode) > 0);
static_assert(sizeof(SmokeDescriptor) > 0);
static_assert(sizeof(SmokeEventEmitter) > 0);
static_assert(sizeof(SmokeValueChangeEvent) > 0);

} // namespace
} // namespace rnlinux
