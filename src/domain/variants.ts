// Lighter / classic / hearty versions of any recipe (feature #14: cut vs bulk).
// Rule-based so it works offline on built-in and AI recipes alike.

import type { Recipe, RecipeIngredient, Style, UseAmount } from './types';
import { coreName, ingredientMatches } from './normalize';
import { violatesAllergies } from './taste';
import { addMacros, estimateMacros, ingredientMacros, type Macros } from './nutrition';

/** Rough calories per serving (see nutrition.ts). */
export function estimateKcal(recipe: Recipe): number {
  return estimateMacros(recipe).kcal;
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
  macros: Macros;
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
  if (style === 'classic') {
    const macros = estimateMacros(recipe);
    return { recipe, changes: [], kcal: macros.kcal, macros };
  }

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
    const fats = ingredients.filter((i) => ['olive oil', 'vegetable oil', 'butter', 'oil'].some((f) => ingredientMatches(i.name, f)));
    if (fats.length) changes.push('Cook with a light spray of oil instead of a pour');
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
  let macros = estimateMacros(out);
  if (style === 'lighter') {
    // "A spray instead of a pour" ≈ half the cooking fat.
    for (const f of ingredients.filter((i) => ['olive oil', 'vegetable oil', 'butter', 'oil'].some((x) => ingredientMatches(i.name, x)))) {
      const m = ingredientMacros(f.name, f.use);
      macros = addMacros(macros, { kcal: -Math.round(m.kcal / 20) * 10, protein: 0, carbs: 0, fat: -Math.round(m.fat / 2) });
    }
  }
  if (style === 'hearty') {
    const protein = ingredients.find((i) => PROTEINS.some((p) => ingredientMatches(i.name, p)));
    if (protein) macros = addMacros(macros, ingredientMacros(protein.name, protein.use));
    macros = addMacros(macros, { kcal: 60, protein: 0, carbs: 0, fat: 7 }); // the extra oil or butter
  }
  return { recipe: out, changes, kcal: macros.kcal, macros };
}

/** Parse "<baseId>~lighter" back into its parts. */
export function parseVariantId(id: string): { baseId: string; style: Style } {
  const [baseId, style] = id.split('~');
  return { baseId, style: style === 'lighter' || style === 'hearty' ? style : 'classic' };
}
