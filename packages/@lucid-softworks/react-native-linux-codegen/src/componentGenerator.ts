// Linux Fabric component header generator.
//
// Takes a ComponentSchema (the `Component`-typed entry produced by
// `@react-native/codegen`'s TypeScriptParser) and emits a header
// that declares:
//
//   • A `<Name>Props` class extending `react::ViewProps` with one
//     typed field per spec prop, parsed via `convertRawProp`.
//   • A `<Name>EventEmitter` class extending `react::ViewEventEmitter`
//     with one method per spec event, packing the typed payload into
//     a jsi::Object dispatched through Fabric's event pipe.
//   • A `<Name>ShadowNode` (ConcreteViewShadowNode instantiation).
//   • A `<Name>ComponentDescriptor` (ConcreteComponentDescriptor alias).
//   • `inline void register<Name>(...)` — registers the descriptor on
//     a `ComponentDescriptorProviderRegistry`.
//
// MVP scope: primitive prop types (string/bool/Int32/Double/Float)
// with defaults from the spec, and direct-bubbling events whose
// payload object is a flat record of primitives. Reserved prop
// types (Color/Point/EdgeInsets), enum props, object/array props,
// and commands are tracked as follow-ups.
//
// The implementer side is unchanged: write a LinuxComponentView
// subclass that mounts/updates/unmounts the GTK widget, and call
// the generated `register<Name>` from
// `LinuxComponentDescriptorRegistry.cpp` (or
// `autolinked.cmake`-stamped wiring for third-party deps).

import {mapType, type TypeAnnotation} from './types';

// ─── Shapes accepted from the parser ────────────────────────────────

interface PropShape {
  name: string;
  optional: boolean;
  typeAnnotation: TypeAnnotation & {default?: string | number | boolean | null};
}

interface EventShape {
  name: string;
  optional: boolean;
  bubblingType: 'direct' | 'bubble';
  typeAnnotation: {
    type: 'EventTypeAnnotation';
    argument?: TypeAnnotation;
  };
}

interface ComponentDef {
  extendsProps?: Array<{type: string; knownTypeName?: string}>;
  props: PropShape[];
  events: EventShape[];
  commands?: unknown[];
}

// Container for one parsed component module. The driver in
// `index.ts` hands one of these in per Component-typed entry it
// finds in `schema.modules`.
export interface SpecComponent {
  // The .ts file basename without extension — drives the header
  // filename only.
  specName: string;
  // The Fabric component name as declared in
  // `codegenNativeComponent<NativeProps>('FooView')`. Drives every
  // generated C++ identifier.
  componentName: string;
  def: ComponentDef;
}

export interface GenerateOptions {
  banner?: string;
}

// ─── Type lowering for prop fields ──────────────────────────────────

interface PropCpp {
  cpp: string; // C++ type
  defaultExpr: string; // default-init initializer (e.g. `{false}`)
}

