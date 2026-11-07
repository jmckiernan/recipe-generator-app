// Ingredient name normalization so "Onions", "onion", and "red onion" can match.

const IRREGULAR: Record<string, string> = {
  tomatoes: 'tomato',
  potatoes: 'potato',
  leaves: 'leaf',
  loaves: 'loaf',
  knives: 'knife',
  berries: 'berry',
  cherries: 'cherry',
  anchovies: 'anchovy',
  chilies: 'chili',
  chillies: 'chili',
  eggs: 'egg',
  radishes: 'radish',
  peaches: 'peach',
  sandwiches: 'sandwich',
};

/** Words that never get singularized (mass nouns or words ending in "s"). */
const KEEP = new Set([
  'hummus',
  'couscous',
  'asparagus',
  'swiss',
  'molasses',
  'grits',
  'brussels',
  'greens',
  'citrus',
  'hibiscus',
]);

export function singularize(word: string): string {
  const w = word.toLowerCase();
  if (KEEP.has(w)) return w;
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

export function normalizeName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ');
  words[words.length - 1] = singularize(words[words.length - 1]);
  return words.join(' ');
}

/** Descriptors stripped when matching, so "red onion" satisfies "onion". */
const DESCRIPTORS = new Set([
  'red',
  'white',
  'yellow',
  'fresh',
  'large',
  'small',
  'baby',
  'sliced',
  'shredded',
  'chopped',
  'boneless',
  'skinless',
  'organic',
  'whole',
  'low-fat',
  'sharp',
  'mild',
  'deli',
  'leftover',
]);

export function coreName(name: string): string {
  const words = normalizeName(name)
    .split(' ')
    .filter((w) => !DESCRIPTORS.has(w));
  return words.join(' ') || normalizeName(name);
}

/**
 * Multi-word ingredients that are a different food from their last word.
 * "peanut butter" is not butter; "garlic powder" is not fresh garlic.
 */
const COMPOUNDS = new Set([
  'green onion',
  'green bean',
  'green pepper',
  'bell pepper',
  'sweet potato',
  'peanut butter',
  'almond butter',
  'garlic powder',
  'onion powder',
  'chili powder',
  'sour cream',
  'ice cream',
  'cream cheese',
  'coconut milk',
  'almond milk',
  'oat milk',
  'soy sauce',
  'hot sauce',
  'fish sauce',
  'chicken broth',
  'chicken stock',
  'beef broth',
  'pepper flake', // "red" is stripped as a descriptor
  // Lighter swaps are different foods from the generic word, so "rice" never counts as cauliflower rice.
  'cauliflower rice',
  'whole-wheat pasta',
  'whole-grain bread',
  'low-carb tortilla',
  'turkey bacon',
  'chicken sausage',
  'ground turkey',
  'rice vinegar',
  'tomato paste',
  'tomato sauce',
]);

/**
 * True when an inventory item can stand in for a recipe ingredient.
 * Matches on the core name, or when one name's last word is the other's head noun
 * ("cheddar cheese" covers "cheese", "chicken thigh" covers "chicken").
 */
export function ingredientMatches(inventoryName: string, recipeName: string): boolean {
  const a = coreName(inventoryName);
  const b = coreName(recipeName);
  if (a === b) return true;
  if (COMPOUNDS.has(a) || COMPOUNDS.has(b)) {
    // Only "green bell pepper" → "bell pepper" style suffix matches are allowed.
    return COMPOUNDS.has(b) && a.endsWith(' ' + b);
  }
  const aw = a.split(' ');
  const bw = b.split(' ');
  // "chicken thigh" vs "chicken": the recipe asks for the broader thing.
  if (bw.length === 1 && aw.includes(bw[0])) return true;
  // "green bell pepper" vs "bell pepper"; "aged cheddar cheese" vs "cheddar cheese".
  if (bw.length > 1 && a.endsWith(' ' + b)) return true;
  // Generic covers specific: fridge "rice" works for "long-grain rice", "cheese" for "goat cheese".
  if (aw.length === 1 && bw.length > 1 && bw[bw.length - 1] === aw[0]) return true;
  return false;
}
