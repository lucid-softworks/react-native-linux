// react-native-linux playground app — Fabric + TypeScript + Yoga flex.
//
// Layout uses RN's standard flexbox via Yoga (built into the Fabric
// Scheduler). Without `position:'absolute'`, every <View> is a flex
// container — children flow according to flexDirection / gap /
// justifyContent / alignItems / padding / margin.
//
// Host primitives:
//   <View>      — Fabric `View`      shadow node → GtkFixed widget
//   <Text>      — Fabric `Paragraph` shadow node → GtkLabel widget
//   <Pressable> — View + onPress (GtkGestureClick under the hood)
//   <Button>    — Pressable wrapping a centered Text label
//
// Styling: backgroundColor, color, fontSize, fontFamily, fontWeight,
// fontStyle, textAlign, borderRadius, borderWidth, borderColor,
// opacity. Yoga style: flex, flexDirection, flexWrap, gap,
// alignItems, justifyContent, padding[Top|Right|Bottom|Left|H|V],
// margin[…], width, height, minWidth, maxWidth, …

import {useEffect, useState} from 'react';
import {renderFabric, View, Text, Pressable, Button} from './runtime';

function App(): JSX.Element {
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <View flex={1} padding={20} backgroundColor="#0f172a">

      {/* Header */}
      <Text fontSize={24} fontWeight="700" color="#f8fafc">
        react-native-linux  •  Fabric + Yoga
      </Text>
      <Text fontSize={13} color="#94a3b8" fontStyle="italic" marginTop={4}
            marginBottom={20}>
        JSX → react-reconciler → nativeFabricUIManager → Yoga → GTK
      </Text>

      {/* Counter row — flexDirection row, gap between cards */}
      <View flexDirection="row" gap={12}>
        <View flex={2} padding={14} backgroundColor="#1e293b"
              borderRadius={12} borderWidth={1} borderColor="#334155">
          <Text fontSize={13} fontWeight="500" color="#94a3b8">counter</Text>
          <Text fontSize={32} fontWeight="700" color="#f8fafc" marginTop={4}>
            {String(count)}
          </Text>
        </View>

        <View flex={3} flexDirection="row" flexWrap="wrap" gap={8}>
          <Button title="+1"    width={92} onPress={() => setCount((c) => c + 1)}
                  backgroundColor="#22c55e" />
          <Button title="+10"   width={92} onPress={() => setCount((c) => c + 10)}
                  backgroundColor="#3b82f6" />
          <Button title="−1"    width={92} onPress={() => setCount((c) => c - 1)}
                  backgroundColor="#f97316" />
          <Button title="reset" width={92} onPress={() => setCount(0)}
                  backgroundColor="#ef4444" />
        </View>

        <View flex={1} padding={14} backgroundColor="#1e293b"
              borderRadius={12} borderWidth={1} borderColor="#334155">
          <Text fontSize={13} fontWeight="500" color="#94a3b8">ticker</Text>
          <Text fontSize={32} fontWeight="700" color="#fde047" marginTop={4}>
            {String(tick)}
          </Text>
        </View>
      </View>

      {/* Justify-content gallery — equal-size buttons aligned differently */}
      <Text fontSize={13} fontWeight="600" color="#cbd5e1"
            marginTop={20} marginBottom={8}>
        justifyContent
      </Text>
      {(['flex-start', 'center', 'flex-end', 'space-between', 'space-around'] as const).map((j) => (
        <View key={j} flexDirection="row" justifyContent={j}
              padding={6} marginBottom={6}
              backgroundColor="#1e293b" borderRadius={8}>
          <View width={48} height={20} backgroundColor="#22c55e" borderRadius={4} />
          <View width={48} height={20} backgroundColor="#3b82f6" borderRadius={4} />
          <View width={48} height={20} backgroundColor="#f97316" borderRadius={4} />
          <Text fontSize={11} color="#94a3b8" alignSelf="center" marginLeft={12}>{j}</Text>
        </View>
      ))}

      {/* Border + radius gallery — flexbox wrap */}
      <Text fontSize={13} fontWeight="600" color="#cbd5e1"
            marginTop={16} marginBottom={8}>
        styling
      </Text>
      <View flexDirection="row" flexWrap="wrap" gap={12}>
        <View width={120} height={80} backgroundColor="#22c55e" borderRadius={8} />
        <View width={120} height={80} backgroundColor="#f97316" borderRadius={40} />
        <View width={120} height={80} backgroundColor="#0f172a"
              borderWidth={3} borderColor="#a855f7" borderRadius={12} />
        <View width={120} height={80} backgroundColor="#ef4444" opacity={0.5}
              borderRadius={8} />
        <Pressable width={120} height={80} backgroundColor="#0ea5e9"
                   borderRadius={8} justifyContent="center" alignItems="center"
                   onPress={() => setCount((c) => c + 100)}>
          <Text color="#082f49" fontSize={13} fontWeight="700">+100</Text>
        </Pressable>
      </View>
    </View>
  );
}

renderFabric(<App />);
rnLinux.log('info', 'renderFabric(<App />) called');
