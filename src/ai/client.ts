// Calls the FridgeChef AI server (see /server). The Claude API key lives on that
// server, never in the app. Configure with EXPO_PUBLIC_AI_URL (and optionally
// EXPO_PUBLIC_AI_TOKEN) in a .env file.

import type { Filters, InventoryItem, Profile, Rating, Recipe, Style } from '../domain/types';
import { describeAmount } from '../domain/inventory';
import { daysUntil } from '../domain/shelfLife';
import { normalizeName } from '../domain/normalize';
import { violatesAllergies } from '../domain/taste';

const AI_URL = process.env.EXPO_PUBLIC_AI_URL;
const AI_TOKEN = process.env.EXPO_PUBLIC_AI_TOKEN;

export const aiConfigured = (): boolean => Boolean(AI_URL);

export interface AiResult {
  recipes: Recipe[];
  tryNext: { ingredient: string; why: string }[];
  /** Recipes the app dropped because they conflicted with allergies. */
  blocked: number;
}

interface ServerRecipe {
  title: string;
  minutes: number;
  kind: 'assembly' | 'recipe';
  cuisine: string;
  tags: string[];
  ingredients: { name: string; use: 'all' | 'half' | 'some'; optional: boolean }[];
  steps: string[];
  why: string;
  servings: number;
}

export async function generateRecipes(args: {
  inventory: InventoryItem[];
  profile: Profile;
  ratings: Rating[];
  ratedTitles: Map<string, string>;
  recentCooks: string[];
  filters: Filters;
  request?: string;
  style?: Style;
}): Promise<AiResult> {
  if (!AI_URL) throw new Error('AI server not configured. Set EXPO_PUBLIC_AI_URL.');
  const { inventory, profile, ratings, ratedTitles, filters } = args;
  const titleOf = (id: string) => ratedTitles.get(id) ?? id;

  const body = {
    inventory: inventory.map((i) => ({
      name: i.name,
      amount: describeAmount(i),
      daysLeft: daysUntil(i.expiresAt),
    })),
    staples: profile.staples,
    likes: profile.likes,
    dislikes: profile.dislikes,
    allergies: profile.allergies,
    favoriteRestaurants: profile.favoriteRestaurants,
    topRated: ratings.filter((r) => r.stars >= 4).map((r) => titleOf(r.recipeId)),
    lowRated: ratings.filter((r) => r.stars <= 2).map((r) => titleOf(r.recipeId)),
    recentCooks: args.recentCooks,
    filters,
    request: args.request,
    style: args.style ?? 'classic',
    count: 4,
  };

  const res = await fetch(`${AI_URL.replace(/\/$/, '')}/recipes`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(AI_TOKEN ? { authorization: `Bearer ${AI_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    error?: string;
    recipes?: ServerRecipe[];
    tryNext?: { ingredient: string; why: string }[];
  };
  if (!res.ok) throw new Error(json.error ?? `AI server error ${res.status}`);

  const stamp = Date.now().toString(36);
  const recipes: Recipe[] = (json.recipes ?? []).map((r, idx) => ({
    id: `ai-${stamp}-${idx}`,
    title: r.title,
    minutes: r.minutes,
    kind: r.kind,
    cuisine: r.cuisine,
    tags: r.tags,
    ingredients: r.ingredients.map((x) => ({ ...x, name: normalizeName(x.name) })),
    steps: r.steps,
    why: r.why,
    servings: r.servings,
    source: 'ai',
  }));

  // Defense in depth: the prompt says no allergens, and we check again here.
  const safe = recipes.filter((r) => !violatesAllergies(r, profile.allergies));
  return { recipes: safe, tryNext: json.tryNext ?? [], blocked: recipes.length - safe.length };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!AI_URL) throw new Error('AI server not configured. Set EXPO_PUBLIC_AI_URL.');
  const res = await fetch(`${AI_URL.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(AI_TOKEN ? { authorization: `Bearer ${AI_TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `AI server error ${res.status}`);
  return json;
}

/** Photo of a grocery receipt → food items (Claude reads it on the server). */
export async function scanReceipt(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
): Promise<{ store: string; items: { name: string; count: number }[] }> {
  const r = await post<{ store: string; items: { name: string; count: number }[] }>('/receipt', { imageBase64, mediaType });
  return {
    store: r.store,
    items: r.items
      .map((i) => ({ name: normalizeName(i.name), count: Math.max(1, Math.round(i.count) || 1) }))
      .filter((i) => i.name),
  };
}

export interface FoundRecipe {
  title: string;
  url: string;
  site: string;
  why: string;
}

/** Web search limited to the user's favorite recipe sites. */
export async function findOnSites(args: {
  sites: string[];
  ingredients: string[];
  likes: string[];
  allergies: string[];
  request?: string;
}): Promise<FoundRecipe[]> {
  const r = await post<{ recipes: FoundRecipe[] }>('/find-recipes', args);
  return r.recipes;
}
