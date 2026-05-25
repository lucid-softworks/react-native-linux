// react-native-linux playground app — Fabric + TypeScript.
//
// Demonstrates the host primitives the runtime exports:
//   <View>      — Fabric `View`      shadow node → GTK widget
//                 (backgroundColor, borderRadius, borderWidth,
//                 borderColor, opacity)
//   <Text>      — Fabric `Paragraph` shadow node → GTK widget;
//                 string children become RawText shadow nodes
//                 (color, fontSize, fontWeight, fontStyle, textAlign)
//   <Pressable> — View + onPress; the GtkGestureClick on every
//                 ViewComponentView fires through to JS via
//                 rnLinux.fabricOnClick.
//   <Button>    — Pressable wrapping a centered Text.
//
// Position defaults to 'absolute' in the host config — explicit
// top/left is the unit of layout for now (Yoga flex lands later).

import {useEffect, useState} from 'react';
import {renderFabric, View, Text, Pressable, Button} from './runtime';

function App(): JSX.Element {
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);

  // Auto-ticker — proves setInterval + setState still drive Fast Refresh.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <View top={20} left={20} width={960} height={520}
          backgroundColor="#0f172a" borderRadius={16}
          borderWidth={1} borderColor="#334155">

      {/* Heading */}
      <Text top={20} left={28} width={904} height={36}
            color="#f8fafc" fontSize={24} fontWeight="700">
        react-native-linux  •  Fabric playground
      </Text>
      <Text top={56} left={28} width={904} height={22}
            color="#94a3b8" fontSize={14} fontStyle="italic">
        JSX → react-reconciler → nativeFabricUIManager → Scheduler → GTK
      </Text>

      {/* Counter row */}
      <View top={110} left={28} width={300} height={84}
            backgroundColor="#1e293b" borderRadius={12}
            borderWidth={1} borderColor="#334155">
        <Text top={14} left={20} width={260} height={18}
              color="#94a3b8" fontSize={13} fontWeight="500">
          counter
        </Text>
        <Text top={34} left={20} width={260} height={40}
              color="#f8fafc" fontSize={32} fontWeight="700">
          {String(count)}
        </Text>
      </View>

      <Button top={110} left={348} title="+1"
              onPress={() => setCount((c) => c + 1)}
              backgroundColor="#22c55e" />
      <Button top={166} left={348} title="+10"
              onPress={() => setCount((c) => c + 10)}
              backgroundColor="#3b82f6" />
      <Button top={110} left={520} title="reset"
              onPress={() => setCount(0)}
              backgroundColor="#ef4444" />
      <Button top={166} left={520} title="−1"
              onPress={() => setCount((c) => c - 1)}
              backgroundColor="#f97316" />

      {/* Ticker */}
      <View top={110} left={700} width={232} height={84}
            backgroundColor="#1e293b" borderRadius={12}
            borderWidth={1} borderColor="#334155">
        <Text top={14} left={20} width={192} height={18}
              color="#94a3b8" fontSize={13} fontWeight="500">
          useEffect ticker
        </Text>
        <Text top={34} left={20} width={192} height={40}
              color="#fde047" fontSize={32} fontWeight="700">
          {String(tick)}
        </Text>
      </View>

      {/* Border + radius gallery */}
      <Text top={222} left={28} width={904} height={20}
            color="#cbd5e1" fontSize={13} fontWeight="600">
        styling — borders, radii, fonts
      </Text>

      <View top={252} left={28} width={140} height={100}
            backgroundColor="#22c55e" borderRadius={8}>
        <Text top={40} left={0} width={140} height={20}
              color="#052e16" fontSize={14} fontWeight="700"
              textAlign="center">rounded</Text>
      </View>
      <View top={252} left={184} width={140} height={100}
            backgroundColor="#f97316" borderRadius={50}>
        <Text top={40} left={0} width={140} height={20}
              color="#431407" fontSize={14} fontWeight="700"
              textAlign="center">pill</Text>
      </View>
      <View top={252} left={340} width={140} height={100}
            backgroundColor="#0f172a"
            borderWidth={3} borderColor="#a855f7" borderRadius={12}>
        <Text top={40} left={0} width={140} height={20}
              color="#a855f7" fontSize={14} fontWeight="700"
              textAlign="center">outlined</Text>
      </View>
      <View top={252} left={496} width={140} height={100}
            backgroundColor="#ef4444" opacity={0.5} borderRadius={8}>
        <Text top={40} left={0} width={140} height={20}
              color="#450a0a" fontSize={14} fontWeight="700"
              textAlign="center">opacity 0.5</Text>
      </View>
      <Pressable top={252} left={652} width={140} height={100}
                 backgroundColor="#0ea5e9" borderRadius={8}
                 onPress={() => setCount((c) => c + 100)}>
        <Text top={32} left={0} width={140} height={20}
              color="#082f49" fontSize={14} fontWeight="700"
              textAlign="center">Pressable</Text>
        <Text top={56} left={0} width={140} height={18}
              color="#082f49" fontSize={11}
              textAlign="center">+100 on click</Text>
      </Pressable>

      {/* Mixed font styles */}
      <View top={376} left={28} width={904} height={120}
            backgroundColor="#1e293b" borderRadius={12}>
        <Text top={14} left={20} width={864} height={18}
              color="#94a3b8" fontSize={13} fontWeight="500">
          font styles
        </Text>
        <Text top={36} left={20} width={864} height={24}
              color="#f8fafc" fontSize={16}>
          regular 16pt
        </Text>
        <Text top={60} left={20} width={864} height={24}
              color="#f8fafc" fontSize={16} fontWeight="700">
          bold 16pt
        </Text>
        <Text top={84} left={20} width={864} height={24}
              color="#f8fafc" fontSize={16} fontStyle="italic">
          italic 16pt — fontFamily="Cantarell" supported too
        </Text>
      </View>
    </View>
  );
}

renderFabric(<App />);
rnLinux.log('info', 'renderFabric(<App />) called');
