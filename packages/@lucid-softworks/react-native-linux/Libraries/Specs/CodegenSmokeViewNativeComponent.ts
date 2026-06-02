import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import codegenNativeCommands from 'react-native/Libraries/Utilities/codegenNativeCommands';
import type {ColorValue, HostComponent, ViewProps} from 'react-native';
import type {ImageSource} from 'react-native/Libraries/Image/ImageSource';
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
  // ImageSourcePrimitive → facebook::react::ImageSource.
  source?: ImageSource;
  // StringEnum → generated `enum class` + fromRawValue overload.
  mode?: WithDefault<'small' | 'large' | 'auto', 'auto'>;
  // Int32 enum → generated `enum class : int32_t` + int-keyed fromRawValue.
  level?: WithDefault<0 | 1 | 2, 0>;
  onValueChange?: DirectEventHandler<ValueChangeEvent>;
}

interface NativeCommands {
  // Compile-tests the commands codegen helper end-to-end.
  focus: (viewRef: React.ElementRef<HostComponent<NativeProps>>) => void;
  setValue: (
    viewRef: React.ElementRef<HostComponent<NativeProps>>,
    value: string,
    force: boolean,
  ) => void;
}

export const Commands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['focus', 'setValue'],
});

export default codegenNativeComponent<NativeProps>('CodegenSmokeView') as unknown;
