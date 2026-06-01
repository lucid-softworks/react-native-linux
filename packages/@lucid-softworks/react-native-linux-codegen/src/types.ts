// Type-mapping helpers — `@react-native/codegen` schema TypeAnnotations
// to the C++ types our generated TurboModule headers use.
//
// Strategy: primitives map directly to C++ primitives; composite types
// (objects, arrays) go through `folly::dynamic`. That keeps the
// generator small and the implementer-facing API uniform (just
// construct the right dynamic shape and return it), at the cost of
// some C++-side type safety. Strongly-typed object structs are a
// follow-up once we have real consumer demand.

// `@react-native/codegen` doesn't ship runtime exports for its type
// annotations — they're a TypeScript union. We accept `any` at the
// boundary and narrow with `.type` checks inside the generator.
export type TypeAnnotation = {type: string; [key: string]: unknown};

export interface CppType {
  // The C++ type used in the implementer-facing virtual method
  // signature. e.g. `bool`, `std::string`, `folly::dynamic`, `void`.
  cpp: string;

  // C++ expression that converts a `facebook::jsi::Value` named
  // `__arg` (in `facebook::jsi::Runtime& __rt`) to the C++ type.
  // Used to unpack method parameters in the JSI dispatch wrapper.
  // `undefined` for return-only types (void).
  fromJsi?: (jsValueExpr: string, rtExpr: string) => string;

  // C++ expression that converts a value of the C++ type (named in
  // `cppValueExpr`) to a `facebook::jsi::Value`. Used to pack
  // return values. `undefined` for param-only types (callbacks).
  toJsi?: (cppValueExpr: string, rtExpr: string) => string;
}

const PRIMITIVE: Record<string, CppType> = {
  StringTypeAnnotation: {
    cpp: 'std::string',
    fromJsi: (v, rt) => `${v}.asString(${rt}).utf8(${rt})`,
    toJsi: (v, rt) => `facebook::jsi::String::createFromUtf8(${rt}, ${v})`,
  },
  NumberTypeAnnotation: {
    cpp: 'double',
    fromJsi: v => `${v}.asNumber()`,
    toJsi: v => `facebook::jsi::Value(${v})`,
  },
  DoubleTypeAnnotation: {
    cpp: 'double',
    fromJsi: v => `${v}.asNumber()`,
    toJsi: v => `facebook::jsi::Value(${v})`,
  },
  FloatTypeAnnotation: {
    cpp: 'double',
    fromJsi: v => `${v}.asNumber()`,
    toJsi: v => `facebook::jsi::Value(${v})`,
  },
  Int32TypeAnnotation: {
    cpp: 'int32_t',
    fromJsi: v => `static_cast<int32_t>(${v}.asNumber())`,
    toJsi: v => `facebook::jsi::Value(static_cast<int>(${v}))`,
  },
  BooleanTypeAnnotation: {
    cpp: 'bool',
    fromJsi: v => `${v}.asBool()`,
    toJsi: v => `facebook::jsi::Value(${v})`,
  },
};

const DYNAMIC: CppType = {
  cpp: 'folly::dynamic',
  fromJsi: (v, rt) => `facebook::jsi::dynamicFromValue(${rt}, ${v})`,
  toJsi: (v, rt) => `facebook::jsi::valueFromDynamic(${rt}, ${v})`,
};

const VOID: CppType = {
  cpp: 'void',
  // void has no jsi conversion — handled specially by the generator.
};

// Walk a TypeAnnotation and return the matching C++ type. Throws
// with a clear, actionable message on anything the MVP doesn't
// support so the caller sees `unsupported type ...` instead of
// broken C++ at compile time.
export function mapType(t: TypeAnnotation, ctx: 'param' | 'return'): CppType {
  if (t.type === 'NullableTypeAnnotation') {
    // For the MVP, treat `T | null` the same as `T` and document
    // the constraint: implementer is responsible for not returning
    // jsi-null where the spec said non-null. std::optional / folly
    // dynamic-null support lands when a real consumer needs it.
    return mapType(t.typeAnnotation as TypeAnnotation, ctx);
  }
  if (t.type === 'VoidTypeAnnotation') {
    if (ctx === 'param') {
      throw new Error('void is not a valid parameter type');
    }
    return VOID;
  }
  if (t.type === 'ObjectTypeAnnotation' || t.type === 'GenericObjectTypeAnnotation') {
    return DYNAMIC;
  }
  if (t.type === 'ArrayTypeAnnotation') {
    return DYNAMIC;
  }
  if (t.type === 'EnumDeclaration') {
    // Enums in codegen carry a `memberType` describing the underlying
    // representation. Fall through to the matching primitive.
    const memberType = (t as {memberType?: string}).memberType;
    if (memberType === 'StringTypeAnnotation') return PRIMITIVE.StringTypeAnnotation;
    if (memberType === 'NumberTypeAnnotation') return PRIMITIVE.NumberTypeAnnotation;
    throw new Error(`unsupported enum memberType: ${String(memberType)}`);
  }
  if (t.type === 'PromiseTypeAnnotation') {
    // Promise is handled directly by the generator (it needs to emit
    // resolve/reject param pairs + the Promise.callAsConstructor
    // wrapper), so mapType doesn't try to express it as a single
    // CppType. Returning here keeps the dispatcher honest by failing
    // loudly if it's reached via the param/return path that doesn't
    // know about promises.
    throw new Error(
      'PromiseTypeAnnotation must be handled at the method level — ' +
        'mapType cannot lower it to a single C++ type.',
    );
  }
  if (t.type === 'FunctionTypeAnnotation') {
    // Callback params. The C++ type is std::function<R(args...)>; the
    // generator emits the fromJsi unpack (multi-line jsi::Function →
    // std::function adapter using the RuntimeExecutor) directly, so
    // mapType only owns the cpp signature here.
    if (ctx !== 'param') {
      throw new Error('FunctionTypeAnnotation is only supported as a param type');
    }
    const fn = t as {
      params?: Array<{name?: string; typeAnnotation: TypeAnnotation}>;
      returnTypeAnnotation?: TypeAnnotation;
    };
    const argTypes = (fn.params ?? []).map(p => mapType(p.typeAnnotation, 'param').cpp);
    const ret = fn.returnTypeAnnotation ?? {type: 'VoidTypeAnnotation'};
    if (ret.type !== 'VoidTypeAnnotation') {
      throw new Error(
        'Non-void callback returns are not yet supported by the Linux generator. ' +
          'Tracked as a follow-up to the codegen MVP.',
      );
    }
    return {
      cpp: `std::function<void(${argTypes.join(', ')})>`,
      // No fromJsi/toJsi — the generator handles the multi-line
      // jsi::Function → std::function wrap inline.
    };
  }
  const primitive = PRIMITIVE[t.type];
  if (primitive) return primitive;
  throw new Error(`unsupported codegen TypeAnnotation: ${t.type}`);
}
