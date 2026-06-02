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

interface CommandShape {
  name: string;
  optional?: boolean;
  typeAnnotation: {
    type: 'FunctionTypeAnnotation';
    params: Array<{name: string; typeAnnotation: TypeAnnotation}>;
    returnTypeAnnotation: TypeAnnotation;
  };
}

interface ComponentDef {
  extendsProps?: Array<{type: string; knownTypeName?: string}>;
  props: PropShape[];
  events: EventShape[];
  commands?: CommandShape[];
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

// Reserved RN graphics types — each has a dedicated `convertRawProp`
// specialization either in
// <react/renderer/core/propsConversions.h> (graphics types) or
// <react/renderer/components/image/conversions.h> (ImageSource).
// The default for an unset prop in JS lands as a default-constructed
// instance of the C++ type, which is what RN's other components do.
const RESERVED_RN_TYPES: Record<string, {cpp: string; extraInclude?: string}> = {
  ColorPrimitive: {cpp: 'facebook::react::SharedColor'},
  PointPrimitive: {cpp: 'facebook::react::Point'},
  EdgeInsetsPrimitive: {cpp: 'facebook::react::EdgeInsets'},
  DimensionPrimitive: {cpp: 'facebook::react::Float'},
  ImageSourcePrimitive: {
    cpp: 'facebook::react::ImageSource',
    extraInclude: '<react/renderer/components/image/conversions.h>',
  },
};

// Component-side object-prop struct collector. Mirrors the
// TurboModule generator's StructCollector but is scoped to one
// component's prop tree.
interface PropStructProperty {
  name: string;
  cppType: string;
  toDynamicExpr: string;
  fromDynamicExpr: string;
}

interface PropStructDef {
  name: string;
  properties: PropStructProperty[];
}

class PropStructCollector {
  readonly structs: PropStructDef[] = [];

