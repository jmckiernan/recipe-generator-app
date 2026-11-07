// Rough per-serving nutrition (feature: nutrition & macros).
// Each entry is what one serving gets when a recipe uses "all" of a typical unit.
// Good for comparing dishes and versions; not a medical-grade tracker.

import type { Goal, Recipe, Style, UseAmount } from './types';
import { coreName, ingredientMatches } from './normalize';

export interface Macros {
  kcal: number;
  protein: number; // grams
  carbs: number;
  fat: number;
}

//                         kcal  P   C   F
const M: Record<string, [number, number, number, number]> = {
  butter: [100, 0, 0, 11], 'olive oil': [120, 0, 0, 14], 'vegetable oil': [120, 0, 0, 14],
  cream: [200, 1, 2, 21], 'heavy cream': [200, 1, 2, 21], 'greek yogurt': [60, 10, 4, 0],
  yogurt: [80, 5, 9, 2], 'sour cream': [120, 1, 2, 12], mayo: [180, 0, 0, 20],
  cheese: [220, 14, 1, 18], cheddar: [220, 14, 1, 18], mozzarella: [170, 13, 1, 12],
  parmesan: [110, 10, 1, 7], 'cream cheese': [200, 4, 2, 20], 'cottage cheese': [110, 13, 4, 5],
  egg: [140, 12, 1, 10], 'egg white': [35, 7, 0, 0], milk: [60, 3, 5, 3],
  chicken: [280, 45, 0, 10], 'chicken thigh': [320, 38, 0, 18], 'chicken breast': [250, 47, 0, 5],
  turkey: [160, 26, 2, 5], 'ground turkey': [250, 30, 0, 14], 'ground beef': [380, 30, 0, 28],
  beef: [380, 34, 0, 26], steak: [400, 40, 0, 26], sausage: [400, 18, 2, 35],
  'chicken sausage': [220, 18, 3, 14], bacon: [220, 15, 0, 17], 'turkey bacon': [100, 10, 1, 6],
  shrimp: [120, 24, 1, 2], salmon: [360, 38, 0, 22], tofu: [180, 20, 4, 10],
  'black bean': [200, 13, 36, 1], chickpea: [210, 11, 35, 3], lentil: [230, 18, 40, 1],
  pasta: [400, 14, 80, 2], orzo: [400, 14, 80, 2], noodle: [380, 12, 76, 3], 'whole-wheat pasta': [360, 15, 74, 3], rice: [340, 7, 75, 1],
  'brown rice': [320, 7, 67, 3], 'cauliflower rice': [40, 3, 8, 0], quinoa: [300, 11, 54, 5],
  bread: [160, 6, 30, 2], 'whole-grain bread': [140, 7, 24, 2], tortilla: [210, 6, 35, 5],
  'low-carb tortilla': [90, 8, 18, 3], bun: [200, 7, 37, 3], potato: [220, 5, 50, 0],
  'sweet potato': [180, 4, 41, 0], avocado: [160, 2, 9, 15], granola: [200, 5, 30, 8],
  'peanut butter': [190, 8, 7, 16], honey: [60, 0, 17, 0], banana: [105, 1, 27, 0],
  orange: [60, 1, 15, 0], berry: [40, 1, 10, 0], tomato: [25, 1, 5, 0], onion: [30, 1, 7, 0],
  'bell pepper': [25, 1, 6, 0], spinach: [10, 1, 1, 0], lettuce: [10, 1, 2, 0], arugula: [5, 1, 1, 0],
  broccoli: [35, 3, 7, 0], cucumber: [10, 0, 2, 0], mushroom: [15, 2, 2, 0], carrot: [25, 1, 6, 0],
  salsa: [15, 1, 3, 0], dressing: [120, 0, 3, 12], flour: [110, 3, 23, 0], sugar: [50, 0, 13, 0],
  'soy sauce': [10, 1, 1, 0], pickle: [5, 0, 1, 0], tostada: [60, 1, 8, 3], lime: [10, 0, 3, 0],
  lemon: [10, 0, 3, 0], garlic: [5, 0, 1, 0],
};

const USE_FACTOR: Record<UseAmount, number> = { all: 1, half: 0.5, some: 0.35 };

function lookup(name: string): [number, number, number, number] {
  const n = coreName(name);
  if (M[n]) return M[n];
  const key = Object.keys(M).find((k) => ingredientMatches(n, k));
  return key ? M[key] : [40, 1, 6, 1];
}

export function estimateMacros(recipe: Recipe): Macros {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const i of recipe.ingredients) {
    const [k, p, c, f] = lookup(i.name);
    const w = USE_FACTOR[i.use] * (i.optional ? 0.5 : 1);
    t.kcal += k * w;
    t.protein += p * w;
    t.carbs += c * w;
    t.fat += f * w;
  }
  return {
    kcal: Math.round(t.kcal / 10) * 10,
    protein: Math.round(t.protein),
    carbs: Math.round(t.carbs),
    fat: Math.round(t.fat),
  };
}

/** Per-serving macros of one extra serving of an ingredient ("double the chicken"). */
export function ingredientMacros(name: string, use: UseAmount): Macros {
  const [k, p, c, f] = lookup(name);
  const w = USE_FACTOR[use];
  return { kcal: Math.round((k * w) / 10) * 10, protein: Math.round(p * w), carbs: Math.round(c * w), fat: Math.round(f * w) };
}

export function addMacros(a: Macros, b: Macros): Macros {
  return { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat };
}

/** Your goal picks the default recipe version. */
export function defaultStyle(goal: Goal | undefined): Style {
  return goal === 'cut' ? 'lighter' : goal === 'bulk' ? 'hearty' : 'classic';
}

/**
 * Use real nutrition when a site published it (schema.org NutritionInformation),
 * e.g. "320 calories" / "24 g".
 */
export function parseNutritionValue(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  const m = v.replace(',', '').match(/\d+(\.\d+)?/);
  return m ? Math.round(Number(m[0])) : undefined;
}
