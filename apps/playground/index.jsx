// react-native-linux playground app — Fabric edition.
//
// This file is the entire user-facing React surface. Everything that
// makes JSX → Fabric → GTK possible (Hermes shims, react-reconciler
// host config, runApplication wiring) lives in `./runtime/` so this
// file can stay focused on the React app itself.
//
//   <View>  — Fabric `View`      shadow node → GTK widget
//   <Text>  — Fabric `Paragraph` shadow node → GTK widget;
//             string children become RawText shadow nodes
// All other props are forwarded to Fabric as Yoga style / view props
// (top, left, width, height, backgroundColor, opacity, …). Position
// defaults to 'absolute' in the host config — explicit top/left is
// the unit of layout for now.

const {renderFabric, View, Text} = require('./runtime');

function App() {
  return (
    <View top={40} left={40} width={920} height={320}
          backgroundColor="#1e293b">
      <Text top={20} left={20} width={880} height={32}>
        Hello from JSX → Fabric!
      </Text>
      <Text top={56} left={20} width={880} height={24}>
        react-reconciler → nativeFabricUIManager → Scheduler → GTK
      </Text>

      <View top={104} left={20} width={260} height={72}
            backgroundColor="#22c55e">
        <Text top={26} left={16} width={228} height={24}>
          green view
        </Text>
      </View>
      <View top={104} left={300} width={260} height={72}
            backgroundColor="#f97316">
        <Text top={26} left={16} width={228} height={24}>
          orange view
        </Text>
      </View>
      <View top={104} left={580} width={260} height={72}
            backgroundColor="#ef4444">
        <Text top={26} left={16} width={228} height={24}>
          red view
        </Text>
      </View>

      <Text top={208} left={20} width={880} height={24}>
        each box above is a &lt;View&gt; with a nested &lt;Text&gt; child.
      </Text>
      <Text top={240} left={20} width={880} height={24}>
        edit apps/playground/index.jsx, run `pnpm watch` — hot reload reboots the runtime.
      </Text>
    </View>
  );
}

renderFabric(<App />);
rnLinux.log('info', 'renderFabric(<App />) called');
