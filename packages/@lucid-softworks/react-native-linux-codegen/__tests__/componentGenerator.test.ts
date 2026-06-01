// Tests for the Fabric component header generator. Same approach
// as generator.test.ts: hand-craft minimal schema fixtures matching
// what `@react-native/codegen`'s TypeScriptParser produces for a
// `*NativeComponent.ts` spec, so the tests stay deterministic.

import {generateComponent, type SpecComponent} from '../src/componentGenerator';

function fooView(): SpecComponent {
  return {
    specName: 'FooViewNativeComponent',
    componentName: 'FooView',
    def: {
      extendsProps: [{type: 'ReactNativeBuiltInType', knownTypeName: 'ReactNativeCoreViewProps'}],
      events: [
        {
          name: 'onValueChange',
          optional: true,
          bubblingType: 'direct',
          typeAnnotation: {
            type: 'EventTypeAnnotation',
            argument: {
              type: 'ObjectTypeAnnotation',
              properties: [
                {name: 'value', optional: false, typeAnnotation: {type: 'Int32TypeAnnotation'}},
                {name: 'ok', optional: false, typeAnnotation: {type: 'BooleanTypeAnnotation'}},
              ],
            },
          } as any,
        },
      ],
      props: [
        {
          name: 'enabled',
          optional: false,
          typeAnnotation: {type: 'BooleanTypeAnnotation', default: false},
        },
        {
          name: 'label',
          optional: true,
          typeAnnotation: {type: 'StringTypeAnnotation', default: 'default'},
        },
        {name: 'count', optional: false, typeAnnotation: {type: 'Int32TypeAnnotation', default: 0}},
        {
          name: 'ratio',
          optional: false,
          typeAnnotation: {type: 'DoubleTypeAnnotation', default: 0},
        },
      ],
      commands: [],
    },
  };
}

