// Import a recipe from any site that publishes schema.org Recipe data
// (most major recipe sites do, for search engines). We store a summary and
// always link back to the original page.

import type { Recipe } from './types';
import { parseIngredientLines } from './ingredientLine';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function extractJsonLdBlocks(html: string): Json[] {
  const out: Json[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1].trim()) as Json);
    } catch {
      // Some sites ship slightly invalid JSON-LD; skip those blocks.
    }
  }
  return out;
}

function isObj(j: Json | undefined): j is { [k: string]: Json } {
  return !!j && typeof j === 'object' && !Array.isArray(j);
}

function hasType(o: { [k: string]: Json }, t: string): boolean {
  const ty = o['@type'];
  return ty === t || (Array.isArray(ty) && ty.includes(t));
}

/** Depth-first search for the first object with @type Recipe (handles @graph and arrays). */
export function findRecipeNode(j: Json): { [k: string]: Json } | null {
  if (Array.isArray(j)) {
    for (const x of j) {
      const r = findRecipeNode(x);
      if (r) return r;
    }
    return null;
  }
  if (!isObj(j)) return null;
  if (hasType(j, 'Recipe')) return j;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage']) {
    const v = j[key];
    if (v !== undefined) {
      const r = findRecipeNode(v);
      if (r) return r;
    }
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ',
  '&#8217;': '’', '&#8216;': '‘', '&#8220;': '“', '&#8221;': '”', '&frac12;': '½', '&deg;': '°',
};

export function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
}

/** ISO 8601 duration ("PT1H30M") → minutes. */
export function isoMinutes(d: Json | undefined): number | undefined {
  if (typeof d !== 'string') return undefined;
  const m = d.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/i);
  if (!m) return undefined;
  const total = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return total > 0 ? total : undefined;
}

function strings(j: Json | undefined): string[] {
  if (j === undefined || j === null) return [];
  if (typeof j === 'string') return [j];
  if (Array.isArray(j)) return j.flatMap(strings);
  if (isObj(j)) {
    if (typeof j.text === 'string') return [j.text];
    if (typeof j.name === 'string') return [j.name];
  }
  return [];
}

function instructions(j: Json | undefined): string[] {
  if (j === undefined || j === null) return [];
  if (typeof j === 'string') {
    return cleanText(j)
      .split(/(?<=\.)\s+(?=[A-Z])|\n+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (Array.isArray(j)) return j.flatMap(instructions);
  if (isObj(j)) {
    if (hasType(j, 'HowToSection') && j.itemListElement !== undefined) return instructions(j.itemListElement);
    if (typeof j.text === 'string') return [cleanText(j.text)];
    if (typeof j.name === 'string') return [cleanText(j.name)];
  }
  return [];
}

function yieldServings(j: Json | undefined): number | undefined {
  for (const s of strings(j)) {
    const n = s.match(/\d+/);
    if (n) return Math.min(24, Number(n[0]));
  }
  if (typeof j === 'number') return j;
  return undefined;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

export function siteName(url: string): string {
  const m = url.match(/^https?:\/\/(?:www\.)?([^/]+)/i);
  return m ? m[1] : url;
}

/** Returns null if the page has no Recipe data. */
export function recipeFromHtml(html: string, url: string): Recipe | null {
  let node: { [k: string]: Json } | null = null;
  for (const block of extractJsonLdBlocks(html)) {
    node = findRecipeNode(block);
    if (node) break;
  }
  if (!node) return null;

  const title = cleanText(strings(node.name)[0] ?? 'Imported recipe');
  const lines = strings(node.recipeIngredient ?? node.ingredients).map(cleanText);
  const ingredients = parseIngredientLines(lines);
  if (!ingredients.length) return null;
  const minutes =
    isoMinutes(node.totalTime) ??
    ((isoMinutes(node.prepTime) ?? 0) + (isoMinutes(node.cookTime) ?? 0) || 30);
  const keywords = strings(node.keywords).flatMap((k) => k.split(','));
  const tags = Array.from(
    new Set(
      [...strings(node.recipeCategory), ...keywords]
        .map((t) => cleanText(t).toLowerCase())
        .filter((t) => t && t.length < 24),
    ),
  ).slice(0, 8);
  const cuisine = strings(node.recipeCuisine)[0];

  return {
    id: `web-${slug(siteName(url))}-${slug(title)}`,
    title,
    minutes,
    kind: 'recipe',
    cuisine: cuisine ? cleanText(cuisine).toLowerCase() : undefined,
    tags: [...tags, 'imported'],
    ingredients,
    steps: instructions(node.recipeInstructions).slice(0, 30),
    servings: yieldServings(node.recipeYield),
    source: 'user',
    sourceUrl: url,
  };
}
