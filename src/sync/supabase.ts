// Supabase client for household sharing. Configure in .env.local:
//   EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
//   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
// The anon key is designed to ship in apps; row-level security (supabase/migrations)
// is what keeps each household's data private. Without these, household features hide.

import { AppState } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Storage from 'expo-sqlite/kv-store';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = (): boolean => Boolean(URL && KEY);

let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (!URL || !KEY) return (client = null);
  client = createClient(URL, KEY, {
    auth: {
      // The login session is kept in the app's SQLite key-value store.
      storage: Storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  // Keep the login fresh only while the app is open.
  const c = client;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') c.auth.startAutoRefresh();
    else c.auth.stopAutoRefresh();
  });
  return client;
}
