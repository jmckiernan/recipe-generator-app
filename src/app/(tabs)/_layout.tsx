import { Text, type ColorValue } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { C } from '../../components/ui';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: C.primary,
        headerStyle: { backgroundColor: C.bg },
        sceneStyle: { backgroundColor: C.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Tonight', tabBarIcon: icon('🍳') }} />
      <Tabs.Screen name="fridge" options={{ title: 'My Food', tabBarIcon: icon('🧊') }} />
      <Tabs.Screen name="profile" options={{ title: 'Taste', tabBarIcon: icon('⭐') }} />
    </Tabs>
  );
}
