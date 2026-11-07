import { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { DB_NAME, migrate } from '../db/schema';
import { AppDataProvider } from '../state';
import { C } from '../components/ui';

function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
      <ActivityIndicator color={C.primary} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <Suspense fallback={<Loading />}>
      <SQLiteProvider databaseName={DB_NAME} onInit={migrate} useSuspense>
        <AppDataProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerTintColor: C.primary,
              headerStyle: { backgroundColor: C.bg },
              contentStyle: { backgroundColor: C.bg },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="recipe/[id]" options={{ title: 'Recipe' }} />
            <Stack.Screen name="meal-prep" options={{ title: 'Meal prep' }} />
          </Stack>
        </AppDataProvider>
      </SQLiteProvider>
    </Suspense>
  );
}
