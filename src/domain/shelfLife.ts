// Default shelf-life estimates so users don't have to type expiry dates.
// These are conservative, home-kitchen numbers; the user can override any item.

import type { Category, Location } from './types';
import { coreName } from './normalize';

/** Days until "use it up" for each category, by storage location. */
const SHELF_DAYS: Record<Category, Record<Location, number>> = {
  meat: { fridge: 3, freezer: 120, pantry: 0 },
  poultry: { fridge: 2, freezer: 270, pantry: 0 },
  seafood: { fridge: 2, freezer: 90, pantry: 0 },
  deli: { fridge: 5, freezer: 60, pantry: 0 },
  dairy: { fridge: 7, freezer: 60, pantry: 0 },
  cheese: { fridge: 21, freezer: 120, pantry: 0 },
  eggs: { fridge: 28, freezer: 0, pantry: 0 },
  leafy: { fridge: 5, freezer: 0, pantry: 0 },
  produce: { fridge: 7, freezer: 240, pantry: 4 },
  hardy_produce: { fridge: 21, freezer: 240, pantry: 30 },
  fruit: { fridge: 7, freezer: 240, pantry: 4 },
  herbs: { fridge: 7, freezer: 120, pantry: 0 },
  bread: { fridge: 10, freezer: 90, pantry: 5 },
  grain: { fridge: 180, freezer: 365, pantry: 365 },
  condiment: { fridge: 90, freezer: 180, pantry: 365 },
  leftovers: { fridge: 4, freezer: 90, pantry: 0 },
  other: { fridge: 7, freezer: 90, pantry: 90 },
};

/** Keyword → category. First match wins, so put specific words first. */
const KEYWORDS: [RegExp, Category][] = [
  [/\b(leftover|meal prep)\b/, 'leftovers'],
  [/\b(turkey|ham|salami|pepperoni|prosciutto|bologna|roast beef|deli)\b/, 'deli'],
  [/\b(chicken|duck|poultry)\b/, 'poultry'],
  [/\b(beef|steak|pork|lamb|sausage|bacon|ground|veal|chorizo)\b/, 'meat'],
  [/\b(salmon|tuna|shrimp|fish|cod|tilapia|scallop|crab|lobster)\b/, 'seafood'],
  [/\b(cheese|cheddar|mozzarella|parmesan|feta|brie|gouda|swiss|provolone)\b/, 'cheese'],
  [/\b(egg)\b/, 'eggs'],
  [/\b(milk|yogurt|cream|butter|sour cream|cottage)\b/, 'dairy'],
  [/\b(lettuce|spinach|arugula|kale|greens|romaine|chard|cabbage)\b/, 'leafy'],
  [/\b(basil|cilantro|parsley|mint|dill|thyme|rosemary|chive|scallion|green onion)\b/, 'herbs'],
  [/\b(onion|shallot|garlic|potato|sweet potato|carrot|squash|beet|ginger|celery)\b/, 'hardy_produce'],
  [/\b(apple|banana|orange|lemon|lime|berry|grape|pear|peach|mango|avocado|melon)\b/, 'fruit'],
  [/\b(tomato|pepper|zucchini|cucumber|broccoli|cauliflower|mushroom|corn|bean sprout|asparagus|eggplant|green bean)\b/, 'produce'],
  [/\b(bread|bun|roll|bagel|tortilla|pita|naan|english muffin)\b/, 'bread'],
  [/\b(rice|pasta|noodle|oat|quinoa|flour|lentil|bean|chickpea|couscous)\b/, 'grain'],
  [/\b(ketchup|mustard|mayo|mayonnaise|sauce|salsa|dressing|jam|soy|vinegar|pesto|hummus)\b/, 'condiment'],
];

export function categorize(name: string): Category {
  // Check before descriptors are stripped: coreName drops the word "leftover".
  if (/\b(leftover|meal prep)\b/.test(name.toLowerCase())) return 'leftovers';
  const n = coreName(name);
  for (const [re, cat] of KEYWORDS) if (re.test(n)) return cat;
  return 'other';
}

/** Sensible default storage location for a category. */
export function defaultLocation(cat: Category): Location {
  if (cat === 'grain') return 'pantry';
  if (cat === 'hardy_produce') return 'pantry';
  return 'fridge';
}

export function shelfDays(cat: Category, loc: Location): number {
  const d = SHELF_DAYS[cat][loc];
  // 0 means "don't store it here"; fall back to the fridge number.
  return d > 0 ? d : SHELF_DAYS[cat].fridge;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function estimateExpiry(cat: Category, loc: Location, purchasedAt: string): string {
  return addDays(purchasedAt, shelfDays(cat, loc));
}

/** Whole days from `today` until `iso` (negative = already past). */
export function daysUntil(iso: string, today: Date = new Date()): number {
  const a = new Date(toISODate(today) + 'T00:00:00');
  const b = new Date(iso + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Freezing suggestion: if an item expires within `warnDays`, lives in the fridge,
 * and freezes well, suggest moving it to the freezer instead of losing it.
 */
export function shouldSuggestFreezing(
  cat: Category,
  loc: Location,
  expiresAt: string,
  warnDays: number,
  today: Date = new Date(),
): boolean {
  if (loc !== 'fridge') return false;
  if (SHELF_DAYS[cat].freezer <= 0) return false;
  if (['leafy', 'eggs', 'condiment', 'grain'].includes(cat)) return false;
  const d = daysUntil(expiresAt, today);
  return d >= 0 && d <= warnDays;
}
