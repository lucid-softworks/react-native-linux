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
