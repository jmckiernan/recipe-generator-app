// The heart of the "Tonight" screen: rank recipes by what you have,
// what's about to expire, and what you like. Fully deterministic and offline.

import type { Filters, InventoryItem, Profile, Rating, Recipe, Suggestion } from './types';
import { ingredientMatches } from './normalize';
import { daysUntil } from './shelfLife';
import { buildTaste, tasteScore, violatesAllergies } from './taste';
import { findItemFor } from './inventory';

export function isStaple(name: string, staples: string[]): boolean {
  return staples.some((s) => ingredientMatches(s, name) || ingredientMatches(name, s));
}

/** Ingredients that "count" toward the 2- or 3-ingredient limit: non-staple, non-optional. */
export function countedIngredients(recipe: Recipe, staples: string[]): string[] {
  return recipe.ingredients
    .filter((i) => !i.optional && !isStaple(i.name, staples))
    .map((i) => i.name);
}

export function expiringItems(
  inventory: InventoryItem[],
  warnDays: number,
  today: Date = new Date(),
): InventoryItem[] {
  return inventory
    .filter((i) => {
      const d = daysUntil(i.expiresAt, today);
      return d >= 0 && d <= warnDays;
    })
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}

export function suggest(
  recipes: Recipe[],
  inventory: InventoryItem[],
  profile: Profile,
  ratings: Rating[],
  filters: Filters,
  today: Date = new Date(),
): Suggestion[] {
  const taste = buildTaste(profile, ratings);
  const warn = profile.expiryWarnDays;
  const out: Suggestion[] = [];

  for (const recipe of recipes) {
    // Hard filters first.
    if (violatesAllergies(recipe, profile.allergies)) continue;
    if (filters.maxMinutes !== undefined && recipe.minutes > filters.maxMinutes) continue;
    const counted = countedIngredients(recipe, profile.staples);
    if (filters.maxIngredients !== undefined && counted.length > filters.maxIngredients) continue;

    const have: string[] = [];
    const missing: string[] = [];
    const usesExpiring: string[] = [];
    let urgency = 0;
    let usesPartial: string | undefined;

    for (const name of counted) {
      const item = findItemFor(inventory, name, today);
      if (!item) {
        missing.push(name);
        continue;
      }
      have.push(name);
      const d = daysUntil(item.expiresAt, today);
      if (d <= warn) {
        usesExpiring.push(item.name);
        // Expires today = biggest boost.
        urgency += (warn + 1 - d) * 3;
      }
      if (item.qtyLevel !== 'full' && !usesPartial) usesPartial = item.name;
    }

    if (missing.length > filters.canBuy) continue;
    // Need at least one thing from the fridge, or it's just a shopping trip.
    if (have.length === 0) continue;

    const t = tasteScore(recipe, taste);
    const reasons: string[] = [];
    if (usesExpiring.length) reasons.push(`Uses up ${listify(usesExpiring)} before it expires`);
    if (usesPartial) reasons.push(`Finishes your leftover ${usesPartial}`);
    if (missing.length === 0) reasons.push('You have everything');
    else reasons.push(`Just grab ${listify(missing)}`);
    if (t >= 2) reasons.push('Matches what you like');
    if (recipe.minutes <= 15) reasons.push(`Ready in ${recipe.minutes} min`);

    const score =
      20 +
      urgency +
      (usesPartial ? 4 : 0) +
      t * 2 -
      missing.length * 6 +
      have.length * 1.5 -
      recipe.minutes / 15;

    out.push({ recipe, have, missing, usesExpiring, score, reasons });
  }

  return out.sort((a, b) => b.score - a.score);
}

/**
 * "Buy X to unlock N recipes": the shopping ingredients that would open up the
 * most recipes you can't currently make.
 */
export function unlockSuggestions(
  recipes: Recipe[],
  inventory: InventoryItem[],
  profile: Profile,
  today: Date = new Date(),
): { ingredient: string; unlocks: string[] }[] {
  const counts = new Map<string, Set<string>>();
  for (const r of recipes) {
    if (violatesAllergies(r, profile.allergies)) continue;
    const counted = countedIngredients(r, profile.staples);
    const missing = counted.filter((n) => !findItemFor(inventory, n, today));
    if (missing.length !== 1 || counted.length === 1) continue;
    const key = missing[0];
    if (!counts.has(key)) counts.set(key, new Set());
    counts.get(key)!.add(r.title);
  }
  return [...counts.entries()]
    .map(([ingredient, s]) => ({ ingredient, unlocks: [...s] }))
    .sort((a, b) => b.unlocks.length - a.unlocks.length);
}

function listify(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
}
