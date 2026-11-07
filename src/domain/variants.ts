// Lighter / classic / hearty versions of any recipe (feature #14: cut vs bulk).
// Rule-based so it works offline on built-in and AI recipes alike.

import type { Recipe, RecipeIngredient, Style, UseAmount } from './types';
import { coreName, ingredientMatches } from './normalize';
import { violatesAllergies } from './taste';

/**
 * Very rough calories one serving gets from an ingredient when the recipe uses
 * "all" of a typical unit. half = ×0.5, some = ×0.35. Good enough to compare
 * versions of the same dish, not for tracking macros.
 */
const KCAL: Record<string, number> = {
  butter: 100, 'olive oil': 120, 'vegetable oil': 120, cream: 200, 'greek yogurt': 60, yogurt: 80,
  'sour cream': 120, mayo: 180, cheese: 220, cheddar: 220, mozzarella: 170, parmesan: 110,
  'cream cheese': 200, egg: 140, 'egg white': 35, milk: 60,
  chicken: 280, 'chicken thigh': 320, 'chicken breast': 250, turkey: 160, 'ground turkey': 250,
  'ground beef': 380, beef: 380, steak: 400, sausage: 400, 'chicken sausage': 220, bacon: 220,
  'turkey bacon': 100, shrimp: 120, salmon: 360, tofu: 180, 'black bean': 200,
  pasta: 400, 'whole-wheat pasta': 360, rice: 340, 'brown rice': 320, 'cauliflower rice': 40,
  quinoa: 300, bread: 160, 'whole-grain bread': 140, tortilla: 210, 'low-carb tortilla': 90,
  'lettuce wrap': 10, potato: 220, 'sweet potato': 180, avocado: 160, granola: 200,
  'peanut butter': 190, honey: 60, banana: 105, berry: 40, tomato: 25, onion: 30, 'bell pepper': 25,
  spinach: 10, lettuce: 10, broccoli: 35, cucumber: 10, mushroom: 15, carrot: 25, salsa: 15,
  dressing: 120, 'orange juice': 60, flour: 110, sugar: 50, 'soy sauce': 10, 'bbq sauce': 70,
};

const USE_FACTOR: Record<UseAmount, number> = { all: 1, half: 0.5, some: 0.35 };

function kcalOf(name: string): number {
  const n = coreName(name);
  if (KCAL[n] !== undefined) return KCAL[n];
  const key = Object.keys(KCAL).find((k) => ingredientMatches(n, k));
  return key ? KCAL[key] : 40;
}

/** Rough calories per serving. Optional ingredients count at half weight. */
export function estimateKcal(recipe: Recipe): number {
  const total = recipe.ingredients.reduce(
    (sum, i) => sum + kcalOf(i.name) * USE_FACTOR[i.use] * (i.optional ? 0.5 : 1),
    0,
  );
  return Math.round(total / 10) * 10;
}

interface Swap {
  from: string;
  to: string;
  use?: UseAmount;
  note: string;
}

const LIGHTER_SWAPS: Swap[] = [
  { from: 'cream', to: 'greek yogurt', note: 'Greek yogurt instead of cream (stir in off the heat)' },
  { from: 'sour cream', to: 'greek yogurt', note: 'Greek yogurt instead of sour cream' },
  { from: 'mayo', to: 'greek yogurt', note: 'Greek yogurt instead of mayo' },
  { from: 'ground beef', to: 'ground turkey', note: 'Ground turkey instead of beef' },
  { from: 'sausage', to: 'chicken sausage', note: 'Chicken sausage instead of pork sausage' },
  { from: 'bacon', to: 'turkey bacon', note: 'Turkey bacon instead of bacon' },
  { from: 'chicken thigh', to: 'chicken breast', note: 'Chicken breast instead of thighs' },
  { from: 'rice', to: 'cauliflower rice', note: 'Cauliflower rice (or half rice, half cauliflower)' },
  { from: 'pasta', to: 'whole-wheat pasta', use: 'some', note: 'A smaller portion of whole-wheat pasta' },
  { from: 'tortilla', to: 'low-carb tortilla', note: 'Low-carb tortillas (or lettuce wraps)' },
  { from: 'bread', to: 'whole-grain bread', note: 'Whole-grain bread' },
  { from: 'butter', to: 'olive oil', use: 'some', note: 'A teaspoon of olive oil instead of butter' },
];

/** Ingredients that get cut back rather than swapped in the lighter version. */
const CUT_BACK = ['cheese', 'cheddar', 'mozzarella', 'parmesan', 'granola', 'peanut butter', 'dressing', 'honey'];

const PROTEINS = ['chicken', 'beef', 'turkey', 'shrimp', 'salmon', 'sausage', 'egg', 'tofu', 'steak', 'pork'];

export interface Variant {
  recipe: Recipe;
  changes: string[];
  kcal: number;
}

