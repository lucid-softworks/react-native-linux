// Linux TurboModule header generator.
//
// Takes a NativeModuleSchema (from `@react-native/codegen`'s parser)
// and emits a self-contained C++ header that:
//
//   • Declares an abstract `<SpecName>Spec` extending
//     `rnlinux::TurboModule` (which is `facebook::jsi::HostObject`).
//   • One pure virtual per method, with C++ types mapped from the
//     spec via `mapType`.
//   • Inline overrides of `get(rt, name)` and `getPropertyNames(rt)`
//     that dispatch every spec method to the virtuals via
//     `facebook::jsi::Function::createFromHostFunction`.
//
// The implementer subclasses the spec and overrides one virtual per
// method — no JSI plumbing in user code. See
// vnext/src/modules/PlatformConstants.cpp for a worked example.

import {mapType, type TypeAnnotation} from './types';

// ─── Struct collection ───────────────────────────────────────────────
//
// ObjectTypeAnnotations get materialised as C++ structs with a
// `toDynamic()` free function and an inline brace-init constructor.
// Names are derived from the spec path so nested types stay readable.

interface StructProperty {
  name: string;
  cppType: string;
  // Expression that serialises the C++ value back into a
  // folly::dynamic field. Built at collection time so the emitter
  // can render `toDynamic` without re-walking the schema.
  toDynamicExpr: string;
  // The inverse: an expression that reads `d["<name>"]` and lowers
  // it back to the C++ type. Lets the dispatcher hand a populated
  // struct (rather than a default-constructed shell) to the
  // implementer for object-typed params.
  fromDynamicExpr: string;
}

interface StructDef {
  name: string;
  properties: StructProperty[];
}

// Per-primitive fromDynamic field accessor. Mirrors the toJsi /
// fromJsi table in types.ts but targets folly::dynamic.
function fromDynamicForPrimitive(typeName: string, fieldExpr: string): string {
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
      throw new Error(`No fromDynamic mapping for primitive ${typeName}`);
  }
}

class StructCollector {
  // Insertion order matters — we emit declarations in collection
  // order, which is post-order (nested → outer), so a struct never
  // references one that hasn't been declared yet.
  readonly structs: StructDef[] = [];

  // Names already registered. Lets aliasMap-driven preregistration
  // skip re-emitting the same struct when method-side calls land
  // on a known alias.
  private readonly registered = new Set<string>();

  // Resolution table for TypeAliasTypeAnnotation → underlying
  // ObjectTypeAnnotation. Populated by `prepopulateAliasMap` before
  // any method-side collection so an alias reference inside a
  // method (or inside another alias's field) lands on the pre-
  // registered name instead of synthesising a duplicate.
  private readonly aliasMap = new Map<string, TypeAnnotation>();

  // Pre-register every alias defined by the parser at
  // `schema.aliasMap[<Name>]`. Each entry becomes a struct named
  // after the alias itself; nested aliases inside one alias's
  // fields resolve through this same table.
  prepopulateAliasMap(aliasMap: Record<string, TypeAnnotation> | undefined): void {
    if (!aliasMap) return;
    for (const name of Object.keys(aliasMap)) {
      this.aliasMap.set(name, aliasMap[name]);
    }
    for (const name of Object.keys(aliasMap)) {
      this.collect(name, aliasMap[name]);
    }
  }

