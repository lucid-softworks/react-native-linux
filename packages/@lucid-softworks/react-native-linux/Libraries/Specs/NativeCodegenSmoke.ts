import {TurboModuleRegistry} from 'react-native';
import type {TurboModule} from 'react-native';

// Codegen-smoke TurboModule. Exists to lock down end-to-end
// compilation of every non-trivial generator output shape:
//
//   • Primitive params + primitive return (sync method)
//   • Object param via fromDynamic + object return via toDynamic
//   • Promise<void>
//   • Promise<TypedObject>
//   • Multi-arg, void-returning callback param
//
// The C++ impl is a stub (vnext/src/modules/CodegenSmoke.cpp) — it
// registers under the name `CodegenSmoke` and returns canned
// values. JS callers can dispatch through `TurboModuleRegistry.get`
// to exercise the generated dispatcher at runtime, but the primary
// value is compile-time: any regression in the Promise / callback /
// object code paths will break the vnext build.

export interface Spec extends TurboModule {
  // Sync primitive in / out.
  add(a: number, b: number): number;

  // Object in / object out (exercises fromDynamic + toDynamic + the
  // <MethodName>Param_<Name> + <MethodName>Result struct naming).
  echoUser(user: {name: string; age: number}): {name: string; age: number; greeting: string};

  // Promise<void> — exercises the executor-hopping resolve path
  // with no resolve argument.
  ping(): Promise<void>;

  // Promise<TypedObject> — exercises Promise<Struct> resolve via
  // toDynamic.
  fetchUser(id: string): Promise<{name: string; age: number}>;

  // Void-returning multi-arg callback — exercises the jsi::Function
  // → std::function adapter with per-arg toJsi marshalling.
  subscribe(cb: (eventName: string, count: number) => void): void;

  // Callback with an object arg — exercises StructCollector recursing
  // into callback arg types, the resulting `<Method>_<Cb>_<Arg>` struct
  // name, and the toDynamic call inside the callback wrapper.
  observe(cb: (event: {kind: string; count: number}) => void): void;

  // Non-void callback return — exercises the sync, on-JS-thread
  // callback path (capture rt_ by pointer, call jsi::Function
  // synchronously, convert the returned jsi::Value back to bool).
  shouldAccept(pred: (msg: string) => boolean): void;
}

export default TurboModuleRegistry.get<Spec>('CodegenSmoke');