function quoteCppString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function propCppType(t: TypeAnnotation & {default?: unknown}): PropCpp {
  // Nullable<T> → T (MVP simplification, mirrors the TM mapper).
  let inner: TypeAnnotation = t;
  if (inner.type === 'NullableTypeAnnotation') {
    inner = (inner as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
  }
  const def = (t as {default?: unknown}).default;
  switch (inner.type) {
    case 'BooleanTypeAnnotation':
      return {cpp: 'bool', defaultExpr: `{${def === true ? 'true' : 'false'}}`};
    case 'StringTypeAnnotation':
      return {
        cpp: 'std::string',
        defaultExpr: typeof def === 'string' ? `{${quoteCppString(def)}}` : '{}',
      };
    case 'Int32TypeAnnotation':
      return {
        cpp: 'int32_t',
        defaultExpr: `{${typeof def === 'number' ? def : 0}}`,
      };
    case 'DoubleTypeAnnotation':
    case 'NumberTypeAnnotation':
      return {
        cpp: 'double',
        defaultExpr: `{${typeof def === 'number' ? def : 0}}`,
      };
    case 'FloatTypeAnnotation':
      return {
        cpp: 'float',
        defaultExpr: `{${typeof def === 'number' ? def : 0}f}`,
      };
    default:
      throw new Error(
        `unsupported component prop type: ${inner.type}. ` +
          `Linux component codegen MVP covers boolean/string/Int32/Double/Float; ` +
          'object/array/Color/Point/Enum props are tracked follow-ups.',
      );
  }
}

function eventPayloadField(t: TypeAnnotation): {
  cpp: string;
  toJsiExpr: (cppVar: string, rt: string) => string;
} {
  let inner = t;
  if (inner.type === 'NullableTypeAnnotation') {
    inner = (inner as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
  }
  const mapped = mapType(inner, 'return');
  if (!mapped.toJsi) {
    throw new Error(`event payload field with type ${inner.type} has no toJsi mapping`);
  }
  return {cpp: mapped.cpp, toJsiExpr: mapped.toJsi};
}

// ─── Renderer ───────────────────────────────────────────────────────

export function generateComponent(spec: SpecComponent, opts: GenerateOptions = {}): string {
  const {specName, componentName, def} = spec;
  const banner =
    opts.banner ??
    `// Auto-generated by @lucid-softworks/react-native-linux-codegen.\n` +
      `// Source: ${specName}.ts (component: ${componentName}). DO NOT EDIT.`;

  // For now we assume ViewProps-based components. AnyProps /
  // FlatList / custom bases are out of scope.
  const extendsCoreView = (def.extendsProps ?? []).some(
    e => e.type === 'ReactNativeBuiltInType' && e.knownTypeName === 'ReactNativeCoreViewProps',
  );
  if (!extendsCoreView && (def.extendsProps ?? []).length > 0) {
    throw new Error(
      'Linux component codegen MVP only supports `ViewProps`-extending components; ' +
        `got extendsProps=${JSON.stringify(def.extendsProps)}.`,
    );
  }

  const lines: string[] = [];
  lines.push(banner);
  lines.push('');
  lines.push('#pragma once');
  lines.push('');
  lines.push('#include <jsi/jsi.h>');
  lines.push('#include <react/renderer/components/view/ConcreteViewShadowNode.h>');
  lines.push('#include <react/renderer/components/view/ViewEventEmitter.h>');
  lines.push('#include <react/renderer/components/view/ViewProps.h>');
  lines.push('#include <react/renderer/componentregistry/ComponentDescriptorProvider.h>');
  lines.push('#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>');
  lines.push('#include <react/renderer/core/ConcreteComponentDescriptor.h>');
  lines.push('#include <react/renderer/core/EventDispatcher.h>');
  lines.push('#include <react/renderer/core/EventTarget.h>');
  lines.push('#include <react/renderer/core/PropsParserContext.h>');
  lines.push('#include <react/renderer/core/propsConversions.h>');
  lines.push('');
  lines.push('#include <cstdint>');
  lines.push('#include <string>');
  lines.push('#include <utility>');
  lines.push('');
  lines.push('namespace rnlinux::codegen {');
  lines.push('');

  // ─── Component name (string literal with stable linkage) ────────
  lines.push('// String literal with internal-but-unique linkage. Used as the');
  lines.push('// `NAME` template parameter of `ConcreteViewShadowNode<NAME, …>`,');
  lines.push('// which requires a `const char[]` with linkage.');
  lines.push(
    `inline constexpr const char ${componentName}ComponentName[] = ${quoteCppString(componentName)};`,
  );
  lines.push('');

  // ─── Event payload structs + EventEmitter ───────────────────────
  for (const event of def.events) {
    const payload = collectEventPayload(event, componentName);
    if (payload) {
      lines.push(...renderEventPayloadStruct(payload));
      lines.push('');
    }
  }

  lines.push(`class ${componentName}EventEmitter : public facebook::react::ViewEventEmitter {`);
  lines.push(' public:');
  // Explicit forwarding constructor. The `using ...EventEmitter`
  // shortcut chain doesn't propagate the upstream
  // EventEmitter(SharedEventTarget, EventDispatcher::Weak) all the
  // way through the BaseViewEventEmitter → TouchEventEmitter →
  // EventEmitter hop, so ConcreteComponentDescriptor::createFamily
  // can't find a matching ctor.
  lines.push(`  ${componentName}EventEmitter(facebook::react::SharedEventTarget eventTarget,`);
  lines.push(`                          facebook::react::EventDispatcher::Weak eventDispatcher)`);
  lines.push(
    `      : facebook::react::ViewEventEmitter(std::move(eventTarget), std::move(eventDispatcher)) {}`,
  );
  for (const event of def.events) {
    lines.push('');
    lines.push(...renderEventEmitterMethod(event, componentName));
  }
  lines.push('};');
  lines.push('');

  // ─── Props ──────────────────────────────────────────────────────
  lines.push(`class ${componentName}Props final : public facebook::react::ViewProps {`);
  lines.push(' public:');
  lines.push(`  ${componentName}Props() = default;`);
  lines.push(`  ${componentName}Props(const facebook::react::PropsParserContext& context,`);
  lines.push(`        const ${componentName}Props& sourceProps,`);
  lines.push(`        const facebook::react::RawProps& rawProps)`);
  lines.push(`      : facebook::react::ViewProps(context, sourceProps, rawProps)`);
  for (let i = 0; i < def.props.length; i++) {
    const prop = def.props[i];
    const mapped = propCppType(prop.typeAnnotation);
    const def0 = defaultExprForConvert(prop, mapped);
    lines.push(
      `      , ${prop.name}(facebook::react::convertRawProp(context, rawProps, ${quoteCppString(prop.name)}, sourceProps.${prop.name}, ${def0}))${i === def.props.length - 1 ? ' {}' : ''}`,
    );
  }
  if (def.props.length === 0) {
    // Trailing `{}` for the empty initializer-list case.
    lines[lines.length - 1] = lines[lines.length - 1] + ' {}';
  }
  lines.push('');
  for (const prop of def.props) {
    const mapped = propCppType(prop.typeAnnotation);
    lines.push(`  ${mapped.cpp} ${prop.name}${mapped.defaultExpr};`);
  }
  lines.push('};');
  lines.push('');

  // ─── ShadowNode + ComponentDescriptor ───────────────────────────
  lines.push(`class ${componentName}ShadowNode final`);
  lines.push(`    : public facebook::react::ConcreteViewShadowNode<${componentName}ComponentName,`);
  lines.push(`                                                     ${componentName}Props,`);
  lines.push(
    `                                                     ${componentName}EventEmitter> {`,
  );
  lines.push(' public:');
  lines.push('  using ConcreteViewShadowNode::ConcreteViewShadowNode;');
  lines.push('};');
  lines.push('');
  lines.push(
    `using ${componentName}ComponentDescriptor = facebook::react::ConcreteComponentDescriptor<${componentName}ShadowNode>;`,
  );
  lines.push('');

  // ─── Registration helper ────────────────────────────────────────
  lines.push('// Register the descriptor on a ComponentDescriptorProviderRegistry. ');
  lines.push('// Call from your component-registry bootstrap (or have it called by');
  lines.push('// autolinked.cmake for third-party deps).');
  lines.push(
    `inline void register${componentName}(facebook::react::ComponentDescriptorProviderRegistry& registry) {`,
  );
  lines.push(
    `  registry.add(facebook::react::concreteComponentDescriptorProvider<${componentName}ComponentDescriptor>());`,
  );
  lines.push('}');
  lines.push('');
  lines.push('} // namespace rnlinux::codegen');
  lines.push('');

  return lines.join('\n');
}

// ─── Event payload helpers ──────────────────────────────────────────

interface EventPayload {
  structName: string;
  fields: Array<{name: string; cpp: string; toJsiExpr: (cppVar: string, rt: string) => string}>;
}

function collectEventPayload(event: EventShape, componentName: string): EventPayload | null {
  const arg = event.typeAnnotation.argument;
  if (!arg) return null;
  if (arg.type !== 'ObjectTypeAnnotation') {
    throw new Error(`Event ${event.name} payload must be an ObjectTypeAnnotation; got ${arg.type}`);
  }
  const props =
    (arg as {properties?: Array<{name: string; typeAnnotation: TypeAnnotation}>}).properties ?? [];
  const eventStem = event.name.replace(/^on/, '');
  const structName = `${componentName}${eventStem}Event`;
  const fields = props.map(p => {
    const lowered = eventPayloadField(p.typeAnnotation);
    return {name: p.name, cpp: lowered.cpp, toJsiExpr: lowered.toJsiExpr};
  });
  return {structName, fields};
}

function renderEventPayloadStruct(p: EventPayload): string[] {
  const lines: string[] = [];
  lines.push(`struct ${p.structName} {`);
  for (const f of p.fields) {
    lines.push(`  ${f.cpp} ${f.name};`);
  }
  lines.push('};');
  return lines;
}

function renderEventEmitterMethod(event: EventShape, componentName: string): string[] {
  const stem = event.name.replace(/^on/, '');
  const jsEventName = stem.charAt(0).toLowerCase() + stem.slice(1);
  const payload = collectEventPayload(event, componentName);
  const lines: string[] = [];
  if (!payload) {
    // Payload-less event.
    lines.push(`  void ${event.name}() const {`);
    lines.push(
      `    dispatchEvent(${quoteCppString(jsEventName)}, [](facebook::jsi::Runtime& rt) {`,
    );
    lines.push('      return facebook::jsi::Object(rt);');
    lines.push('    });');
    lines.push('  }');
    return lines;
  }

  const ctorParams = payload.fields.map(f => `${f.cpp} ${f.name}`).join(', ');
  const captures = payload.fields.map(f => `${f.name} = std::move(${f.name})`).join(', ');
  lines.push(`  void ${event.name}(${ctorParams}) const {`);
  lines.push(`    dispatchEvent(${quoteCppString(jsEventName)},`);
  lines.push(`        [${captures || ''}](facebook::jsi::Runtime& rt) {`);
  lines.push('          auto payload = facebook::jsi::Object(rt);');
  for (const f of payload.fields) {
    const jsi = f.toJsiExpr(f.name, 'rt');
    lines.push(`          payload.setProperty(rt, ${quoteCppString(f.name)}, ${jsi});`);
  }
  lines.push('          return payload;');
  lines.push('        });');
  lines.push('  }');
  return lines;
}

// ─── convertRawProp default expression ──────────────────────────────

// `convertRawProp(..., sourceProps.<field>, <default>)` needs a
// typed expression for <default>. For string defaults we wrap in
// `std::string{...}` so overload resolution lands on the string
// specialization; for the rest the literal expression suffices.
function defaultExprForConvert(_prop: PropShape, mapped: PropCpp): string {
  // Defer to the literal in mapped.defaultExpr stripped of its
  // braces, with a type wrapper appropriate to the cpp type.
  const raw = mapped.defaultExpr.replace(/^\{|\}$/g, '');
  switch (mapped.cpp) {
    case 'std::string':
      return raw === '' ? 'std::string{}' : `std::string${mapped.defaultExpr}`;
    case 'int32_t':
      return `int32_t${mapped.defaultExpr}`;
    case 'double':
      return `double${mapped.defaultExpr}`;
    case 'float':
      return `float${mapped.defaultExpr}`;
    case 'bool':
      return raw;
    default:
      return raw;
  }
}
