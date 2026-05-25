// react-native-linux playground app — Fabric + Yoga + ScrollView.

import {useEffect, useState} from 'react';
import {renderFabric, View, ScrollView, Text, Pressable, Button} from './runtime';

function App(): JSX.Element {
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // A scrollable list of items to prove the ScrollView wrapper
  // actually overflows its viewport.
  const items = Array.from({length: 40}, (_, i) => i);

  return (
    <View flex={1} padding={20} backgroundColor="#0f172a">

      {/* Header */}
      <Text fontSize={24} fontWeight="700" color="#f8fafc">
        react-native-linux  •  Fabric + Yoga + Pango
      </Text>
      <Text fontSize={13} color="#94a3b8" fontStyle="italic" marginBottom={16}>
        ScrollView in the right column scrolls when content overflows.
      </Text>

      {/* Left: counter / buttons / ticker. Right: scrolling list. */}
      <View flexDirection="row" gap={16} flex={1}>

        {/* Left column (fixed width with flex bottoms) */}
        <View flex={1} gap={12}>
          <View padding={14} backgroundColor="#1e293b"
                borderRadius={12} borderWidth={1} borderColor="#334155">
            <Text fontSize={13} fontWeight="500" color="#94a3b8">counter</Text>
            <Text fontSize={36} fontWeight="700" color="#f8fafc">
              {String(count)}
            </Text>
          </View>

          <View flexDirection="row" flexWrap="wrap" gap={8}>
            <Button title="+1"    width={84} onPress={() => setCount((c) => c + 1)}
                    backgroundColor="#22c55e" />
            <Button title="+10"   width={84} onPress={() => setCount((c) => c + 10)}
                    backgroundColor="#3b82f6" />
            <Button title="−1"    width={84} onPress={() => setCount((c) => c - 1)}
                    backgroundColor="#f97316" />
            <Button title="reset" width={84} onPress={() => setCount(0)}
                    backgroundColor="#ef4444" />
          </View>

          <View padding={14} backgroundColor="#1e293b"
                borderRadius={12} borderWidth={1} borderColor="#334155">
            <Text fontSize={13} fontWeight="500" color="#94a3b8">useEffect ticker</Text>
            <Text fontSize={36} fontWeight="700" color="#fde047">
              {String(tick)}
            </Text>
          </View>
        </View>

        {/* Right column: long ScrollView. flex:1 on BOTH the wrapping
            View and the ScrollView so the scrollview gets a bounded
            height — Yoga would otherwise shrink-wrap it to content
            and there'd be nothing to scroll. */}
        <View flex={1} backgroundColor="#1e293b" borderRadius={12}
              borderWidth={1} borderColor="#334155" padding={4}>
          <ScrollView flex={1}>
            <View padding={8} gap={6}>
              <Text fontSize={13} fontWeight="600" color="#cbd5e1" marginBottom={4}>
                scrolling list — 40 rows
              </Text>
              {items.map((i) => (
                <Pressable key={i}
                           backgroundColor={i % 2 === 0 ? '#0f172a' : '#111827'}
                           padding={10} borderRadius={6}
                           onPress={() => setCount(i)}>
                  <Text fontSize={14} color="#e2e8f0">
                    row {i}  ·  tap to set counter
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>

      </View>
    </View>
  );
}

renderFabric(<App />);
rnLinux.log('info', 'renderFabric(<App />) called');
