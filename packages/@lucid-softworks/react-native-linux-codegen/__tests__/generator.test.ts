// Generator behaviour locked down against fixture schemas. We avoid
// the live `@react-native/codegen` TypeScript parser here so the
// tests stay deterministic and don't break if the parser bumps
// minor versions in ways that change irrelevant schema details.
// Instead we hand-craft minimal NativeModuleSchema objects matching
// the parser's actual output (verified by running it against the
// PlatformConstants spec).

import {generateModule, type SpecModule} from '../src/generator';

function platformConstantsModule(): SpecModule {
  return {
    specName: 'NativePlatformConstantsLinux',
    moduleName: 'PlatformConstants',
    schema: {
      type: 'NativeModule',
      moduleName: 'PlatformConstants',
      spec: {
        methods: [
          {
            name: 'getConstants',
            optional: false,
            typeAnnotation: {
              type: 'FunctionTypeAnnotation',
              params: [],
              returnTypeAnnotation: {
                type: 'ObjectTypeAnnotation',
                properties: [],
              },
            },
          },
        ],
      },
    },
  };
}

describe('generateModule — PlatformConstants', () => {
  const header = generateModule(platformConstantsModule());

  test('declares the spec class extending rnlinux::TurboModule', () => {
    expect(header).toMatch(/class NativePlatformConstantsLinuxSpec : public rnlinux::TurboModule/);
  });

  test('exposes kModuleName matching the registry name', () => {
    expect(header).toMatch(/static constexpr const char\* kModuleName = "PlatformConstants";/);
  });

  test('emits a typed-struct return for ObjectType returns', () => {
    expect(header).toMatch(/struct GetConstantsResult \{/);
    expect(header).toMatch(/virtual GetConstantsResult getConstants\(\) = 0;/);
  });

  test('overrides jsi::HostObject::get and dispatches by name', () => {
    expect(header).toMatch(
      /facebook::jsi::Value get\(facebook::jsi::Runtime& rt, const facebook::jsi::PropNameID& name\) override/,
    );
    expect(header).toMatch(/if \(methodName == "getConstants"\)/);
    // Object returns go through toDynamic + valueFromDynamic.
    expect(header).toMatch(/return facebook::jsi::valueFromDynamic\(rt_, toDynamic\(__result\)\);/);
  });

  test('overrides getPropertyNames listing every method', () => {
    expect(header).toMatch(
      /std::vector<facebook::jsi::PropNameID> getPropertyNames\(facebook::jsi::Runtime& rt\) override/,
    );
    expect(header).toMatch(
      /out\.emplace_back\(facebook::jsi::PropNameID::forUtf8\(rt, "getConstants"\)\);/,
    );
  });

  test('pragma-once + folly + JSIDynamic includes', () => {
    expect(header).toMatch(/#pragma once/);
    expect(header).toMatch(/#include <folly\/dynamic\.h>/);
    expect(header).toMatch(/#include <jsi\/JSIDynamic\.h>/);
    expect(header).toMatch(/#include <react-native-linux\/TurboModuleRegistry\.h>/);
  });
});

describe('generateModule — primitives + void + multi-method', () => {
  const mod: SpecModule = {
    specName: 'NativeFoo',
    moduleName: 'Foo',
    schema: {
      type: 'NativeModule',
      moduleName: 'Foo',
      spec: {
        methods: [
          {
            name: 'add',
            optional: false,
            typeAnnotation: {
              type: 'FunctionTypeAnnotation',
              params: [
                {name: 'a', typeAnnotation: {type: 'NumberTypeAnnotation'}},
                {name: 'b', typeAnnotation: {type: 'NumberTypeAnnotation'}},
              ],
              returnTypeAnnotation: {type: 'NumberTypeAnnotation'},
            },
          },
          {
            name: 'isReady',
            optional: false,
            typeAnnotation: {
              type: 'FunctionTypeAnnotation',
              params: [{name: 'id', typeAnnotation: {type: 'StringTypeAnnotation'}}],
              returnTypeAnnotation: {type: 'BooleanTypeAnnotation'},
            },
          },
          {
            name: 'close',
            optional: false,
            typeAnnotation: {
              type: 'FunctionTypeAnnotation',
              params: [],
              returnTypeAnnotation: {type: 'VoidTypeAnnotation'},
            },
          },
        ],
      },
    },
  };

  const header = generateModule(mod);

  test('primitive return + primitive params land at the right C++ types', () => {
    expect(header).toMatch(/virtual double add\(double a, double b\) = 0;/);
    expect(header).toMatch(/virtual bool isReady\(std::string id\) = 0;/);
  });

  test('void return is voided and returns undefined from the host fn', () => {
    expect(header).toMatch(/virtual void close\(\) = 0;/);
    expect(header).toMatch(/this->close\(\);/);
  });

  test('string params decode via asString().utf8()', () => {
    expect(header).toMatch(/auto id = args\[0\]\.asString\(rt_\)\.utf8\(rt_\);/);
  });

  test('number params decode via asNumber()', () => {
    expect(header).toMatch(/auto a = args\[0\]\.asNumber\(\);/);
    expect(header).toMatch(/auto b = args\[1\]\.asNumber\(\);/);
  });

  test('paramCount reflects the param list size', () => {
    expect(header).toMatch(/\/\*paramCount=\*\/2/);
    expect(header).toMatch(/\/\*paramCount=\*\/1/);
    expect(header).toMatch(/\/\*paramCount=\*\/0/);
  });

  test('getPropertyNames reserves and emplaces every method', () => {
    expect(header).toMatch(/out\.reserve\(3\);/);
    for (const name of ['add', 'isReady', 'close']) {
      expect(header).toMatch(
        new RegExp(`emplace_back\\(facebook::jsi::PropNameID::forUtf8\\(rt, "${name}"\\)\\)`),
      );
    }
  });
});

describe('generateModule — nullable + enum + dynamic arrays', () => {
  const mod: SpecModule = {
    specName: 'NativeBar',
    moduleName: 'Bar',
    schema: {
      type: 'NativeModule',
      moduleName: 'Bar',
      spec: {
        methods: [
          {
            name: 'tagify',
            optional: false,
            typeAnnotation: {
              type: 'FunctionTypeAnnotation',
              params: [
                {
                  name: 'maybeId',
                  typeAnnotation: {
                    type: 'NullableTypeAnnotation',
                    typeAnnotation: {type: 'StringTypeAnnotation'},
                  },
                },
                {name: 'items', typeAnnotation: {type: 'ArrayTypeAnnotation'}},
              ],
              returnTypeAnnotation: {
                type: 'NullableTypeAnnotation',
                typeAnnotation: {type: 'StringTypeAnnotation'},
              },
            },
          },
          {
            name: 'kind',
            optional: false,
            typeAnnotation: {
              type: 'FunctionTypeAnnotation',
              params: [],
              returnTypeAnnotation: {
                type: 'EnumDeclaration',
                memberType: 'StringTypeAnnotation',
              },
            },
          },
        ],
      },
    },
  };

  const header = generateModule(mod);

  test('nullable<string> reduces to std::string (MVP simplification)', () => {
    expect(header).toMatch(
      /virtual std::string tagify\(std::string maybeId, folly::dynamic items\) = 0;/,
    );
  });

  test('enum<string> reduces to std::string', () => {
    expect(header).toMatch(/virtual std::string kind\(\) = 0;/);
  });

  test('array param decodes via dynamicFromValue', () => {
    expect(header).toMatch(/auto items = facebook::jsi::dynamicFromValue\(rt_, args\[1\]\);/);
  });
});

describe('generateModule — Promise returns', () => {
  function asyncMod(): SpecModule {
    return {
      specName: 'NativeAsync',
      moduleName: 'Async',
      schema: {
        type: 'NativeModule',
        moduleName: 'Async',
        spec: {
          methods: [
            {
              name: 'doVoid',
              optional: false,
              typeAnnotation: {
                type: 'FunctionTypeAnnotation',
                params: [],
                returnTypeAnnotation: {
                  type: 'PromiseTypeAnnotation',
                  elementType: {type: 'VoidTypeAnnotation'},
                },
              },
            },
            {
              name: 'fetchUser',
              optional: false,
              typeAnnotation: {
                type: 'FunctionTypeAnnotation',
                params: [{name: 'id', typeAnnotation: {type: 'StringTypeAnnotation'}}],
                returnTypeAnnotation: {
                  type: 'PromiseTypeAnnotation',
                  elementType: {type: 'ObjectTypeAnnotation', properties: []},
                },
              },
            },
          ],
        },
      },
    };
  }

  const header = generateModule(asyncMod());

  test('void promise virtual takes no-arg resolve + folly::dynamic reject', () => {
    expect(header).toMatch(
      /virtual void doVoid\(std::function<void\(\)> resolve, std::function<void\(folly::dynamic\)> reject\) = 0;/,
    );
  });

  test('object promise virtual takes resolve<typed struct>', () => {
    // Promise<Object> resolves through the spec's generated struct,
    // not folly::dynamic. The struct is materialised post-order so
    // its declaration precedes the virtual.
    expect(header).toMatch(/struct FetchUserResult \{/);
    expect(header).toMatch(
      /virtual void fetchUser\(std::string id, std::function<void\(FetchUserResult\)> resolve, std::function<void\(folly::dynamic\)> reject\) = 0;/,
    );
  });

  test('dispatcher constructs a Promise via globalThis.Promise', () => {
    expect(header).toMatch(/Promise = rt_\.global\(\)\.getPropertyAsFunction\(rt_, "Promise"\);/);
    expect(header).toMatch(/Promise\.callAsConstructor\(rt_, executor\);/);
  });

  test('executor captures unpacked params + __executor by-value', () => {
    expect(header).toMatch(/\[self, __executor, id = std::move\(id\)\]/);
    expect(header).toMatch(
      /self->fetchUser\(std::move\(id\), std::move\(resolve\), std::move\(reject\)\);/,
    );
  });

  test('captures the RuntimeExecutor at dispatch time', () => {
    expect(header).toMatch(/auto __executor = rnlinux::getRuntimeExecutor\(\);/);
    expect(header).toMatch(/#include <react-native-linux\/RuntimeExecutor\.h>/);
  });

  test('resolve/reject post via the executor instead of capturing rt by ref', () => {
    // No more `&rt_exec` ref captures inside the resolve/reject lambdas.
    expect(header).not.toMatch(/\[resolveFn, &rt_exec\]/);
    expect(header).not.toMatch(/\[rejectFn, &rt_exec\]/);
    // Instead, each lambda captures __executor and hops via it.
    expect(header).toMatch(/\[resolveFn, __executor\]/);
    expect(header).toMatch(/\[rejectFn, __executor\]/);
    expect(header).toMatch(/__executor\(\[resolveFn,/);
    expect(header).toMatch(/__executor\(\[rejectFn,/);
  });

  test('header pulls in <functional> + <memory> + <utility>', () => {
    expect(header).toMatch(/#include <functional>/);
    expect(header).toMatch(/#include <memory>/);
    expect(header).toMatch(/#include <utility>/);
  });
});

describe('generateModule — typed object structs', () => {
  function platformConstants(): SpecModule {
    return {
      specName: 'NativePlatformConstantsLinux',
      moduleName: 'PlatformConstants',
      schema: {
        type: 'NativeModule',
        moduleName: 'PlatformConstants',
        spec: {
          methods: [
            {
              name: 'getConstants',
              optional: false,
              typeAnnotation: {
                type: 'FunctionTypeAnnotation',
                params: [],
                returnTypeAnnotation: {
                  type: 'ObjectTypeAnnotation',
                  properties: [
                    {name: 'isTesting', typeAnnotation: {type: 'BooleanTypeAnnotation'}},
                    {
                      name: 'reactNativeVersion',
                      typeAnnotation: {
                        type: 'ObjectTypeAnnotation',
                        properties: [
                          {name: 'major', typeAnnotation: {type: 'NumberTypeAnnotation'}},
                          {name: 'minor', typeAnnotation: {type: 'NumberTypeAnnotation'}},
                          {name: 'patch', typeAnnotation: {type: 'NumberTypeAnnotation'}},
                        ],
                      },
                    },
                    {name: 'osVersion', typeAnnotation: {type: 'StringTypeAnnotation'}},
                  ],
                },
              },
            },
          ],
        },
      },
    };
  }

  const header = generateModule(platformConstants());

  test('nested structs are declared before their parent (post-order)', () => {
    const nestedIdx = header.indexOf('struct GetConstantsResult_ReactNativeVersion {');
    const parentIdx = header.indexOf('struct GetConstantsResult {');
    expect(nestedIdx).toBeGreaterThan(0);
    expect(parentIdx).toBeGreaterThan(nestedIdx);
  });

  test('struct fields take the matching C++ primitive types', () => {
    expect(header).toMatch(/struct GetConstantsResult \{/);
    expect(header).toMatch(/bool isTesting;/);
    expect(header).toMatch(/GetConstantsResult_ReactNativeVersion reactNativeVersion;/);
    expect(header).toMatch(/std::string osVersion;/);
  });

  test('nested struct fields take primitive types too', () => {
    expect(header).toMatch(/struct GetConstantsResult_ReactNativeVersion \{/);
    expect(header).toMatch(/double major;/);
    expect(header).toMatch(/double minor;/);
    expect(header).toMatch(/double patch;/);
  });

  test('emits toDynamic free function per struct', () => {
    expect(header).toMatch(/inline folly::dynamic toDynamic\(const GetConstantsResult& v\) \{/);
    expect(header).toMatch(
      /inline folly::dynamic toDynamic\(const GetConstantsResult_ReactNativeVersion& v\) \{/,
    );
    expect(header).toMatch(/\("isTesting", v\.isTesting\)/);
    expect(header).toMatch(/\("reactNativeVersion", toDynamic\(v\.reactNativeVersion\)\)/);
    expect(header).toMatch(/\("osVersion", v\.osVersion\)/);
  });

  test('dispatcher wraps the returned struct via toDynamic + valueFromDynamic', () => {
    expect(header).toMatch(/return facebook::jsi::valueFromDynamic\(rt_, toDynamic\(__result\)\);/);
  });
});

describe('generateModule — Function (callback) params', () => {
  function callbackMod(): SpecModule {
    return {
      specName: 'NativeCallbacks',
      moduleName: 'Callbacks',
      schema: {
        type: 'NativeModule',
        moduleName: 'Callbacks',
        spec: {
          methods: [
            {
              name: 'onReady',
              optional: false,
              typeAnnotation: {
                type: 'FunctionTypeAnnotation',
                params: [
                  {
                    name: 'cb',
                    typeAnnotation: {
                      type: 'FunctionTypeAnnotation',
                      params: [{name: 'msg', typeAnnotation: {type: 'StringTypeAnnotation'}}],
                      returnTypeAnnotation: {type: 'VoidTypeAnnotation'},
                    },
                  },
                ],
                returnTypeAnnotation: {type: 'VoidTypeAnnotation'},
              },
            },
            {
              name: 'subscribe',
              optional: false,
              typeAnnotation: {
                type: 'FunctionTypeAnnotation',
                params: [
                  {
                    name: 'cb',
                    typeAnnotation: {
                      type: 'FunctionTypeAnnotation',
                      params: [
                        {name: 'count', typeAnnotation: {type: 'NumberTypeAnnotation'}},
                        {name: 'ok', typeAnnotation: {type: 'BooleanTypeAnnotation'}},
                      ],
                      returnTypeAnnotation: {type: 'VoidTypeAnnotation'},
                    },
                  },
                ],
                returnTypeAnnotation: {type: 'VoidTypeAnnotation'},
              },
            },
            {
              name: 'fireAndForget',
              optional: false,
              typeAnnotation: {
                type: 'FunctionTypeAnnotation',
                params: [
                  {
                    name: 'done',
                    typeAnnotation: {
                      type: 'FunctionTypeAnnotation',
                      params: [],
                      returnTypeAnnotation: {type: 'VoidTypeAnnotation'},
                    },
                  },
                ],
                returnTypeAnnotation: {type: 'VoidTypeAnnotation'},
              },
            },
          ],
        },
      },
    };
  }

  const header = generateModule(callbackMod());

  test('virtual signature uses std::function<void(args...)>', () => {
    expect(header).toMatch(/virtual void onReady\(std::function<void\(std::string\)> cb\) = 0;/);
    expect(header).toMatch(/virtual void subscribe\(std::function<void\(double, bool\)> cb\) = 0;/);
    expect(header).toMatch(/virtual void fireAndForget\(std::function<void\(\)> done\) = 0;/);
  });

  test('dispatcher captures the jsi::Function via shared_ptr', () => {
    expect(header).toMatch(
      /auto __fn_cb = std::make_shared<facebook::jsi::Function>\(\s*args\[0\]\.asObject\(rt_\)\.asFunction\(rt_\)\);/,
    );
  });

  test('callback wrapper hops via __executor before calling', () => {
    expect(header).toMatch(/auto __executor = rnlinux::getRuntimeExecutor\(\);/);
    expect(header).toMatch(
      /__executor\(\[__fn_cb, __cb_msg = std::move\(msg\)\]\(facebook::jsi::Runtime& __rt\) mutable {/,
    );
    expect(header).toMatch(
      /__fn_cb->call\(__rt, facebook::jsi::String::createFromUtf8\(__rt, __cb_msg\)\);/,
    );
  });

  test('multi-arg callback re-marshals each arg via the right toJsi', () => {
    expect(header).toMatch(/__cb_count = std::move\(count\)/);
    expect(header).toMatch(/__cb_ok = std::move\(ok\)/);
    expect(header).toMatch(
      /__fn_cb->call\(__rt, facebook::jsi::Value\(__cb_count\), facebook::jsi::Value\(__cb_ok\)\);/,
    );
  });

  test('zero-arg callback wraps to std::function<void()> + no executor args', () => {
    expect(header).toMatch(/std::function<void\(\)> done =/);
    expect(header).toMatch(/__executor\(\[__fn_done\]\(facebook::jsi::Runtime& __rt\) mutable {/);
    expect(header).toMatch(/__fn_done->call\(__rt\);/);
  });
});

describe('generateModule — unsupported types throw with actionable messages', () => {
  test('non-void callback return throws a follow-up-tracked error', () => {
    expect(() =>
      generateModule({
        specName: 'NativeCB',
        moduleName: 'CB',
        schema: {
          type: 'NativeModule',
          moduleName: 'CB',
          spec: {
            methods: [
              {
                name: 'onValue',
                optional: false,
                typeAnnotation: {
                  type: 'FunctionTypeAnnotation',
                  params: [
                    {
                      name: 'cb',
                      typeAnnotation: {
                        type: 'FunctionTypeAnnotation',
                        params: [],
                        returnTypeAnnotation: {type: 'StringTypeAnnotation'},
                      },
                    },
                  ],
                  returnTypeAnnotation: {type: 'VoidTypeAnnotation'},
                },
              },
            ],
          },
        },
      }),
    ).toThrow(/Non-void callback returns are not yet supported/);
  });
});
