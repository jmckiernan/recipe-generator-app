// Barcode → grocery item, using Open Food Facts (free, open database; no API key).

import type { Category } from './types';
import { normalizeName } from './normalize';
import { categorize } from './shelfLife';

export interface Product {
  barcode: string;
  name: string; // simplified, matchable: "greek yogurt"
  displayName: string; // what's on the package: "Fage Total 2% Greek Yogurt"
  brand?: string;
  category: Category;
  per100g?: { kcal?: number; protein?: number; carbs?: number; fat?: number };
}

/** Open Food Facts category tags → our shelf-life categories (more reliable than the name). */
const OFF_CATEGORIES: [RegExp, Category][] = [
  [/en:(cheeses?|cheese)/, 'cheese'],
  [/en:(yogurts?|milks?|dairies|creams?|butters?)/, 'dairy'],
  [/en:eggs/, 'eggs'],
  [/en:(poultry|chickens?|turkeys?)/, 'poultry'],
  [/en:(hams?|sliced-meats|deli|cold-cuts|salamis?)/, 'deli'],
  [/en:(meats?|beef|pork|sausages?|bacon)/, 'meat'],
  [/en:(fishes|seafood|fish)/, 'seafood'],
  [/en:(breads?|tortillas?|bagels?)/, 'bread'],
  [/en:(salads?|lettuces?|leaf-vegetables)/, 'leafy'],
  [/en:(fruits?|berries)/, 'fruit'],
  [/en:(vegetables?|fresh-vegetables)/, 'produce'],
  [/en:(pastas?|rices?|cereals?|legumes|dried-products|flours?)/, 'grain'],
  [/en:(sauces?|condiments?|dressings?|spreads?|jams?)/, 'condiment'],
];

/** Generic words on labels that aren't part of the food's name. */
const LABEL_NOISE =
  /\b(organic|natural|original|classic|premium|fresh|family size|value pack|low fat|fat free|reduced fat|non-fat|nonfat|whole|plain|\d+(\.\d+)?\s*(%|oz|g|lb|ml|l|ct|count|pack))\b/gi;

export function simplifyProductName(displayName: string, brand?: string): string {
  let s = displayName;
  if (brand) {
    for (const b of brand.split(',')) {
      const t = b.trim();
      if (t) s = s.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
    }
  }
  s = s.replace(LABEL_NOISE, ' ').replace(/[^a-zA-Z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  // Keep the last 3 words: "Total Greek Yogurt" → "total greek yogurt" → matching uses the head noun.
  const words = s.split(' ').filter(Boolean);
  return normalizeName(words.slice(-3).join(' ')) || normalizeName(displayName);
}

interface OffResponse {
  status?: number;
  product?: {
    product_name?: string;
    product_name_en?: string;
    generic_name?: string;
    brands?: string;
    categories_tags?: string[];
    nutriments?: Record<string, number | string | undefined>;
  };
}

export function parseOpenFoodFacts(barcode: string, json: OffResponse): Product | null {
  const p = json.product;
  if (json.status === 0 || !p) return null;
  const displayName = (p.product_name_en || p.product_name || p.generic_name || '').trim();
  if (!displayName) return null;
  const name = simplifyProductName(displayName, p.brands);
  const tags = (p.categories_tags ?? []).join(' ');
  const fromTags = OFF_CATEGORIES.find(([re]) => re.test(tags))?.[1];
  const n = p.nutriments ?? {};
  const num = (k: string) => (typeof n[k] === 'number' ? Math.round(n[k] as number) : undefined);
  return {
    barcode,
    name,
    displayName,
    brand: p.brands?.split(',')[0]?.trim() || undefined,
    category: fromTags ?? categorize(name),
    per100g: {
      kcal: num('energy-kcal_100g'),
      protein: num('proteins_100g'),
      carbs: num('carbohydrates_100g'),
      fat: num('fat_100g'),
    },
  };
}

export async function lookupBarcode(barcode: string, fetchImpl: typeof fetch = fetch): Promise<Product | null> {
  const res = await fetchImpl(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,product_name_en,generic_name,brands,categories_tags,nutriments`,
    { headers: { 'User-Agent': 'FridgeChef/1.0 (mobile app)' } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Product lookup failed (${res.status})`);
  return parseOpenFoodFacts(barcode, (await res.json()) as OffResponse);
}
