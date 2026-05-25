#include "react-native-linux/TurboModuleRegistry.h"

#include "react-native-linux/Logging.h"

#include <jsi/jsi.h>

namespace rnlinux {

TurboModuleRegistry& TurboModuleRegistry::instance() {
  static TurboModuleRegistry r;
  return r;
}

void TurboModuleRegistry::registerModule(std::string name, TurboModuleFactory factory) {
  factories_[std::move(name)] = std::move(factory);
}

const TurboModuleFactory* TurboModuleRegistry::findFactory(const std::string& name) const {
  auto it = factories_.find(name);
  return it == factories_.end() ? nullptr : &it->second;
}

void installTurboModuleBinding(facebook::jsi::Runtime& rt) {
  using namespace facebook;

  // Per-runtime cache. Captured by value into the host function; lives
  // as long as the closure (i.e. until the runtime is replaced). The
  // host has its own resetRnLinuxBindings on reload that drops jsi::
  // objects holding the runtime — we rely on the cache going out of
  // scope when the runtime is destroyed and a fresh proxy is installed
  // by the next start().
  auto cache = std::make_shared<std::unordered_map<std::string, std::shared_ptr<TurboModule>>>();

  auto proxy = jsi::Function::createFromHostFunction(
      rt,
      jsi::PropNameID::forUtf8(rt, "__turboModuleProxy"),
      1,
      [cache](jsi::Runtime& runtime,
              const jsi::Value& /*thisValue*/,
              const jsi::Value* args,
              size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isString()) {
          return jsi::Value::null();
        }
        const auto name = args[0].asString(runtime).utf8(runtime);

        auto cached = cache->find(name);
        if (cached != cache->end()) {
          return jsi::Object::createFromHostObject(runtime, cached->second);
        }

        const auto* factory = TurboModuleRegistry::instance().findFactory(name);
        if (!factory) {
          // Per RN's getEnforcing contract, returning null lets the JS
          // side throw with a nicer "module not found in native binary"
          // message than we could from here.
          RNL_LOGD("TurboModuleRegistry") << "no factory for '" << name << "'";
          return jsi::Value::null();
        }

        auto module = (*factory)(runtime);
        if (!module) {
          return jsi::Value::null();
        }
        (*cache)[name] = module;
        RNL_LOGI("TurboModuleRegistry") << "instantiated '" << name << "'";
        return jsi::Object::createFromHostObject(runtime, module);
      });

  rt.global().setProperty(rt, "__turboModuleProxy", std::move(proxy));
  RNL_LOGI("TurboModuleRegistry") << "__turboModuleProxy installed";
}

} // namespace rnlinux