  // Visit an ObjectTypeAnnotation, register it under `name`, and
  // return that name. If `t` is a TypeAliasTypeAnnotation, resolves
  // to the alias name (already registered) without re-emitting.
  // Recurses into nested object fields.
  collect(name: string, t: TypeAnnotation): string {
    if (t.type === 'TypeAliasTypeAnnotation') {
      const aliasName = (t as {name?: string}).name;
      if (aliasName) return aliasName;
      throw new Error('TypeAliasTypeAnnotation without a name');
    }
    if (t.type !== 'ObjectTypeAnnotation') {
      throw new Error(
        `StructCollector.collect called with ${t.type}, expected ObjectTypeAnnotation`,
      );
    }
    if (this.registered.has(name)) return name;
    this.registered.add(name);
    const props =
      (
        t as {
          properties?: Array<{name: string; typeAnnotation: TypeAnnotation; optional?: boolean}>;
        }
      ).properties ?? [];
    const struct: StructDef = {name, properties: []};
    for (const prop of props) {
      // Nullable<T> reduces to T in the MVP — same simplification as
      // the rest of the type mapper.
      let propType: TypeAnnotation = prop.typeAnnotation;
      if (propType.type === 'NullableTypeAnnotation') {
        propType = (propType as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
      }
      const fieldName = prop.name;
      const propPascal = pascalCase(fieldName);
      const fieldExpr = `d["${fieldName}"]`;
      if (propType.type === 'TypeAliasTypeAnnotation') {
        const aliasName = (propType as {name?: string}).name;
        if (!aliasName) throw new Error('alias ref without a name');
        struct.properties.push({
          name: fieldName,
          cppType: aliasName,
          toDynamicExpr: `toDynamic(v.${fieldName})`,
          fromDynamicExpr: `${aliasName}::fromDynamic(${fieldExpr})`,
        });
        continue;
      }
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
      // Arrays / generic objects stay as folly::dynamic for the MVP.
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
      const mapped = mapType(propType, 'return');
      struct.properties.push({
        name: fieldName,
        cppType: mapped.cpp,
        toDynamicExpr: `v.${fieldName}`,
        fromDynamicExpr: fromDynamicForPrimitive(propType.type, fieldExpr),
      });
    }
    this.structs.push(struct);
    return name;
  }
}

function pascalCase(s: string): string {
  if (!s) return s;
  const parts = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return parts.map(p => p[0].toUpperCase() + p.slice(1)).join('');
}

function renderStructDecls(structs: StructDef[]): string[] {
  const lines: string[] = [];
  for (const s of structs) {
    lines.push(`struct ${s.name} {`);
    for (const p of s.properties) {
      lines.push(`  ${p.cppType} ${p.name};`);
    }
    // Symmetrical fromDynamic: build a populated struct from a
    // folly::dynamic object. The implementer-facing dispatcher uses
    // this to convert jsi::Value-typed params to typed C++ before
    // calling the user's virtual.
    lines.push('');
    lines.push(`  static ${s.name} fromDynamic(const folly::dynamic& d) {`);
    if (s.properties.length === 0) {
      lines.push(`    (void)d;`);
      lines.push(`    return {};`);
    } else {
      lines.push(`    return {`);
      for (const p of s.properties) {
        lines.push(`        .${p.name} = ${p.fromDynamicExpr},`);
      }
      lines.push(`    };`);
    }
    lines.push(`  }`);
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
  }
  return lines;
}

interface MethodShape {
  name: string;
  optional: boolean;
  typeAnnotation: {
    type: 'FunctionTypeAnnotation';
    params: Array<{name: string; typeAnnotation: TypeAnnotation; optional?: boolean}>;
    returnTypeAnnotation: TypeAnnotation;
  };
}

interface NativeModuleSchema {
  type: 'NativeModule';
  moduleName: string;
  spec: {methods: MethodShape[]};
}

// Top-level container for one spec file. The CLI/script entry point
// hands one of these into `generateModule` per parsed module.
export interface SpecModule {
  // The TypeScript module name — strips the leading `Native` (e.g.
  // `NativePlatformConstantsLinux`). Drives the output filename
  // (`<specName>Spec.h`) and the C++ class name.
  specName: string;
  // The runtime module name as it appears in
  // `TurboModuleRegistry.get('Foo')` — distinct from specName.
  moduleName: string;
  schema: NativeModuleSchema;
}

export interface GenerateOptions {
  // Filename header banner. Defaults to a generic marker.
  banner?: string;
}

// Render a single spec module as `<specName>Spec.h`. Returns the
// header contents; the caller decides where on disk it goes.
export function generateModule(mod: SpecModule, opts: GenerateOptions = {}): string {
  const {specName, moduleName, schema} = mod;
  const banner =
    opts.banner ??
    `// Auto-generated by @lucid-softworks/react-native-linux-codegen.\n// Source: ${specName}.ts (module: ${moduleName}). DO NOT EDIT.`;

  const methods = schema.spec.methods;
  const className = `${specName}Spec`;

  // Phase 1: collect every ObjectTypeAnnotation reachable from a
  // method param or return into a flat list of structs (post-order,
  // so declarations precede their references). Aliases from the
  // parser's aliasMap are pre-registered under their declared
  // names so shared types resolve to a single struct instead of
  // duplicating per use site.
  const structs = new StructCollector();
  structs.prepopulateAliasMap((schema as {aliasMap?: Record<string, TypeAnnotation>}).aliasMap);
  const methodMeta = methods.map(method => bindMethodStructs(method, structs));

  const lines: string[] = [];
  lines.push(banner);
  lines.push('');
  lines.push('#pragma once');
  lines.push('');
  lines.push('#include <jsi/jsi.h>');
  lines.push('#include <jsi/JSIDynamic.h>');
  lines.push('#include <react-native-linux/RuntimeExecutor.h>');
  lines.push('#include <react-native-linux/TurboModuleRegistry.h>');
  lines.push('#include <folly/dynamic.h>');
  lines.push('');
  lines.push('#include <cstdint>');
  lines.push('#include <functional>');
  lines.push('#include <memory>');
  lines.push('#include <string>');
  lines.push('#include <utility>');
  lines.push('#include <vector>');
  lines.push('');
  lines.push('namespace rnlinux::codegen {');
  lines.push('');
  if (structs.structs.length > 0) {
    lines.push('// ─── Spec object types ──────────────────────────────────────────');
    lines.push('');
    lines.push(...renderStructDecls(structs.structs));
  }
  lines.push(`class ${className} : public rnlinux::TurboModule {`);
  lines.push(' public:');
  lines.push(`  static constexpr const char* kModuleName = "${moduleName}";`);
  lines.push('');
  lines.push('  // One-liner registration: instantiate this in a static');
  lines.push('  // initializer to register the implementation under');
  lines.push('  // kModuleName at library load time. Returns an int so it');
  lines.push('  // can be assigned to a `static auto` for the init slot.');
  lines.push('  template <typename Impl>');
  lines.push('  static int install() {');
  lines.push('    rnlinux::TurboModuleRegistry::instance().registerModule(');
  lines.push('        kModuleName,');
  lines.push('        [](facebook::jsi::Runtime&) -> std::shared_ptr<rnlinux::TurboModule> {');
  lines.push('          return std::make_shared<Impl>();');
  lines.push('        });');
  lines.push('    return 0;');
  lines.push('  }');
  lines.push('');
  lines.push('  // Implementer overrides one virtual per spec method.');
  methodMeta.forEach((meta, idx) => {
    lines.push(`  ${renderVirtualSignature(methods[idx], meta)} = 0;`);
  });
  lines.push('');
  lines.push('  // JSI dispatch (do not override).');
  lines.push(
    '  facebook::jsi::Value get(facebook::jsi::Runtime& rt, const facebook::jsi::PropNameID& name) override {',
  );
  lines.push('    const auto methodName = name.utf8(rt);');
  methodMeta.forEach((meta, idx) => {
    lines.push(
      ...renderDispatchBranch(methods[idx], meta)
        .split('\n')
        .map(l => `    ${l}`),
    );
  });
  lines.push('    return facebook::jsi::Value::undefined();');
  lines.push('  }');
  lines.push('');
  lines.push(
    '  std::vector<facebook::jsi::PropNameID> getPropertyNames(facebook::jsi::Runtime& rt) override {',
  );
  lines.push('    std::vector<facebook::jsi::PropNameID> out;');
  lines.push(`    out.reserve(${methods.length});`);
  for (const method of methods) {
    lines.push(`    out.emplace_back(facebook::jsi::PropNameID::forUtf8(rt, "${method.name}"));`);
  }
  lines.push('    return out;');
  lines.push('  }');
  lines.push('};');
  lines.push('');
  lines.push('} // namespace rnlinux::codegen');
  lines.push('');

  return lines.join('\n');
}

// Per-method metadata produced by the struct-collection pass. Keeps
// the generated struct names for each ObjectType-typed position so
// the renderer doesn't have to re-walk the schema.
interface MethodStructMeta {
  // The struct name for each method param indexed by position, or
  // undefined for non-object params.
  paramStructs: Array<string | undefined>;
  // The struct name for the return type, or for the Promise element
  // type if the return is `Promise<Object>`. undefined for
  // non-object returns.
  returnStruct: string | undefined;
  // For each method param indexed by position: if the param is a
  // callback, the struct names of its individual args (parallel
  // to the callback's args list). undefined for non-callback params,
  // and entries within are undefined for non-object callback args.
  callbackArgStructs: Array<Array<string | undefined> | undefined>;
}

function bindMethodStructs(method: MethodShape, structs: StructCollector): MethodStructMeta {
  const methodPascal = pascalCase(method.name);
  const callbackArgStructs: Array<Array<string | undefined> | undefined> = [];

  const paramStructs: Array<string | undefined> = method.typeAnnotation.params.map((p, i) => {
    let t = p.typeAnnotation;
    if (t.type === 'NullableTypeAnnotation') {
      t = (t as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
    }
    if (t.type === 'TypeAliasTypeAnnotation') {
      callbackArgStructs.push(undefined);
      return (t as {name?: string}).name;
    }
    if (t.type === 'ObjectTypeAnnotation') {
      callbackArgStructs.push(undefined);
      const name = `${methodPascal}Param_${pascalCase(p.name || `Arg${i}`)}`;
      return structs.collect(name, t);
    }
    if (t.type === 'FunctionTypeAnnotation') {
      // Callback param. Walk its args and collect ObjectType ones
      // into the same collector so they're available to both the
      // virtual signature renderer and the callback wrapper.
      const cbName = pascalCase(p.name || `Cb${i}`);
      const cbParams =
        (t as {params?: Array<{name?: string; typeAnnotation: TypeAnnotation}>}).params ?? [];
      const argNames: Array<string | undefined> = cbParams.map((cp, ci) => {
        let argType = cp.typeAnnotation;
        if (argType.type === 'NullableTypeAnnotation') {
          argType = (argType as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
        }
        if (argType.type === 'TypeAliasTypeAnnotation') {
          return (argType as {name?: string}).name;
        }
        if (argType.type === 'ObjectTypeAnnotation') {
          const name = `${methodPascal}_${cbName}_${pascalCase(cp.name || `Arg${ci}`)}`;
          return structs.collect(name, argType);
        }
        return undefined;
      });
      callbackArgStructs.push(argNames);
      return undefined;
    }
    callbackArgStructs.push(undefined);
    return undefined;
  });

  let returnStruct: string | undefined;
  const ret = method.typeAnnotation.returnTypeAnnotation;
  if (ret.type === 'TypeAliasTypeAnnotation') {
    returnStruct = (ret as {name?: string}).name;
  } else if (ret.type === 'ObjectTypeAnnotation') {
    returnStruct = structs.collect(`${methodPascal}Result`, ret);
  } else if (ret.type === 'PromiseTypeAnnotation') {
    const elem = (ret as {elementType?: TypeAnnotation}).elementType;
    if (elem && elem.type === 'TypeAliasTypeAnnotation') {
      returnStruct = (elem as {name?: string}).name;
    } else if (elem && elem.type === 'ObjectTypeAnnotation') {
      returnStruct = structs.collect(`${methodPascal}Result`, elem);
    }
  }
  return {paramStructs, returnStruct, callbackArgStructs};
}

function isPromise(t: TypeAnnotation): boolean {
  return t.type === 'PromiseTypeAnnotation';
}

function paramCppType(
  t: TypeAnnotation,
  structName: string | undefined,
  callbackArgStructs?: Array<string | undefined>,
): string {
  let inner: TypeAnnotation = t;
  if (inner.type === 'NullableTypeAnnotation') {
    inner = (inner as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
  }
  if (inner.type === 'ObjectTypeAnnotation' || inner.type === 'TypeAliasTypeAnnotation') {
    return structName!;
  }
  if (inner.type === 'FunctionTypeAnnotation') {
    // Callback param. Resolve each arg's C++ type with the matching
    // struct name from the collector for ObjectType / alias args.
    const fn = inner as {
      params?: Array<{name?: string; typeAnnotation: TypeAnnotation}>;
      returnTypeAnnotation?: TypeAnnotation;
    };
    const cbArgs = (fn.params ?? []).map((p, i) => {
      let argType = p.typeAnnotation;
      if (argType.type === 'NullableTypeAnnotation') {
        argType = (argType as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
      }
      if (argType.type === 'ObjectTypeAnnotation' || argType.type === 'TypeAliasTypeAnnotation') {
        return callbackArgStructs?.[i] ?? 'folly::dynamic';
      }
      return mapType(argType, 'param').cpp;
    });
    const ret = fn.returnTypeAnnotation ?? {type: 'VoidTypeAnnotation'};
    if (ret.type === 'VoidTypeAnnotation') {
      return `std::function<void(${cbArgs.join(', ')})>`;
    }
    if (
      ret.type === 'PromiseTypeAnnotation' ||
      ret.type === 'ObjectTypeAnnotation' ||
      ret.type === 'TypeAliasTypeAnnotation' ||
      ret.type === 'ArrayTypeAnnotation' ||
      ret.type === 'GenericObjectTypeAnnotation' ||
      ret.type === 'FunctionTypeAnnotation'
    ) {
      throw new Error(
        `Callback return type "${ret.type}" is not yet supported by the Linux ` +
          'generator. Only void and primitive callback returns lower today; ' +
          'typed-object / Promise returns from a sync callback would need extra ' +
          'plumbing on the user side and are tracked as a follow-up.',
      );
    }
    // Primitives lower straight into the std::function signature.
    const retCpp = mapType(ret, 'return').cpp;
    return `std::function<${retCpp}(${cbArgs.join(', ')})>`;
  }
  return mapType(inner, 'param').cpp;
}

function returnCppType(t: TypeAnnotation, structName: string | undefined): string {
  let inner: TypeAnnotation = t;
  if (inner.type === 'NullableTypeAnnotation') {
    inner = (inner as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
  }
  if (inner.type === 'ObjectTypeAnnotation' || inner.type === 'TypeAliasTypeAnnotation') {
    return structName!;
  }
  return mapType(inner, 'return').cpp;
}

function renderVirtualSignature(method: MethodShape, meta: MethodStructMeta): string {
  const params = method.typeAnnotation.params.map((p, i) => {
    const cppType = paramCppType(
      p.typeAnnotation,
      meta.paramStructs[i],
      meta.callbackArgStructs[i],
    );
    const argName = p.name || `arg${i}`;
    return `${cppType} ${argName}`;
  });
  const ret = method.typeAnnotation.returnTypeAnnotation;
  if (isPromise(ret)) {
    const elem = (ret as {elementType?: TypeAnnotation}).elementType;
    const isElemObjectish =
      elem && (elem.type === 'ObjectTypeAnnotation' || elem.type === 'TypeAliasTypeAnnotation');
    const resolveCpp =
      elem && elem.type === 'VoidTypeAnnotation'
        ? null
        : isElemObjectish
          ? meta.returnStruct!
          : elem
            ? mapType(elem, 'return').cpp
            : null;
    const resolveSig =
      resolveCpp === null
        ? 'std::function<void()> resolve'
        : `std::function<void(${resolveCpp})> resolve`;
    const rejectSig = 'std::function<void(folly::dynamic)> reject';
    const all = [...params, resolveSig, rejectSig].join(', ');
    return `virtual void ${method.name}(${all})`;
  }
  const retCpp = returnCppType(ret, meta.returnStruct);
  return `virtual ${retCpp} ${method.name}(${params.join(', ')})`;
}

interface UnpackedParam {
  // Local variable name as it appears in the unpack line and the
  // executor capture list. Same as the spec param name (or `argN`).
  varName: string;
}

function isCallback(t: TypeAnnotation): boolean {
  return t.type === 'FunctionTypeAnnotation';
}

function isObject(t: TypeAnnotation): boolean {
  let inner = t;
  if (inner.type === 'NullableTypeAnnotation') {
    inner = (inner as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
  }
  return inner.type === 'ObjectTypeAnnotation' || inner.type === 'TypeAliasTypeAnnotation';
}

function renderDispatchBranch(method: MethodShape, meta: MethodStructMeta): string {
  const params = method.typeAnnotation.params;
  const paramCount = params.length;
  const ret = method.typeAnnotation.returnTypeAnnotation;

  // Body lines are rendered at the indent level that matches the
  // surrounding lambda body (8 spaces here; an outer 4 gets added
  // when the branch is composed into the dispatcher).
  const BODY = '        ';
  const unpackLines: string[] = [];
  const unpacked: UnpackedParam[] = [];

  const hasCallback = params.some(p => isCallback(p.typeAnnotation));
  const needsExecutor = hasCallback || isPromise(ret);
  if (needsExecutor) {
    unpackLines.push(`${BODY}auto __executor = rnlinux::getRuntimeExecutor();`);
  }

  params.forEach((p, i) => {
    const argName = p.name || `arg${i}`;
    if (isCallback(p.typeAnnotation)) {
      unpackLines.push(
        ...renderCallbackUnpack(p.typeAnnotation, argName, i, BODY, meta.callbackArgStructs[i]),
      );
    } else if (isObject(p.typeAnnotation)) {
      // Object params: jsi::Value → folly::dynamic → typed struct.
      // The struct's static fromDynamic does the field-by-field
      // pull so the implementer's virtual receives a populated
      // value, not a default-constructed shell.
      const structName = meta.paramStructs[i]!;
      unpackLines.push(
        `${BODY}auto ${argName} = ${structName}::fromDynamic(facebook::jsi::dynamicFromValue(rt_, args[${i}]));`,
      );
    } else {
      const pType = mapType(p.typeAnnotation, 'param');
      const unpack = pType.fromJsi!(`args[${i}]`, 'rt_');
      unpackLines.push(`${BODY}auto ${argName} = ${unpack};`);
    }
    unpacked.push({varName: argName});
  });

  if (isPromise(ret)) {
    return renderPromiseDispatchBranch(method, meta, unpackLines, unpacked, BODY);
  }

  const callArgs = unpacked.map(u => `std::move(${u.varName})`).join(', ');
  const callExpr = `this->${method.name}(${callArgs})`;

  let returnExpr: string;
  if (isObject(ret)) {
    unpackLines.push(`${BODY}auto __result = ${callExpr};`);
    returnExpr = 'facebook::jsi::valueFromDynamic(rt_, toDynamic(__result))';
  } else {
    const retType = mapType(ret, 'return');
    if (retType.cpp === 'void') {
      unpackLines.push(`${BODY}${callExpr};`);
      returnExpr = 'facebook::jsi::Value::undefined()';
    } else {
      unpackLines.push(`${BODY}auto __result = ${callExpr};`);
      returnExpr = retType.toJsi!('__result', 'rt_');
    }
  }

  return [
    `if (methodName == "${method.name}") {`,
    `  return facebook::jsi::Function::createFromHostFunction(`,
    `      rt,`,
    `      facebook::jsi::PropNameID::forUtf8(rt, "${method.name}"),`,
    `      /*paramCount=*/${paramCount},`,
    `      [this](facebook::jsi::Runtime& rt_, const facebook::jsi::Value& /*thisVal*/,`,
    `             const facebook::jsi::Value* ${paramCount > 0 ? 'args' : '/*args*/'},`,
    `             size_t /*count*/) -> facebook::jsi::Value {`,
    ...unpackLines,
    `${BODY}return ${returnExpr};`,
    `      });`,
    `}`,
  ].join('\n');
}

// Unpack a callback (Function-typed) param as a std::function. The
// jsi::Function is wrapped via shared_ptr (jsi::Function is move-only,
// std::function needs CopyConstructible), and the std::function body
// hops to the JS thread via __executor before calling. C++ args
// supplied by the user are moved into the executor's inner-lambda
// capture and converted to jsi::Value on the JS-thread side.
//
// MVP only supports void-returning callbacks (`(...args) => void`),
// which covers ~every TM spec in the wild (success/error /
// onProgress / onChange patterns). Non-void returns throw earlier
// from `mapType`.
function renderCallbackUnpack(
  t: TypeAnnotation,
  varName: string,
  argIndex: number,
  BODY: string,
  argStructs?: Array<string | undefined>,
): string[] {
  const fn = t as {
    params?: Array<{name?: string; typeAnnotation: TypeAnnotation}>;
    returnTypeAnnotation?: TypeAnnotation;
  };
  const cbParams = fn.params ?? [];
  const argInfos = cbParams.map((p, i) => {
    let argType = p.typeAnnotation;
    if (argType.type === 'NullableTypeAnnotation') {
      argType = (argType as unknown as {typeAnnotation: TypeAnnotation}).typeAnnotation;
    }
    const name = p.name || `a${i}`;

    if (argType.type === 'ObjectTypeAnnotation') {
      const structName = argStructs?.[i];
      if (!structName) {
        throw new Error(
          `Internal: callback arg "${name}" is an object but has no collected struct name`,
        );
      }
      return {
        cppType: structName,
        name,
        // Object args land as a typed C++ struct in user code and
        // are converted back through the generated toDynamic helper
        // before being handed to JS.
        toJsi: (cppValue: string, rt: string) =>
          `facebook::jsi::valueFromDynamic(${rt}, toDynamic(${cppValue}))`,
      };
    }

    const cppType = mapType(argType, 'param').cpp;
    const toJsi = mapType(argType, 'param').toJsi;
    if (!toJsi) {
      throw new Error(
        `Callback arg "${name}" has type ${argType.type} which has no toJsi mapping — ` +
          'nested callbacks / unsupported types are not yet handled.',
      );
    }
    return {cppType, name, toJsi};
  });

  const fnSig = argInfos.map(a => `${a.cppType} ${a.name}`).join(', ');
  const callArgs = argInfos.map(a => a.toJsi(`__cb_${a.name}`, '__rt')).join(', ');
  const moveCaptures =
    argInfos.length === 0
      ? ''
      : ', ' + argInfos.map(a => `__cb_${a.name} = std::move(${a.name})`).join(', ');

  const ret = fn.returnTypeAnnotation ?? {type: 'VoidTypeAnnotation'};
  const isVoid = ret.type === 'VoidTypeAnnotation';

  // jsi::Function isn't copy-constructible; wrap in shared_ptr so the
  // std::function holding it can be passed by value into the virtual.
  if (isVoid) {
    const cppType = `std::function<void(${argInfos.map(a => a.cppType).join(', ')})>`;
    return [
      `${BODY}auto __fn_${varName} = std::make_shared<facebook::jsi::Function>(`,
      `${BODY}    args[${argIndex}].asObject(rt_).asFunction(rt_));`,
      `${BODY}${cppType} ${varName} =`,
      `${BODY}    [__fn_${varName}, __executor](${fnSig}) mutable {`,
      `${BODY}      if (!__executor) return;`,
      `${BODY}      __executor([__fn_${varName}${moveCaptures}](facebook::jsi::Runtime& __rt) mutable {`,
      `${BODY}        __fn_${varName}->call(__rt${callArgs ? ', ' + callArgs : ''});`,
      `${BODY}      });`,
      `${BODY}    };`,
    ];
  }

  // Non-void: synchronous, on-JS-thread only. Capture the runtime by
  // pointer (rt_ outlives the host function on the JS thread) and
  // convert the jsi::Value return through the per-primitive fromJsi
  // mapping. mapType has already gate-checked that `ret` is a
  // supported primitive — typed-object / Promise returns from a
  // sync callback would need more plumbing and are tracked as a
  // follow-up.
  const retMapped = mapType(ret, 'return');
  const cppType = `std::function<${retMapped.cpp}(${argInfos.map(a => a.cppType).join(', ')})>`;
  const syncCallArgs = argInfos.map(a => a.toJsi(`__cb_${a.name}`, '(*__rt_ptr)')).join(', ');
  const fromJsi = retMapped.fromJsi!('__jsResult', '(*__rt_ptr)');
  const lines: string[] = [];
  lines.push(`${BODY}auto __fn_${varName} = std::make_shared<facebook::jsi::Function>(`);
  lines.push(`${BODY}    args[${argIndex}].asObject(rt_).asFunction(rt_));`);
  lines.push(`${BODY}// Non-void return: synchronous JS call. Must be invoked on the JS`);
  lines.push(`${BODY}// thread — captures rt_ by pointer (the runtime outlives the host`);
  lines.push(`${BODY}// function on the JS thread, but std::function won't itself enforce`);
  lines.push(`${BODY}// the thread).`);
  lines.push(`${BODY}facebook::jsi::Runtime* __rt_ptr_${varName} = &rt_;`);
  lines.push(`${BODY}${cppType} ${varName} =`);
  lines.push(
    `${BODY}    [__fn_${varName}, __rt_ptr = __rt_ptr_${varName}](${fnSig}) mutable -> ${retMapped.cpp} {`,
  );
  for (const a of argInfos) {
    lines.push(`${BODY}      auto __cb_${a.name} = std::move(${a.name});`);
  }
  lines.push(
    `${BODY}      auto __jsResult = __fn_${varName}->call(*__rt_ptr${syncCallArgs ? ', ' + syncCallArgs : ''});`,
  );
  lines.push(`${BODY}      return ${fromJsi};`);
  lines.push(`${BODY}    };`);
  return lines;
}

// Promise-returning methods: the host function constructs a JS
// Promise via the global Promise constructor and threads
// resolve/reject as std::function callbacks into the virtual. The
// virtual's resolve takes the C++ form of Promise<T>'s element; the
// reject always takes folly::dynamic (jsi-convertible).
//
// Resolve / reject lambdas hop back via the host's RuntimeExecutor
// before touching the runtime, so user code can call them off-thread.
function renderPromiseDispatchBranch(
  method: MethodShape,
  meta: MethodStructMeta,
  unpackLines: string[],
  unpacked: UnpackedParam[],
  BODY: string,
): string {
  const ret = method.typeAnnotation.returnTypeAnnotation;
  const elem = (ret.elementType as TypeAnnotation) ?? {type: 'VoidTypeAnnotation'};
  const paramCount = method.typeAnnotation.params.length;

  // Resolve / reject lambdas hop back to the JS thread via the
  // host's RuntimeExecutor before touching the runtime, so user code
  // can call them off-thread. The C++ resolve-arg type depends on
  // the Promise element type (void / primitive / generated struct).
  let resolveLambda: string;
  if (elem.type === 'VoidTypeAnnotation') {
    resolveLambda =
      'std::function<void()> resolve = [resolveFn, __executor]() { ' +
      'if (!__executor) return; ' +
      '__executor([resolveFn](facebook::jsi::Runtime& __rt) { ' +
      'resolveFn->call(__rt, facebook::jsi::Value::undefined()); ' +
      '}); };';
  } else if (elem.type === 'ObjectTypeAnnotation' || elem.type === 'TypeAliasTypeAnnotation') {
    const structName = meta.returnStruct!;
    resolveLambda =
      `std::function<void(${structName})> resolve = ` +
      `[resolveFn, __executor](${structName} value) mutable { ` +
      `if (!__executor) return; ` +
      `__executor([resolveFn, __value = std::move(value)](facebook::jsi::Runtime& __rt) mutable { ` +
      `resolveFn->call(__rt, facebook::jsi::valueFromDynamic(__rt, toDynamic(__value))); ` +
      `}); };`;
  } else {
    const resolveCpp = mapType(elem, 'return').cpp;
    const toJsi = mapType(elem, 'return').toJsi!('__value', '__rt');
    resolveLambda =
      `std::function<void(${resolveCpp})> resolve = ` +
      `[resolveFn, __executor](${resolveCpp} value) mutable { ` +
      `if (!__executor) return; ` +
      `__executor([resolveFn, __value = std::move(value)](facebook::jsi::Runtime& __rt) mutable { ` +
      `resolveFn->call(__rt, ${toJsi}); ` +
      `}); };`;
  }

  const rejectLambda =
    'std::function<void(folly::dynamic)> reject = ' +
    '[rejectFn, __executor](folly::dynamic value) mutable { ' +
    'if (!__executor) return; ' +
    '__executor([rejectFn, __value = std::move(value)](facebook::jsi::Runtime& __rt) mutable { ' +
    'rejectFn->call(__rt, facebook::jsi::valueFromDynamic(__rt, __value)); ' +
    '}); };';

  // Capture-by-move (init-capture) so the executor owns the unpacked
  // args even though the outer host function lambda has already
  // returned by the time the JS engine calls the executor. Also
  // capture __executor by value so the resolve/reject lambdas can
  // hop back to the JS thread later.
  const moveCaptures = unpacked.map(u => `${u.varName} = std::move(${u.varName})`).join(', ');
  const captureList =
    unpacked.length === 0 ? '[self, __executor]' : `[self, __executor, ${moveCaptures}]`;

  const allCallArgs = [
    ...unpacked.map(u => `std::move(${u.varName})`),
    'std::move(resolve)',
    'std::move(reject)',
  ].join(', ');
  const callExpr = `self->${method.name}(${allCallArgs})`;

  return [
    `if (methodName == "${method.name}") {`,
    `  return facebook::jsi::Function::createFromHostFunction(`,
    `      rt,`,
    `      facebook::jsi::PropNameID::forUtf8(rt, "${method.name}"),`,
    `      /*paramCount=*/${paramCount},`,
    `      [this](facebook::jsi::Runtime& rt_, const facebook::jsi::Value& /*thisVal*/,`,
    `             const facebook::jsi::Value* ${paramCount > 0 ? 'args' : '/*args*/'},`,
    `             size_t /*count*/) -> facebook::jsi::Value {`,
    ...unpackLines,
    `${BODY}auto Promise = rt_.global().getPropertyAsFunction(rt_, "Promise");`,
    `${BODY}auto self = this;`,
    // `__executor` is already in scope — the dispatch-branch builder
    // adds it before the unpack lines whenever this branch needs it.
    `${BODY}auto executor = facebook::jsi::Function::createFromHostFunction(`,
    `${BODY}    rt_,`,
    `${BODY}    facebook::jsi::PropNameID::forUtf8(rt_, "executor"),`,
    `${BODY}    /*paramCount=*/2,`,
    `${BODY}    ${captureList}(`,
    `${BODY}        facebook::jsi::Runtime& rt_exec,`,
    `${BODY}        const facebook::jsi::Value& /*thisVal*/,`,
    `${BODY}        const facebook::jsi::Value* execArgs,`,
    `${BODY}        size_t /*count*/) mutable -> facebook::jsi::Value {`,
    `${BODY}      auto resolveFn = std::make_shared<facebook::jsi::Function>(`,
    `${BODY}          execArgs[0].asObject(rt_exec).asFunction(rt_exec));`,
    `${BODY}      auto rejectFn = std::make_shared<facebook::jsi::Function>(`,
    `${BODY}          execArgs[1].asObject(rt_exec).asFunction(rt_exec));`,
    `${BODY}      ${resolveLambda}`,
    `${BODY}      ${rejectLambda}`,
    `${BODY}      ${callExpr};`,
    `${BODY}      return facebook::jsi::Value::undefined();`,
    `${BODY}    });`,
    `${BODY}return Promise.callAsConstructor(rt_, executor);`,
    `      });`,
    `}`,
  ].join('\n');
}
