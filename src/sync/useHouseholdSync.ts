// Household state + background sync for the app.
// Sync runs: shortly after any local change, when another member changes
// something (Supabase Realtime), and whenever the app comes to the foreground.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSupabase, supabaseConfigured } from './supabase';
import * as api from './householdApi';
import { syncOnce } from './engine';
import { prepareForHousehold, sqliteLocalStore } from './localStore';
import type { Member } from '../domain/household';
import type { Profile } from '../domain/types';

export type SyncState = 'off' | 'syncing' | 'ok' | 'error';

export interface HouseholdSync {
  configured: boolean;
  session: Session | null;
  email: string | undefined;
  myUserId: string | undefined;
  household: api.Household | null;
  members: Member[];
  sync: { state: SyncState; lastSyncedAt?: Date; error?: string };
  scheduleSync: () => void;
  syncNow: () => Promise<void>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  createHousehold: (name: string, displayName: string) => Promise<void>;
  joinHousehold: (code: string, displayName: string) => Promise<void>;
  leaveHousehold: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useHouseholdSync(
  db: SQLiteDatabase,
  profile: Profile | null,
  /** Re-read local data after a pull changed something. */
  reload: () => Promise<void>,
): HouseholdSync {
  const sb = getSupabase();
  const [session, setSession] = useState<Session | null>(null);
  const [household, setHousehold] = useState<api.Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [sync, setSync] = useState<HouseholdSync['sync']>({ state: 'off' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  const householdRef = useRef<api.Household | null>(null);
  householdRef.current = household;
  const userId = session?.user.id;

  const local = useMemo(() => sqliteLocalStore(db), [db]);

  const syncNow = useCallback(async () => {
    const h = householdRef.current;
    if (!sb || !h) return;
    if (running.current) {
      again.current = true; // a change arrived mid-sync; go once more after
      return;
    }
    running.current = true;
    setSync((s) => ({ ...s, state: 'syncing' }));
    try {
      do {
        again.current = false;
        const r = await syncOnce(local, api.supabaseRemote(sb), h.id);
        if (r.changed > 0) await reload();
      } while (again.current);
      setSync({ state: 'ok', lastSyncedAt: new Date() });
    } catch (e) {
      // Changes stay on the phone and upload on the next try.
      setSync((s) => ({ ...s, state: 'error', error: e instanceof Error ? e.message : String(e) }));
    } finally {
      running.current = false;
    }
  }, [sb, local, reload]);

  const scheduleSync = useCallback(() => {
    if (!householdRef.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      syncNow();
    }, 800);
  }, [syncNow]);

  const refreshMembers = useCallback(async () => {
    const h = householdRef.current;
    if (!sb || !h) return;
    setMembers(await api.listMembers(sb, h.id));
  }, [sb]);

  // Auth session
  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  // Which household am I in?
  useEffect(() => {
    if (!sb || !userId) {
      setHousehold(null);
      setMembers([]);
      setSync({ state: 'off' });
      return;
    }
    let cancelled = false;
    api
      .myHousehold(sb, userId)
      .then((h) => {
        if (!cancelled) setHousehold(h);
      })
      .catch((e) => setSync({ state: 'error', error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [sb, userId]);

  // In a household: load members, sync, listen for changes.
  useEffect(() => {
    if (!sb || !household) return;
    refreshMembers().catch(() => {});
    syncNow();
    const filter = `household_id=eq.${household.id}`;
    const channel = sb
      .channel(`household-${household.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter }, () => scheduleSync())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping', filter }, () => scheduleSync())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipes', filter }, () => scheduleSync())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_members', filter }, () => {
        refreshMembers().catch(() => {});
      })
      .subscribe();
    const appState = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        syncNow();
        refreshMembers().catch(() => {});
      }
    });
    return () => {
      sb.removeChannel(channel);
      appState.remove();
    };
  }, [sb, household, syncNow, scheduleSync, refreshMembers]);

  // Share my name and allergies with the household when they change.
  const myRow = members.find((m) => m.userId === userId);
  const myName = profile?.displayName ?? '';
  const myAllergies = profile?.allergies ?? [];
  const allergyKey = myAllergies.join('|');
  useEffect(() => {
    if (!sb || !household || !myRow) return;
    if (myRow.displayName === myName && myRow.allergies.join('|') === allergyKey) return;
    api
      .updateMe(sb, myName, allergyKey ? allergyKey.split('|') : [])
      .then(refreshMembers)
      .catch(() => {});
  }, [sb, household, myRow, myName, allergyKey, refreshMembers]);

  const startHousehold = useCallback(
    async (h: api.Household) => {
      await prepareForHousehold(db); // your food merges into the household
      householdRef.current = h;
      setHousehold(h);
    },
    [db],
  );

  const need = () => {
    if (!sb) throw new Error('Household sharing is not set up (Supabase settings missing).');
    return sb;
  };

  return {
    configured: supabaseConfigured(),
    session,
    email: session?.user.email,
    myUserId: userId,
    household,
    members,
    sync,
    scheduleSync,
    syncNow,
    sendCode: (email) => api.sendCode(need(), email),
    verifyCode: (email, code) => api.verifyCode(need(), email, code),
    createHousehold: async (name, displayName) => startHousehold(await api.createHousehold(need(), name, displayName)),
    joinHousehold: async (code, displayName) => startHousehold(await api.joinHousehold(need(), code, displayName)),
    leaveHousehold: async () => {
      await api.leaveHousehold(need());
      householdRef.current = null;
      setHousehold(null);
      setMembers([]);
      setSync({ state: 'off' });
      await prepareForHousehold(db); // keep a local copy; reset sync positions
    },
    signOut: async () => {
      await need().auth.signOut();
      householdRef.current = null;
      setHousehold(null);
    },
  };
}
