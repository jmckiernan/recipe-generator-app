// Meal prep / batch cooking for the week (feature #13).
// Greedy planner: pick recipes one at a time, "cook" each against a simulated
// inventory, then pick the next, so the plan never double-counts food.

import type { InventoryItem, Profile, Rating, Recipe, Suggestion } from './types';
import { changesForCooking } from './inventory';
import { suggest } from './matcher';
import { coreName, ingredientMatches } from './normalize';

export interface MealPrepOptions {
  /** How many different dishes to prep. */
  dishes: number;
  /** Missing ingredients allowed per dish. */
  canBuy: number;
  /** Make each dish as a double batch. */
  doubleBatch: boolean;
}

export interface MealPrepPlan {
  picks: Suggestion[];
  shopping: string[];
  usesExpiring: string[];
  totalServings: number;
  /** Order to start cooking: longest first, so everything finishes together. */
  order: string[];
}

const MAIN_PROTEINS = ['chicken', 'beef', 'turkey', 'pork', 'sausage', 'shrimp', 'salmon', 'tofu', 'egg', 'bean'];

function mainProtein(r: Recipe): string | undefined {
  for (const ing of r.ingredients) {
    const p = MAIN_PROTEINS.find((m) => ingredientMatches(ing.name, m));
    if (p && !ing.optional) return p;
  }
  return undefined;
}

export function planMealPrep(
  recipes: Recipe[],
  inventory: InventoryItem[],
  profile: Profile,
  ratings: Rating[],
  opts: MealPrepOptions,
  today: Date = new Date(),
): MealPrepPlan {
  // Assemblies (sandwiches) don't prep well; meal-prep tagged dishes do.
  const pool = recipes.filter((r) => r.kind === 'recipe');
  let inv = inventory.map((i) => ({ ...i }));
  const picks: Suggestion[] = [];
  const usedProteins = new Set<string>();
  const usedCuisines = new Set<string>();

  for (let n = 0; n < opts.dishes; n++) {
    const ranked = suggest(pool, inv, profile, ratings, { canBuy: opts.canBuy }, today)
      .filter((s) => !picks.some((p) => p.recipe.id === s.recipe.id))
      .map((s) => {
        let bonus = 0;
        if (s.recipe.tags.includes('meal-prep')) bonus += 8;
        const p = mainProtein(s.recipe);
        if (p && usedProteins.has(p)) bonus -= 10; // variety: not chicken three ways
        if (s.recipe.cuisine && usedCuisines.has(s.recipe.cuisine)) bonus -= 4;
        return { s, score: s.score + bonus };
      })
      .sort((a, b) => b.score - a.score);
    const best = ranked[0]?.s;
    if (!best) break;
    picks.push(best);
    const p = mainProtein(best.recipe);
    if (p) usedProteins.add(p);
    if (best.recipe.cuisine) usedCuisines.add(best.recipe.cuisine);

    // Simulate cooking it (twice for a double batch) so the next pick sees what's left.
    const times = opts.doubleBatch ? 2 : 1;
    for (let t = 0; t < times; t++) {
      const changes = changesForCooking(inv, best.recipe, profile.staples, today);
      inv = inv
        .map((i) => {
          const c = changes.find((x) => x.id === i.id);
          if (!c) return i;
          return c.kind === 'remove' ? null : { ...i, count: c.count, qtyLevel: c.qtyLevel };
        })
        .filter((i): i is InventoryItem => i !== null);
    }
  }

  const shopping: string[] = [];
  for (const p of picks) {
    for (const m of p.missing) if (!shopping.some((s) => coreName(s) === coreName(m))) shopping.push(m);
  }
  const usesExpiring = Array.from(new Set(picks.flatMap((p) => p.usesExpiring)));
  const totalServings = picks.reduce((sum, p) => sum + (p.recipe.servings ?? 2) * (opts.doubleBatch ? 2 : 1), 0);
  const order = picks
    .slice()
    .sort((a, b) => b.recipe.minutes - a.recipe.minutes)
    .map((p) => p.recipe.title);

  return { picks, shopping, usesExpiring, totalServings, order };
}
