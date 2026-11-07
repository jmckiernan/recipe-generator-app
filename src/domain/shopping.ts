// Shopping list suggestions (feature #7): what to buy, and why.

import type { InventoryItem, Profile, Rating, Recipe, ShoppingItem } from './types';
import { ingredientMatches } from './normalize';
import { unlockSuggestions } from './matcher';
import { adjacentSuggestions, buildTaste, isAllergen } from './taste';
import { findItemFor } from './inventory';

export interface ListSuggestion {
  name: string;
  reason: string;
}

/** True if an item with this name is already on the list (unchecked). */
export function onList(list: ShoppingItem[], name: string): boolean {
  return list.some((l) => !l.checked && (ingredientMatches(l.name, name) || ingredientMatches(name, l.name)));
}

/**
 * Suggestions for the shopping list, in priority order:
 * 1. Things you regularly use up and don't have right now ("you usually have eggs").
 * 2. Single ingredients that unlock the most recipes.
 * 3. New ingredients you'd probably like, based on your taste.
 */
export function listSuggestions(args: {
  inventory: InventoryItem[];
  recipes: Recipe[];
  profile: Profile;
  ratings: Rating[];
  list: ShoppingItem[];
  /** name → how many times it was used up (from the usage log). */
  usedCounts: Map<string, number>;
  today?: Date;
}): ListSuggestion[] {
  const { inventory, recipes, profile, ratings, list, usedCounts } = args;
  const today = args.today ?? new Date();
  const out: ListSuggestion[] = [];
  const add = (s: ListSuggestion) => {
    if (onList(list, s.name)) return;
    if (out.some((o) => ingredientMatches(o.name, s.name))) return;
    if (isAllergen(s.name, profile.allergies)) return;
    out.push(s);
  };

  const regulars = [...usedCounts.entries()]
    .filter(([name, n]) => n >= 2 && !name.startsWith('leftover') && !findItemFor(inventory, name, today))
    .sort((a, b) => b[1] - a[1]);
  for (const [name, n] of regulars.slice(0, 5)) add({ name, reason: `You've used this up ${n} times` });

  for (const u of unlockSuggestions(recipes, inventory, profile, today).slice(0, 4)) {
    add({
      name: u.ingredient,
      reason: `Unlocks ${u.unlocks.length} ${u.unlocks.length === 1 ? 'recipe' : 'recipes'}: ${u.unlocks.slice(0, 2).join(', ')}`,
    });
  }

  const taste = buildTaste(profile, ratings);
  for (const a of adjacentSuggestions(taste, inventory.map((i) => i.name)).slice(0, 2)) {
    add({ name: a.name, reason: `Try it: you like ${a.because}, and it's ${a.why}` });
  }
  return out;
}