/**
 * @param have Optional "is this in my kitchen?" check. When you have the original
 *   ingredient but not the lighter swap, the swap becomes a suggestion and the
 *   original stays (in a smaller amount), so a lighter version never sends you shopping.
 */
export function makeVariant(
  recipe: Recipe,
  style: Style,
  allergies: string[] = [],
  have?: (name: string) => boolean,
): Variant {
  if (style === 'classic') return { recipe, changes: [], kcal: estimateKcal(recipe) };

  let ingredients: RecipeIngredient[] = recipe.ingredients.map((i) => ({ ...i }));
  const changes: string[] = [];
  const has = (n: string) => ingredients.some((i) => ingredientMatches(i.name, n));
  // Only accept a change if it doesn't introduce an allergen.
  const safe = (ings: RecipeIngredient[]) => !violatesAllergies({ ...recipe, ingredients: ings }, allergies);

  if (style === 'lighter') {
    for (const swap of LIGHTER_SWAPS) {
      const idx = ingredients.findIndex((i) => ingredientMatches(i.name, swap.from) && coreName(i.name) !== coreName(swap.to));
      if (idx < 0) continue;
      const original = ingredients[idx];
      if (have && have(original.name) && !have(swap.to)) {
        if (original.use !== 'some') {
          ingredients = ingredients.map((ing, j) => (j === idx ? { ...ing, use: 'some' as UseAmount } : ing));
          changes.push(`Use a smaller portion of ${original.name} (or swap in ${swap.to} if you have it)`);
        } else {
          changes.push(`Swap in ${swap.to} if you have it`);
        }
        continue;
      }
      const next = ingredients.slice();
      next[idx] = { ...original, name: swap.to, use: swap.use ?? original.use };
      if (!safe(next)) continue;
      ingredients = next;
      changes.push(swap.note);
    }
    for (const c of CUT_BACK) {
      const ing = ingredients.find((i) => ingredientMatches(i.name, c) && i.use !== 'some');
      if (!ing) continue;
      ing.use = 'some';
      changes.push(`Use about half the ${ing.name}`);
    }
    if (!has('spinach') && !has('broccoli') && recipe.kind === 'recipe') {
      const next = [...ingredients, { name: 'spinach', use: 'half' as UseAmount, optional: true }];
      if (safe(next)) {
        ingredients = next;
        changes.push('Bulk it up with a big handful of spinach (more food, few calories)');
      }
    }
    changes.push('Cook with a light spray of oil instead of a pour');
  }

  if (style === 'hearty') {
    const protein = ingredients.find((i) => PROTEINS.some((p) => ingredientMatches(i.name, p)));
    if (protein) {
      changes.push(`Double the ${protein.name} for more protein`);
    } else {
      const next = [...ingredients, { name: 'egg', use: 'all' as UseAmount, optional: true }];
      if (safe(next)) {
        ingredients = next;
        changes.push('Add a fried egg on top for protein');
      }
    }
    const extras: [string, string][] = [
      ['cheese', 'Finish with a good handful of cheese'],
      ['avocado', 'Add sliced avocado'],
      ['rice', 'Serve over rice'],
      ['bread', 'Serve with crusty bread'],
    ];
    let added = 0;
    for (const [name, note] of extras) {
      if (added >= 2 || has(name)) continue;
      if (name === 'bread' && (has('rice') || has('pasta') || has('tortilla'))) continue;
      if (name === 'rice' && (has('bread') || has('pasta') || has('tortilla') || recipe.kind === 'assembly')) continue;
      const next = [...ingredients, { name, use: 'some' as UseAmount, optional: true }];
      if (!safe(next)) continue;
      ingredients = next;
      changes.push(note);
      added += 1;
    }
    changes.push('Be generous with the olive oil or butter');
  }

  const out: Recipe = {
    ...recipe,
    id: `${recipe.id}~${style}`,
    title: `${recipe.title} (${style === 'lighter' ? 'lighter' : 'hearty'})`,
    ingredients,
    tags: [...recipe.tags, style],
  };

  // Hearty doubles the protein, which a plain ingredient list can't express, so add it to the estimate.
  let kcal = estimateKcal(out);
  if (style === 'hearty') {
    const protein = ingredients.find((i) => PROTEINS.some((p) => ingredientMatches(i.name, p)));
    if (protein) kcal += Math.round((kcalOf(protein.name) * USE_FACTOR[protein.use]) / 10) * 10;
    kcal += 60; // the extra oil or butter
  }
  return { recipe: out, changes, kcal };
}

/** Parse "<baseId>~lighter" back into its parts. */
export function parseVariantId(id: string): { baseId: string; style: Style } {
  const [baseId, style] = id.split('~');
  return { baseId, style: style === 'lighter' || style === 'hearty' ? style : 'classic' };
}