describe('generateComponent — FooView', () => {
  const header = generateComponent(fooView());

  test('declares the component name as an inline constexpr char[]', () => {
    expect(header).toMatch(/inline constexpr const char FooViewComponentName\[\] = "FooView";/);
  });

  test('emits the Props class with one typed field per spec prop', () => {
    expect(header).toMatch(/class FooViewProps final : public facebook::react::ViewProps/);
    expect(header).toMatch(/bool enabled\{false\};/);
    expect(header).toMatch(/std::string label\{"default"\};/);
    expect(header).toMatch(/int32_t count\{0\};/);
    expect(header).toMatch(/double ratio\{0\};/);
  });

  test('Props constructor threads convertRawProp through every field', () => {
    expect(header).toMatch(
      /enabled\(facebook::react::convertRawProp\(context, rawProps, "enabled", sourceProps\.enabled, false\)\)/,
    );
    expect(header).toMatch(
      /label\(facebook::react::convertRawProp\(context, rawProps, "label", sourceProps\.label, std::string\{"default"\}\)\)/,
    );
    expect(header).toMatch(
      /count\(facebook::react::convertRawProp\(context, rawProps, "count", sourceProps\.count, int32_t\{0\}\)\)/,
    );
    expect(header).toMatch(
      /ratio\(facebook::react::convertRawProp\(context, rawProps, "ratio", sourceProps\.ratio, double\{0\}\)\)/,
    );
  });

  test('emits the event payload struct + typed emitter method', () => {
    expect(header).toMatch(/struct FooViewValueChangeEvent \{/);
    expect(header).toMatch(/int32_t value;/);
    expect(header).toMatch(/bool ok;/);
    expect(header).toMatch(/void onValueChange\(int32_t value, bool ok\) const/);
    expect(header).toMatch(/dispatchEvent\("valueChange",/);
    expect(header).toMatch(
      /payload\.setProperty\(rt, "value", facebook::jsi::Value\(static_cast<int>\(value\)\)\)/,
    );
    expect(header).toMatch(/payload\.setProperty\(rt, "ok", facebook::jsi::Value\(ok\)\)/);
  });

  test('event emitter has the explicit forwarding constructor', () => {
    expect(header).toMatch(/FooViewEventEmitter\(facebook::react::SharedEventTarget eventTarget,/);
    expect(header).toMatch(
      /facebook::react::ViewEventEmitter\(std::move\(eventTarget\), std::move\(eventDispatcher\)\)/,
    );
  });

  test('emits ShadowNode + ComponentDescriptor parameterised on the spec types', () => {
    expect(header).toMatch(/class FooViewShadowNode final/);
    expect(header).toMatch(
      /ConcreteViewShadowNode<FooViewComponentName,\s+FooViewProps,\s+FooViewEventEmitter>/,
    );
    expect(header).toMatch(
      /using FooViewComponentDescriptor = facebook::react::ConcreteComponentDescriptor<FooViewShadowNode>;/,
    );
  });

  test('emits a one-liner registerFooView helper', () => {
    expect(header).toMatch(
      /inline void registerFooView\(facebook::react::ComponentDescriptorProviderRegistry& registry\)/,
    );
    expect(header).toMatch(
      /registry\.add\(facebook::react::concreteComponentDescriptorProvider<FooViewComponentDescriptor>\(\)\)/,
    );
  });
});

describe('generateComponent — Reserved prop types', () => {
  function withReserved(): SpecComponent {
    return {
      specName: 'GraphicsNativeComponent',
      componentName: 'Graphics',
      def: {
        extendsProps: [{type: 'ReactNativeBuiltInType', knownTypeName: 'ReactNativeCoreViewProps'}],
        events: [],
        props: [
          {
            name: 'tint',
            optional: true,
            typeAnnotation: {type: 'ReservedPropTypeAnnotation', name: 'ColorPrimitive'} as any,
          },
          {
            name: 'origin',
            optional: true,
            typeAnnotation: {type: 'ReservedPropTypeAnnotation', name: 'PointPrimitive'} as any,
          },
          {
            name: 'insets',
            optional: true,
            typeAnnotation: {
              type: 'ReservedPropTypeAnnotation',
              name: 'EdgeInsetsPrimitive',
            } as any,
          },
          {
            name: 'dim',
            optional: true,
            typeAnnotation: {
              type: 'ReservedPropTypeAnnotation',
              name: 'DimensionPrimitive',
            } as any,
          },
        ],
        commands: [],
      },
    };
  }

  const header = generateComponent(withReserved());

  test('Color lowers to facebook::react::SharedColor', () => {
    expect(header).toMatch(/facebook::react::SharedColor tint\{\};/);
    expect(header).toMatch(
      /tint\(facebook::react::convertRawProp\(context, rawProps, "tint", sourceProps\.tint, facebook::react::SharedColor\{\}\)\)/,
    );
  });

  test('Point lowers to facebook::react::Point', () => {
    expect(header).toMatch(/facebook::react::Point origin\{\};/);
  });

  test('EdgeInsets lowers to facebook::react::EdgeInsets', () => {
    expect(header).toMatch(/facebook::react::EdgeInsets insets\{\};/);
  });

  test('Dimension lowers to facebook::react::Float', () => {
    expect(header).toMatch(/facebook::react::Float dim\{\};/);
  });

  test('includes the graphics headers', () => {
    expect(header).toMatch(/#include <react\/renderer\/graphics\/Color\.h>/);
    expect(header).toMatch(/#include <react\/renderer\/graphics\/Point\.h>/);
    expect(header).toMatch(/#include <react\/renderer\/graphics\/RectangleEdges\.h>/);
  });

  test('unsupported reserved type throws', () => {
    expect(() =>
      generateComponent({
        specName: 'X',
        componentName: 'X',
        def: {
          extendsProps: [
            {type: 'ReactNativeBuiltInType', knownTypeName: 'ReactNativeCoreViewProps'},
          ],
          events: [],
          props: [
            {
              name: 'src',
              optional: false,
              typeAnnotation: {
                type: 'ReservedPropTypeAnnotation',
                name: 'ImageSourcePrimitive',
              } as any,
            },
          ],
          commands: [],
        },
      }),
    ).toThrow(/unsupported ReservedPropTypeAnnotation: "ImageSourcePrimitive"/);
  });
});

describe('generateComponent — StringEnum props', () => {
  function withEnum(): SpecComponent {
    return {
      specName: 'PickerNativeComponent',
      componentName: 'Picker',
      def: {
        extendsProps: [{type: 'ReactNativeBuiltInType', knownTypeName: 'ReactNativeCoreViewProps'}],
        events: [],
        props: [
          {
            name: 'mode',
            optional: true,
            typeAnnotation: {
              type: 'StringEnumTypeAnnotation',
              default: 'auto',
              options: ['small', 'large', 'auto'],
            } as any,
          },
        ],
        commands: [],
      },
    };
  }

  const header = generateComponent(withEnum());

  test('emits a typed enum class with each option', () => {
    expect(header).toMatch(/enum class PickerMode \{/);
    expect(header).toMatch(/  Small,\n  Large,\n  Auto,/);
  });

  test('emits a fromRawValue overload that dispatches by string', () => {
    expect(header).toMatch(
      /void fromRawValue\(const facebook::react::PropsParserContext& \/\*context\*\/,/,
    );
    expect(header).toMatch(/PickerMode& result\) \{/);
    expect(header).toMatch(/if \(string == "small"\) \{ result = PickerMode::Small; return; \}/);
    expect(header).toMatch(/if \(string == "large"\) \{ result = PickerMode::Large; return; \}/);
    expect(header).toMatch(/if \(string == "auto"\) \{ result = PickerMode::Auto; return; \}/);
  });

  test('emits a toString helper covering every case', () => {
    expect(header).toMatch(/inline std::string toString\(const PickerMode& v\) \{/);
    expect(header).toMatch(/case PickerMode::Small: return "small";/);
    expect(header).toMatch(/case PickerMode::Large: return "large";/);
    expect(header).toMatch(/case PickerMode::Auto: return "auto";/);
  });

  test('field default + convertRawProp default both point at the enum case', () => {
    expect(header).toMatch(/PickerMode mode\{PickerMode::Auto\};/);
    expect(header).toMatch(
      /mode\(facebook::react::convertRawProp\(context, rawProps, "mode", sourceProps\.mode, PickerMode::Auto\)\)/,
    );
  });

  test('enum case names PascalCase the JS option', () => {
    expect(header).not.toMatch(/PickerMode::small/);
    expect(header).not.toMatch(/PickerMode::auto/);
  });
});

describe('generateComponent — unsupported types raise actionable errors', () => {
  test('non-View extendsProps throws', () => {
    expect(() =>
      generateComponent({
        specName: 'WeirdNativeComponent',
        componentName: 'Weird',
        def: {
          extendsProps: [{type: 'SomeOtherBase'}],
          events: [],
          props: [],
          commands: [],
        },
      }),
    ).toThrow(/Linux component codegen MVP only supports `ViewProps`-extending components/);
  });

  test('object-typed prop throws (MVP boundary)', () => {
    expect(() =>
      generateComponent({
        specName: 'XNativeComponent',
        componentName: 'X',
        def: {
          extendsProps: [
            {type: 'ReactNativeBuiltInType', knownTypeName: 'ReactNativeCoreViewProps'},
          ],
          events: [],
          props: [
            {
              name: 'config',
              optional: false,
              typeAnnotation: {
                type: 'ObjectTypeAnnotation',
                properties: [],
                default: null,
              } as any,
            },
          ],
          commands: [],
        },
      }),
    ).toThrow(/unsupported component prop type: ObjectTypeAnnotation/);
  });
});
