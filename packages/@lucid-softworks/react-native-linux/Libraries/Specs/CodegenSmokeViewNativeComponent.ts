import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type {ColorValue, ViewProps} from 'react-native';
import type {
  Int32,
  Double,
  WithDefault,
  DirectEventHandler,
} from 'react-native/Libraries/Types/CodegenTypes';

// Codegen-smoke Fabric component. Companion to NativeCodegenSmoke.ts
// (the TurboModule smoke). Compile-tests the component generator's
// Props / EventEmitter / ShadowNode / ComponentDescriptor output.
//
// The C++ side (vnext/src/components/CodegenSmokeView.cpp) registers
// the descriptor via the generated `registerCodegenSmokeView` so any
// regression in the component generator breaks the vnext build.

type ValueChangeEvent = Readonly<{value: Int32; ok: boolean}>;

interface NativeProps extends ViewProps {
  enabled: boolean;
  label?: WithDefault<string, 'default'>;
  count: Int32;
  ratio: Double;
  // Reserved RN graphics type → facebook::react::SharedColor.
  tint?: ColorValue;
  // StringEnum → generated `enum class` + fromRawValue overload.
  mode?: WithDefault<'small' | 'large' | 'auto', 'auto'>;
  onValueChange?: DirectEventHandler<ValueChangeEvent>;
}

export default codegenNativeComponent<NativeProps>('CodegenSmokeView') as unknown;
