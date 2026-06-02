// CodegenSmoke — compile-test impl for the Promise / callback /
// object code paths in `@lucid-softworks/react-native-linux-codegen`.
//
// This file exists primarily as a compile-time gate: any regression
// in the generator's emitted C++ for Promise<T>, callback params,
// or object marshalling breaks the vnext build. At runtime the
// module registers under `CodegenSmoke` and returns canned values,
// so JS callers can dispatch through `TurboModuleRegistry.get` if
// they want to spot-check from a bundle — but the static value is
// what makes this file pay rent.
//
// Source spec: packages/@lucid-softworks/react-native-linux/Libraries/
//   Specs/NativeCodegenSmoke.ts

#include "react-native-linux/Logging.h"
#include "react-native-linux/TurboModuleRegistry.h"
#include "specs/NativeCodegenSmokeSpec.h"

namespace rnlinux {

namespace {

class CodegenSmokeModule final : public codegen::NativeCodegenSmokeSpec {
 public:
  double add(double a, double b) override { return a + b; }

  codegen::EchoUserResult echoUser(codegen::EchoUserParam_User user) override {
    return {
        .name = std::move(user.name),
        .age = user.age,
        .greeting = "hello",
    };
  }

  void ping(std::function<void()> resolve,
            std::function<void(folly::dynamic)> /*reject*/) override {
    if (resolve)
      resolve();
  }

  void fetchUser(std::string /*id*/,
                 std::function<void(codegen::FetchUserResult)> resolve,
                 std::function<void(folly::dynamic)> /*reject*/) override {
    if (resolve) {
      resolve({
          .name = "anon",
          .age = 0,
      });
    }
  }

  void subscribe(std::function<void(std::string, double)> cb) override {
    if (cb) {
      cb("ready", 0);
    }
  }

  void observe(std::function<void(codegen::Observe_Cb_Event)> cb) override {
    if (cb) {
      cb({.kind = "tick", .count = 0});
    }
  }

  void shouldAccept(std::function<bool(std::string)> pred) override {
    if (pred) {
      // Synchronous call — pred returns a real bool we can act on.
      const bool ok = pred("hello");
      (void)ok;
    }
  }
};

[[maybe_unused]] static const int kRegisterCodegenSmoke =
    codegen::NativeCodegenSmokeSpec::install<CodegenSmokeModule>();

} // namespace

} // namespace rnlinux
