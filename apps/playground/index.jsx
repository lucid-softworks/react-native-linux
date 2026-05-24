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

const {useEffect, useState} = require('react');
const {renderFabric, View, Text} = require('./runtime');

function App() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCount((c) => c + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <View top={40} left={40} width={920} height={360}
          backgroundColor="#1e293b">
      <Text top={20} left={20} width={880} height={36}
            color="#f8fafc" fontSize={22} fontWeight="700">
        Hello from JSX → Fabric!  count = {count}
      </Text>
      <Text top={60} left={20} width={880} height={24}
            color="#94a3b8" fontSize={14} fontStyle="italic">
        react-reconciler → nativeFabricUIManager → Scheduler → GTK
      </Text>

      <View top={108} left={20} width={260} height={80}
            backgroundColor="#22c55e">
        <Text top={28} left={16} width={228} height={28}
              color="#052e16" fontSize={18} fontWeight="700">
          green view
        </Text>
      </View>
      <View top={108} left={300} width={260} height={80}
            backgroundColor="#f97316">
        <Text top={28} left={16} width={228} height={28}
              color="#431407" fontSize={18} fontWeight="700">
          orange view
        </Text>
      </View>
      <View top={108} left={580} width={260} height={80}
            backgroundColor="#ef4444">
        <Text top={28} left={16} width={228} height={28}
              color="#450a0a" fontSize={18} fontWeight="700">
          red view
        </Text>
      </View>

      <Text top={220} left={20} width={880} height={24}
            color="#e2e8f0" fontSize={14}>
        each box above is a &lt;View&gt; with a nested &lt;Text&gt; child.
      </Text>
      <Text top={252} left={20} width={880} height={24}
            color="#94a3b8" fontSize={13}>
        edit apps/playground/index.jsx, run `pnpm watch` — hot reload reboots the runtime.
      </Text>
    </View>
  );
}

renderFabric(<App />);
rnLinux.log('info', 'renderFabric(<App />) called');