  collect(name: string, t: TypeAnnotation): string {
    if (t.type !== 'ObjectTypeAnnotation') {
      throw new Error(
        `PropStructCollector.collect called with ${t.type}, expected ObjectTypeAnnotation`,
      );
    }
    const props =
      (t as {properties?: Array<{name: string; typeAnnotation: TypeAnnotation}>}).properties ?? [];
    const struct: PropStructDef = {name, properties: []};
    for (const prop of props) {
      let propType = prop.typeAnnotation;
      if (propType.type === 'NullableTypeAnnotation') {
        propType = (propType as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
      }
      const fieldName = prop.name;
      const propPascal = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
      const fieldExpr = `d["${fieldName}"]`;
      if (propType.type === 'ObjectTypeAnnotation') {
        const nestedName = `${name}_${propPascal}`;
        this.collect(nestedName, propType);
        struct.properties.push({
          name: fieldName,
          cppType: nestedName,
          toDynamicExpr: `toDynamic(v.${fieldName})`,
          fromDynamicExpr: `${nestedName}::fromDynamic(${fieldExpr})`,
        });
        continue;
      }
      if (
        propType.type === 'ArrayTypeAnnotation' ||
        propType.type === 'GenericObjectTypeAnnotation'
      ) {
        struct.properties.push({
          name: fieldName,
          cppType: 'folly::dynamic',
          toDynamicExpr: `v.${fieldName}`,
          fromDynamicExpr: fieldExpr,
        });
        continue;
      }
      const mapped = primitiveCppType(propType.type);
      struct.properties.push({
        name: fieldName,
        cppType: mapped,
        toDynamicExpr: `v.${fieldName}`,
        fromDynamicExpr: dynamicFieldAccessor(propType.type, fieldExpr),
      });
    }
    this.structs.push(struct);
    return name;
  }
}

function primitiveCppType(typeName: string): string {
  switch (typeName) {
    case 'StringTypeAnnotation':
      return 'std::string';
    case 'BooleanTypeAnnotation':
      return 'bool';
    case 'NumberTypeAnnotation':
    case 'DoubleTypeAnnotation':
      return 'double';
    case 'FloatTypeAnnotation':
      return 'float';
    case 'Int32TypeAnnotation':
      return 'int32_t';
    default:
      throw new Error(`No primitive C++ type for ${typeName}`);
  }
}

function dynamicFieldAccessor(typeName: string, fieldExpr: string): string {
  switch (typeName) {
    case 'StringTypeAnnotation':
      return `${fieldExpr}.asString()`;
    case 'BooleanTypeAnnotation':
      return `${fieldExpr}.asBool()`;
    case 'NumberTypeAnnotation':
    case 'DoubleTypeAnnotation':
    case 'FloatTypeAnnotation':
      return `${fieldExpr}.asDouble()`;
    case 'Int32TypeAnnotation':
      return `static_cast<int32_t>(${fieldExpr}.asInt())`;
    default:
      throw new Error(`No dynamic-field accessor for ${typeName}`);
  }
}

function renderPropStructDecls(structs: PropStructDef[]): string[] {
  const lines: string[] = [];
  for (const s of structs) {
    lines.push(`struct ${s.name} {`);
    for (const p of s.properties) {
      lines.push(`  ${p.cppType} ${p.name};`);
    }
    lines.push('');
    lines.push(`  static ${s.name} fromDynamic(const folly::dynamic& d) {`);
    if (s.properties.length === 0) {
      lines.push('    (void)d;');
      lines.push('    return {};');
    } else {
      lines.push('    return {');
      for (const p of s.properties) {
        lines.push(`        .${p.name} = ${p.fromDynamicExpr},`);
      }
      lines.push('    };');
    }
    lines.push('  }');
    lines.push('};');
    lines.push('');
    lines.push(`inline folly::dynamic toDynamic(const ${s.name}& v) {`);
    if (s.properties.length === 0) {
      lines.push('  return folly::dynamic::object();');
    } else {
      const head = '  return folly::dynamic::object';
      const tail = s.properties.map(p => `("${p.name}", ${p.toDynamicExpr})`).join('');
      lines.push(`${head}${tail};`);
    }
    lines.push('}');
    lines.push('');
    // ADL fromRawValue overload — RN's convertRawProp picks it up
    // for any field declared with this struct type.
    lines.push(`inline void fromRawValue(const facebook::react::PropsParserContext& /*context*/,`);
    lines.push(`                          const facebook::react::RawValue& value,`);
    lines.push(`                          ${s.name}& result) {`);
    lines.push(`  result = ${s.name}::fromDynamic(static_cast<folly::dynamic>(value));`);
    lines.push('}');
    lines.push('');
  }
  return lines;
}

function propCppType(
  t: TypeAnnotation & {default?: unknown},
  componentName: string,
  propName: string,
  structCollector?: PropStructCollector,
): PropCpp {
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
    case 'ReservedPropTypeAnnotation': {
      const reservedName = (inner as {name?: string}).name ?? '';
      const entry = RESERVED_RN_TYPES[reservedName];
      if (!entry) {
        throw new Error(
          `unsupported ReservedPropTypeAnnotation: "${reservedName}". ` +
            `Supported: ${Object.keys(RESERVED_RN_TYPES).join(', ')}.`,
        );
      }
      // Default to value-initialised — RN's convertRawProp will fill
      // it in from the raw value if present.
      return {cpp: entry.cpp, defaultExpr: '{}'};
    }
    case 'StringEnumTypeAnnotation': {
      const enumName = stringEnumTypeName(componentName, propName);
      const fallbackVar = `${enumName}::${enumCaseName(typeof def === 'string' ? def : '')}`;
      const defaultExpr =
        typeof def === 'string' && (inner as {options?: string[]}).options?.includes(def)
          ? `{${fallbackVar}}`
          : '{}';
      return {cpp: enumName, defaultExpr};
    }
    case 'Int32EnumTypeAnnotation': {
      const enumName = stringEnumTypeName(componentName, propName);
      const defaultExpr =
        typeof def === 'number' && (inner as {options?: number[]}).options?.includes(def)
          ? `{${enumName}::${intEnumCaseName(def)}}`
          : '{}';
      return {cpp: enumName, defaultExpr};
    }
    case 'ObjectTypeAnnotation': {
      if (!structCollector) {
        throw new Error('Object props require a struct collector');
      }
      const structName = `${componentName}${propName.charAt(0).toUpperCase() + propName.slice(1)}`;
      structCollector.collect(structName, inner);
      return {cpp: structName, defaultExpr: '{}'};
    }
    case 'ArrayTypeAnnotation': {
      const elementType = (inner as {elementType?: TypeAnnotation}).elementType;
      if (!elementType) {
        return {cpp: 'folly::dynamic', defaultExpr: '{}'};
      }
      let elem: TypeAnnotation = elementType;
      if (elem.type === 'NullableTypeAnnotation') {
        elem = (elem as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
      }
      if (elem.type === 'ObjectTypeAnnotation') {
        if (!structCollector) {
          return {cpp: 'folly::dynamic', defaultExpr: '{}'};
        }
        const elemName = `${componentName}${propName.charAt(0).toUpperCase() + propName.slice(1)}Item`;
        structCollector.collect(elemName, elem);
        return {cpp: `std::vector<${elemName}>`, defaultExpr: '{}'};
      }
      // Primitive element types map through the same primitive table
      // we use for fields; RN's std::vector<T> convertRawProp will
      // call the fromRawValue per element.
      try {
        const elemCpp = primitiveCppType(elem.type);
        return {cpp: `std::vector<${elemCpp}>`, defaultExpr: '{}'};
      } catch {
        return {cpp: 'folly::dynamic', defaultExpr: '{}'};
      }
    }
    default:
      throw new Error(
        `unsupported component prop type: ${inner.type}. ` +
          `Linux component codegen MVP covers boolean/string/Int32/Double/Float, ` +
          'ColorPrimitive/PointPrimitive/EdgeInsetsPrimitive/DimensionPrimitive, ' +
          'and StringEnumTypeAnnotation. ' +
          'Object/Array/ImageSource and Int32 enums are tracked follow-ups.',
      );
  }
}

function stringEnumTypeName(componentName: string, propName: string): string {
  return `${componentName}${propName.charAt(0).toUpperCase() + propName.slice(1)}`;
}

// Convert an enum-option JS string to a C++ enum-case name. Strips
// non-identifier chars, PascalCases, and prefixes a leading digit
// with `K` so it's a valid C++ identifier.
function enumCaseName(option: string): string {
  if (!option) return 'Unknown';
  const parts = option.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
  if (/^[0-9]/.test(joined)) return `K${joined}`;
  return joined || 'Unknown';
}

// Convert an Int32-enum numeric option to a C++ case name.
// `0` → `K0`, `-1` → `KNeg1`, etc.
function intEnumCaseName(option: number): string {
  if (option < 0) return `KNeg${Math.abs(option)}`;
  return `K${option}`;
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
  lines.push('#include <react/renderer/core/RawValue.h>');
  lines.push('#include <react/renderer/core/propsConversions.h>');
  lines.push('#include <react-native-linux/ComponentBootstrap.h>');
  lines.push('#include <react/renderer/graphics/Color.h>');
  lines.push('#include <react/renderer/graphics/Point.h>');
  lines.push('#include <react/renderer/graphics/RectangleEdges.h>');
  lines.push('#include <folly/dynamic.h>');
  // Conditional graphics-adjacent headers needed by any reserved
  // type the spec uses (e.g. ImageSource pulls in the image
  // component's conversions.h for its fromRawValue).
  for (const include of collectExtraIncludes(def)) {
    lines.push(`#include ${include}`);
  }
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

  // ─── Enums (string + int) — declarations + fromRawValue overload
  for (const prop of def.props) {
    let inner = prop.typeAnnotation as TypeAnnotation;
    if (inner.type === 'NullableTypeAnnotation') {
      inner = (inner as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
    }
    if (inner.type === 'StringEnumTypeAnnotation') {
      lines.push(...renderStringEnum(componentName, prop.name, inner));
      lines.push('');
    } else if (inner.type === 'Int32EnumTypeAnnotation') {
      lines.push(...renderInt32Enum(componentName, prop.name, inner));
      lines.push('');
    }
  }

  // ─── Object-prop structs (post-order) ───────────────────────────
  // Walk props once to register every ObjectTypeAnnotation reachable
  // from a prop or array element. Each struct gets toDynamic +
  // fromDynamic + fromRawValue emitted before the Props class.
  const propStructs = new PropStructCollector();
  for (const prop of def.props) {
    propCppType(prop.typeAnnotation, componentName, prop.name, propStructs);
  }
  if (propStructs.structs.length > 0) {
    lines.push(...renderPropStructDecls(propStructs.structs));
  }

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
    const mapped = propCppType(prop.typeAnnotation, componentName, prop.name, propStructs);
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
    const mapped = propCppType(prop.typeAnnotation, componentName, prop.name, propStructs);
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

  // ─── Commands dispatch helper ───────────────────────────────────
  const commands = def.commands ?? [];
  if (commands.length > 0) {
    lines.push(...renderCommandsHelper(componentName, commands));
    lines.push('');
  }

  // ─── Registration helpers ───────────────────────────────────────
  // 1) Direct registration on a caller-supplied registry. Useful
  //    for in-tree components that want explicit bootstrap order.
  lines.push('// Direct registration on a caller-supplied registry. Useful for');
  lines.push('// in-tree components that want explicit bootstrap order.');
  lines.push(
    `inline void register${componentName}(facebook::react::ComponentDescriptorProviderRegistry& registry) {`,
  );
  lines.push(
    `  registry.add(facebook::react::concreteComponentDescriptorProvider<${componentName}ComponentDescriptor>());`,
  );
  lines.push('}');
  lines.push('');
  // 2) Static-init registration via LinuxComponentBootstrap. Drop
  //    `static const int kReg<Name> = installComponent();` in your
  //    impl TU and the descriptor lands in every host registry the
  //    process builds. Same shape as TM's install<Impl>().
  lines.push('// Static-init registration via LinuxComponentBootstrap. Drop');
  lines.push('// `static const int kReg = installComponent();` in your impl TU and');
  lines.push('// the descriptor lands in every host registry the process builds.');
  lines.push("// Same shape as TM's install<Impl>().");
  lines.push(`inline int installComponent() {`);
  lines.push('  rnlinux::LinuxComponentBootstrap::registerInitializer(');
  lines.push(`      [](facebook::react::ComponentDescriptorProviderRegistry& registry) {`);
  lines.push(`        register${componentName}(registry);`);
  lines.push('      });');
  lines.push('  return 0;');
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
      // Reserved RN types and enums: `<Type>{<raw>}` covers both the
      // value-init case (empty raw → default-ctor) and the enum case
      // (raw is the qualified enum case name, e.g. `FooMode::Auto`).
      // For SharedColor / Point / EdgeInsets / typed enums, the
      // appropriate ctor is picked up by overload resolution.
      if (raw === '') return `${mapped.cpp}{}`;
      return raw;
  }
}

// Walk every prop and pull the extra-include set out of the
// RESERVED_RN_TYPES table for types the spec actually references.
// Returned items are include lines already wrapped in `<...>` /
// `"..."` so the emitter can splat them straight into the file.
function collectExtraIncludes(def: ComponentDef): string[] {
  const out = new Set<string>();
  for (const prop of def.props) {
    let inner = prop.typeAnnotation as TypeAnnotation;
    if (inner.type === 'NullableTypeAnnotation') {
      inner = (inner as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
    }
    if (inner.type === 'ReservedPropTypeAnnotation') {
      const reservedName = (inner as {name?: string}).name ?? '';
      const entry = RESERVED_RN_TYPES[reservedName];
      if (entry?.extraInclude) out.add(entry.extraInclude);
    }
  }
  return Array.from(out).sort();
}

// ─── StringEnum ────────────────────────────────────────────────────

function renderStringEnum(
  componentName: string,
  propName: string,
  t: TypeAnnotation & {options?: string[]; default?: string},
): string[] {
  const enumName = stringEnumTypeName(componentName, propName);
  const options = t.options ?? [];
  const cases = options.map(opt => ({jsName: opt, cppName: enumCaseName(opt)}));
  const lines: string[] = [];

  lines.push(`enum class ${enumName} {`);
  for (const c of cases) {
    lines.push(`  ${c.cppName},`);
  }
  lines.push('};');
  lines.push('');

  // RN's convertRawProp picks up a free-function `fromRawValue`
  // overload via ADL — emit one targetting our enum.
  lines.push(`inline void fromRawValue(const facebook::react::PropsParserContext& /*context*/,`);
  lines.push(`                          const facebook::react::RawValue& value,`);
  lines.push(`                          ${enumName}& result) {`);
  lines.push('  auto string = static_cast<std::string>(value);');
  for (const c of cases) {
    lines.push(
      `  if (string == ${quoteCppString(c.jsName)}) { result = ${enumName}::${c.cppName}; return; }`,
    );
  }
  lines.push('  // Unknown enum case — leave at default-initialised value.');
  lines.push('}');
  lines.push('');
  lines.push(`inline std::string toString(const ${enumName}& v) {`);
  lines.push('  switch (v) {');
  for (const c of cases) {
    lines.push(`    case ${enumName}::${c.cppName}: return ${quoteCppString(c.jsName)};`);
  }
  lines.push('  }');
  lines.push('  return "";');
  lines.push('}');

  return lines;
}

// ─── Commands ─────────────────────────────────────────────────────

// Per-primitive accessor for an arg lifted out of `args[i]` (a
// folly::dynamic). Mirrors the TM generator's fromDynamicForPrimitive
// but kept local since the component generator has its own scope.
function commandArgFromDynamic(typeName: string, expr: string): string {
  switch (typeName) {
    case 'StringTypeAnnotation':
      return `${expr}.asString()`;
    case 'BooleanTypeAnnotation':
      return `${expr}.asBool()`;
    case 'NumberTypeAnnotation':
    case 'DoubleTypeAnnotation':
    case 'FloatTypeAnnotation':
      return `${expr}.asDouble()`;
    case 'Int32TypeAnnotation':
      return `static_cast<int32_t>(${expr}.asInt())`;
    default:
      throw new Error(`No command-arg fromDynamic mapping for ${typeName}`);
  }
}

function renderCommandsHelper(componentName: string, commands: CommandShape[]): string[] {
  const lines: string[] = [];
  lines.push("// JS-dispatched imperative commands. Forward your view's ");
  lines.push('// handleCommand override into this helper; each spec command');
  lines.push('// unpacks its args from `folly::dynamic` and calls the matching');
  lines.push('// method on `view`. The view is templated so any concrete');
  lines.push('// LinuxComponentView subclass with the right methods plugs in.');
  lines.push('template <typename ViewT>');
  lines.push(
    `inline void ${componentName}HandleCommand(ViewT& view, const std::string& commandName, const folly::dynamic& args) {`,
  );
  for (const cmd of commands) {
    const params = cmd.typeAnnotation.params ?? [];
    lines.push(`  if (commandName == ${quoteCppString(cmd.name)}) {`);
    if (params.length > 0) {
      lines.push(`    if (args.size() < ${params.length}) return;`);
    }
    const callArgs: string[] = [];
    params.forEach((p, i) => {
      let argType = p.typeAnnotation;
      if (argType.type === 'NullableTypeAnnotation') {
        argType = (argType as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
      }
      const expr = commandArgFromDynamic(argType.type, `args[${i}]`);
      const localName = p.name || `arg${i}`;
      lines.push(`    auto ${localName} = ${expr};`);
      callArgs.push(`std::move(${localName})`);
    });
    lines.push(`    view.${cmd.name}(${callArgs.join(', ')});`);
    lines.push('    return;');
    lines.push('  }');
  }
  lines.push('  (void)view;');
  lines.push('  (void)args;');
  lines.push('}');
  return lines;
}

// Int32 enum — same shape as StringEnum, just keyed on integer
// options. The underlying type is pinned to int32_t so JS-to-C++
// width matches and switch-cases compile without sign warnings.
function renderInt32Enum(
  componentName: string,
  propName: string,
  t: TypeAnnotation & {options?: number[]; default?: number},
): string[] {
  const enumName = stringEnumTypeName(componentName, propName);
  const options = t.options ?? [];
  const cases = options.map(opt => ({jsValue: opt, cppName: intEnumCaseName(opt)}));
  const lines: string[] = [];

  lines.push(`enum class ${enumName} : int32_t {`);
  for (const c of cases) {
    lines.push(`  ${c.cppName} = ${c.jsValue},`);
  }
  lines.push('};');
  lines.push('');

  lines.push(`inline void fromRawValue(const facebook::react::PropsParserContext& /*context*/,`);
  lines.push(`                          const facebook::react::RawValue& value,`);
  lines.push(`                          ${enumName}& result) {`);
  lines.push('  auto i = static_cast<int32_t>(value);');
  for (const c of cases) {
    lines.push(`  if (i == ${c.jsValue}) { result = ${enumName}::${c.cppName}; return; }`);
  }
  lines.push('  // Unknown enum value — leave at default-initialised case.');
  lines.push('}');

  return lines;
}
