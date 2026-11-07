// Lightweight preference learning: explicit likes/dislikes + star ratings
// become per-ingredient and per-tag scores. No ML model needed for v1.

import type { Profile, Rating, Recipe } from './types';
import { coreName, ingredientMatches } from './normalize';

/**
 * "If you like X, you'll probably like Y." Used to suggest adjacent ingredients
 * (feature #11: likes onions → try shallots) and to explain why.
 */
export const ADJACENT: Record<string, { name: string; why: string }[]> = {
  onion: [
    { name: 'shallot', why: 'milder and sweeter than onion, great raw in dressings' },
    { name: 'leek', why: 'onion flavor that turns silky and mellow when cooked' },
  ],
  garlic: [{ name: 'shallot', why: 'similar savory depth with less bite' }],
  spinach: [
    { name: 'swiss chard', why: 'same quick-wilting greens with a bit more body' },
    { name: 'arugula', why: 'peppery leafy green that works raw or wilted' },
  ],
  lettuce: [{ name: 'arugula', why: 'adds a peppery kick to the salads you already make' }],
  cheddar: [
    { name: 'gruyere', why: 'nutty, melts even better than cheddar' },
    { name: 'gouda', why: 'creamy and mild with similar melt' },
  ],
  potato: [{ name: 'sweet potato', why: 'same comfort with more sweetness and fiber' }],
  chicken: [{ name: 'turkey', why: 'lean and mild, swaps 1:1 in most chicken dishes' }],
  beef: [{ name: 'lamb', why: 'richer red meat for when you want to switch it up' }],
  basil: [{ name: 'mint', why: 'bright herb that plays the same role in fresh dishes' }],
  lemon: [{ name: 'lime', why: 'same acidity with a more tropical edge' }],
  pasta: [{ name: 'gnocchi', why: 'pillowy pasta alternative that pan-fries crisp' }],
  rice: [{ name: 'quinoa', why: 'similar base with more protein' }],
  bacon: [{ name: 'pancetta', why: 'Italian cured pork with that same savory crunch' }],
  salsa: [{ name: 'pico de gallo', why: 'fresh version of the salsa you like' }],
};

export interface TasteModel {
  ingredient: Map<string, number>;
  tag: Map<string, number>;
}

/** Ratings: 3 stars is neutral, 5 = +2, 1 = -2. Explicit likes are worth +3. */
export function buildTaste(profile: Profile, ratings: Rating[]): TasteModel {
  const ingredient = new Map<string, number>();
  const tag = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, v: number) =>
    m.set(k, (m.get(k) ?? 0) + v);

  for (const l of profile.likes) {
    bump(ingredient, coreName(l), 3);
    bump(tag, l.toLowerCase(), 3);
  }
  for (const d of profile.dislikes) {
    bump(ingredient, coreName(d), -5);
    bump(tag, d.toLowerCase(), -5);
  }
  for (const r of ratings) {
    const delta = r.stars - 3;
    for (const i of r.ingredients) bump(ingredient, coreName(i), delta * 0.5);
    for (const t of r.tags) bump(tag, t.toLowerCase(), delta);
  }
  return { ingredient, tag };
}

export function tasteScore(recipe: Recipe, taste: TasteModel): number {
  let s = 0;
  for (const ing of recipe.ingredients) s += taste.ingredient.get(coreName(ing.name)) ?? 0;
  for (const t of recipe.tags) s += taste.tag.get(t.toLowerCase()) ?? 0;
  if (recipe.cuisine) s += taste.tag.get(recipe.cuisine.toLowerCase()) ?? 0;
  return s;
}

/** Ingredients the user likes, mapped to adjacent ones they haven't tried. */
export function adjacentSuggestions(
  taste: TasteModel,
  alreadyKnown: string[],
): { name: string; because: string; why: string }[] {
  const out: { name: string; because: string; why: string }[] = [];
  const liked = [...taste.ingredient.entries()]
    .filter(([, v]) => v >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  for (const l of liked) {
    for (const adj of ADJACENT[l] ?? []) {
      if (alreadyKnown.some((k) => ingredientMatches(k, adj.name))) continue;
      if (out.some((o) => o.name === adj.name)) continue;
      out.push({ name: adj.name, because: l, why: adj.why });
    }
  }
  return out;
}

/** Hard allergy check. Never treat allergies as a preference. */
export function violatesAllergies(recipe: Recipe, allergies: string[]): boolean {
  if (allergies.length === 0) return false;
  const terms = allergies.map((a) => a.toLowerCase().trim()).filter(Boolean);
  const expand = (a: string): string[] => ALLERGEN_GROUPS[a] ?? [a];
  const all = terms.flatMap(expand);
  return recipe.ingredients.some((ing) => {
    const n = ing.name.toLowerCase();
    return all.some((a) => n.includes(a) || ingredientMatches(n, a));
  });
}

/** Common allergen groups → ingredient words that contain them. */
const ALLERGEN_GROUPS: Record<string, string[]> = {
  dairy: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'gruyere', 'gouda', 'provolone', 'brie', 'sour cream'],
  gluten: ['bread', 'pasta', 'flour', 'tortilla', 'bun', 'bagel', 'pita', 'naan', 'noodle', 'couscous', 'soy sauce', 'gnocchi', 'english muffin', 'crouton'],
  shellfish: ['shrimp', 'crab', 'lobster', 'scallop', 'clam', 'mussel', 'oyster'],
  nuts: ['almond', 'walnut', 'pecan', 'cashew', 'pistachio', 'hazelnut', 'peanut', 'pine nut'],
  'tree nuts': ['almond', 'walnut', 'pecan', 'cashew', 'pistachio', 'hazelnut', 'pine nut'],
  peanut: ['peanut'],
  peanuts: ['peanut'],
  egg: ['egg', 'mayo', 'mayonnaise'],
  eggs: ['egg', 'mayo', 'mayonnaise'],
  fish: ['salmon', 'tuna', 'cod', 'tilapia', 'anchovy', 'fish'],
  soy: ['soy', 'tofu', 'edamame'],
  sesame: ['sesame', 'tahini'],
};
