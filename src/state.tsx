// App-wide data: loads from SQLite once, exposes a refresh() after writes,
// keeps the nightly nudges in sync with the inventory, and (when signed in to a
// household) syncs shared food, list, and recipes with the other members.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import type { InventoryItem, Profile, Rating, Recipe, ShoppingItem } from './domain/types';
import * as repo from './db/repo';
import { BUILTIN_RECIPES } from './data/recipes';
import { rescheduleNudges } from './notifications';
import { makeVariant, parseVariantId } from './domain/variants';
import type { Macros } from './domain/nutrition';
import { useHouseholdSync, type HouseholdSync } from './sync/useHouseholdSync';
import { effectiveAllergies } from './domain/household';

interface AppData {
  ready: boolean;
  items: InventoryItem[];
  profile: Profile;
  /**
   * Your profile with the allergies of whoever you're cooking for added.
   * Use this for anything that suggests food; use `profile` for editing settings.
   */
  planningProfile: Profile;
  household: HouseholdSync;
  ratings: Rating[];
  savedRecipes: Recipe[];
  /** Built-in + saved AI recipes. */
  allRecipes: Recipe[];
  recentCooks: string[];
  stats: { used: number; tossed: number };
  shopping: ShoppingItem[];
  usedCounts: Map<string, number>;
  today: Macros & { meals: number };
  refresh: () => Promise<void>;
  findRecipe: (id: string) => Recipe | undefined;
}

const Ctx = createContext<AppData | null>(null);

/** Temporary home for AI results that haven't been saved yet. */
const pending = new Map<string, Recipe>();
export const pendingRecipes = {
  put: (r: Recipe) => pending.set(r.id, r),
  get: (id: string) => pending.get(id),
};

interface Loaded {
  items: InventoryItem[];
  profile: Profile;
  ratings: Rating[];
  savedRecipes: Recipe[];
  recentCooks: string[];
  stats: { used: number; tossed: number };
  shopping: ShoppingItem[];
  usedCounts: Map<string, number>;
  today: Macros & { meals: number };
}

async function loadAll(db: SQLiteDatabase): Promise<Loaded> {
  const [items, profile, ratings, savedRecipes, recentCooks, stats, shopping, usedCounts, today] = await Promise.all([
    repo.listItems(db),
    repo.getProfile(db),
    repo.listRatings(db),
    repo.listSavedRecipes(db),
    repo.recentCooks(db),
    repo.wasteStats(db),
    repo.listShopping(db),
    repo.usedCounts(db),
    repo.todayTotals(db),
  ]);
  return { items, profile, ratings, savedRecipes, recentCooks, stats, shopping, usedCounts, today };
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const apply = useCallback((d: Loaded) => {
    setLoaded(d);
    rescheduleNudges(d.items, d.profile).catch(() => {});
  }, []);

  const reload = useCallback(async () => apply(await loadAll(db)), [db, apply]);
  const household = useHouseholdSync(db, loaded?.profile ?? null, reload);
  const { scheduleSync } = household;
  // After any local change: re-read, then upload to the household shortly after.
  const refresh = useCallback(async () => {
    await reload();
    scheduleSync();
  }, [reload, scheduleSync]);

  useEffect(() => {
    let cancelled = false;
    loadAll(db).then((d) => {
      if (!cancelled) apply(d);
    });
    return () => {
      cancelled = true;
    };
  }, [db, apply]);

  const value = useMemo<AppData>(() => {
    const d = loaded ?? {
      items: [],
      profile: repo.DEFAULT_PROFILE,
      ratings: [],
      savedRecipes: [],
      recentCooks: [],
      stats: { used: 0, tossed: 0 },
      shopping: [],
      usedCounts: new Map<string, number>(),
      today: { kcal: 0, protein: 0, carbs: 0, fat: 0, meals: 0 },
    };
    const allRecipes = [...d.savedRecipes, ...BUILTIN_RECIPES];
    const planningProfile: Profile = household.household
      ? {
          ...d.profile,
          allergies: effectiveAllergies(d.profile.allergies, household.members, d.profile.cookingFor, household.myUserId),
        }
      : d.profile;
    return {
      ...d,
      planningProfile,
      household,
      ready: loaded !== null,
      allRecipes,
      refresh,
      findRecipe: (id) => {
        const direct = allRecipes.find((r) => r.id === id) ?? pending.get(id);
        if (direct) return direct;
        const { baseId, style } = parseVariantId(id);
        const base = allRecipes.find((r) => r.id === baseId) ?? pending.get(baseId);
        return base ? makeVariant(base, style, planningProfile.allergies).recipe : undefined;
      },
    };
  }, [loaded, refresh, household]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData must be used inside AppDataProvider');
  return v;
}

