// Turn recipe-site ingredient lines into matchable ingredients:
//   "2 large yellow onions, thinly sliced"  → { name: 'onion', use: 'all' }
//   "1/2 cup heavy cream"                    → { name: 'heavy cream', use: 'some' }
//   "Salt and pepper, to taste"              → { name: 'salt', ..., optional: true }

import type { RecipeIngredient, UseAmount } from './types';
import { normalizeName } from './normalize';

const UNICODE_FRACTIONS: Record<string, string> = {
  '½': ' 1/2', '⅓': ' 1/3', '⅔': ' 2/3', '¼': ' 1/4', '¾': ' 3/4', '⅛': ' 1/8', '⅕': ' 1/5',
};

/** Measured units mean "some of a package", not whole items. */
const MEASURE_UNITS =
  'cups?|c\\.|tablespoons?|tbsps?|tbs|T|teaspoons?|tsps?|t|ounces?|oz|fl\\.? ?oz|pounds?|lbs?|grams?|g|kilograms?|kg|ml|milliliters?|liters?|l|pinch(es)?|dash(es)?|handfuls?|splash(es)?|quarts?|pints?|sprigs?|drops?';
/** Count-like units: "2 cans", "3 cloves" — one recipe ingredient each. */
const COUNT_UNITS =
  'cans?|jars?|packages?|pkgs?|packs?|bags?|boxes?|bunch(es)?|heads?|cloves?|slices?|sticks?|pieces?|stalks?|fillets?|links?|loaves|loaf|containers?|bottles?|ears?|leaves';

const PREP_WORDS = new Set([
  'chopped', 'diced', 'minced', 'sliced', 'thinly', 'finely', 'roughly', 'coarsely', 'grated', 'shredded',
  'peeled', 'seeded', 'cubed', 'crushed', 'melted', 'softened', 'beaten', 'divided', 'packed', 'rinsed',
  'drained', 'trimmed', 'halved', 'quartered', 'julienned', 'toasted', 'cooked', 'uncooked', 'cold',
  'warm', 'hot', 'room', 'temperature', 'boneless', 'skinless', 'extra-virgin', 'extra', 'virgin',
  'kosher', 'freshly', 'ground', 'about', 'approximately', 'heaping', 'level', 'scant', 'plus', 'more',
  'bone-in', 'skin-on', 'long-grain', 'short-grain', 'all-purpose', 'low-sodium', 'unsalted', 'salted',
  'large', 'medium', 'small', 'big', 'fresh', 'dried', 'whole', 'good', 'quality', 'optional', 'to',
  'taste', 'for', 'serving', 'garnish', 'of', 'a', 'an', 'the', 'or', 'and', 'yellow', 'white', 'red',
]);

/** Words to keep even though they look like descriptors ("ground beef" ≠ "beef"). */
const KEEP_PAIRS = ['ground beef', 'ground turkey', 'ground pork', 'ground chicken', 'red pepper flake', 'green onion', 'red onion', 'sour cream', 'heavy cream', 'brown sugar', 'olive oil', 'black pepper', 'black bean', 'bell pepper', 'sweet potato', 'cream cheese'];

function toNumber(q: string): number {
  return q
    .trim()
    .split(/\s+/)
    .reduce((sum, part) => {
      if (part.includes('/')) {
        const [a, b] = part.split('/').map(Number);
        return sum + (b ? a / b : 0);
      }
      return sum + (Number(part) || 0);
    }, 0);
}

export function parseIngredientLine(raw: string): RecipeIngredient | null {
  let s = raw;
  for (const [k, v] of Object.entries(UNICODE_FRACTIONS)) s = s.split(k).join(v);
  s = s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;

  const optional = /\b(optional|to taste|for garnish|for serving|if desired)\b/.test(s);
  // Drop parentheticals ("(14-ounce)") and anything after a comma (prep notes).
  s = s.replace(/\([^)]*\)/g, ' ').split(',')[0];
  // "salt and pepper" → keep the first ingredient.
  s = s.replace(/\s+(and|or|&)\s+.*$/, (m) => (/\bpepper\b|\boil\b/.test(m) ? '' : m));

  // Quantity: "2", "1 1/2", "1/2", "2-3", "1.5"
  const qty = s.match(/^((\d+\s+)?\d+\/\d+|\d+(\.\d+)?)(\s*(-|to)\s*\d+(\.\d+)?)?\s*/);
  let amount: number | undefined;
  if (qty) {
    amount = toNumber(qty[1]);
    s = s.slice(qty[0].length);
  }
  let measured = false;
  let bigByWeight = false;
  const measure = s.match(new RegExp(`^(${MEASURE_UNITS})\\b\\.?\\s*(of\\s+)?`));
  if (measure) {
    measured = true;
    // "1½ lb chicken" is a whole package, not "some" — weights over ~¾ lb use it all.
    const unit = measure[1];
    const n = amount ?? 1;
    bigByWeight =
      (/^(pounds?|lbs?)$/.test(unit) && n >= 0.75) ||
      (/^(ounces?|oz)$/.test(unit) && n >= 12) ||
      (/^(grams?|g)$/.test(unit) && n >= 340) ||
      /^(kilograms?|kg)$/.test(unit);
    s = s.slice(measure[0].length);
  } else {
    const count = s.match(new RegExp(`^(${COUNT_UNITS})\\b\\s*(of\\s+)?`));
    if (count) s = s.slice(count[0].length);
  }

  let text = s.replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const kept = KEEP_PAIRS.find((p) => text.includes(p) || text.includes(p + 's'));
  let name: string;
  if (kept) {
    name = kept;
  } else {
    text = text
      .split(' ')
      .filter((w) => w && !PREP_WORDS.has(w))
      .join(' ');
    name = normalizeName(text);
  }
  if (!name || name.length < 2) return null;

  let use: UseAmount = 'all';
  if (measured) use = bigByWeight ? 'all' : 'some';
  else if (amount !== undefined && amount < 1) use = amount <= 0.3 ? 'some' : 'half';
  return { name, use, ...(optional ? { optional: true } : {}) };
}

export function parseIngredientLines(lines: string[]): RecipeIngredient[] {
  const out: RecipeIngredient[] = [];
  for (const l of lines) {
    const ing = parseIngredientLine(l);
    if (!ing) continue;
    if (out.some((o) => o.name === ing.name)) continue;
    out.push(ing);
  }
  return out;
}
