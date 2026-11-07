// Parse fast free-text entry like "2 onions, milk, half a bag of spinach and a dozen eggs".
// Runs fully offline; the AI parser is only a fallback for messy input.

import type { QtyLevel } from './types';
import { normalizeName } from './normalize';

export interface ParsedEntry {
  name: string;
  count: number;
  qtyLevel: QtyLevel;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  dozen: 12,
  couple: 2,
  few: 3,
};

const CONTAINERS =
  /^(bags?|boxes?|cartons?|cans?|jars?|bottles?|packs?|packages?|bunch(es)?|heads?|loaf|loaves|lbs?|pounds?|oz|ounces?|gallons?|containers?|tubs?|blocks?|sticks?|cloves?|pieces?|slices?)\s+(of\s+)?/;

export function parseQuickAdd(text: string): ParsedEntry[] {
  return text
    .split(/,|\n|;|\band\b|\+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseOne)
    .filter((e): e is ParsedEntry => e !== null);
}

function parseOne(raw: string): ParsedEntry | null {
  let s = raw.toLowerCase().trim();
  let count = 1;
  let qtyLevel: QtyLevel = 'full';

  // "half a", "half an", "half of a", "1/2"
  const half = s.match(/^(half(\s+of)?(\s+an?)?|1\/2(\s+an?)?)\s+/);
  if (half) {
    qtyLevel = 'half';
    s = s.slice(half[0].length);
  }
  // "a little", "some", "a bit of"
  const little = s.match(/^(a\s+little(\s+bit)?(\s+of)?|a\s+bit\s+of|some\s+leftover|bit\s+of)\s+/);
  if (little) {
    qtyLevel = 'little';
    s = s.slice(little[0].length);
  }
  if (/^some\s+/.test(s)) s = s.replace(/^some\s+/, '');

  // "a dozen" / "2 dozen"
  const dozen = s.match(/^(\d+|a|one|two|half)?\s*dozen\s+/);
  if (dozen) {
    const n = dozen[1];
    count = n === 'half' ? 6 : n && /\d/.test(n) ? parseInt(n, 10) * 12 : n && NUMBER_WORDS[n] ? NUMBER_WORDS[n] * 12 : 12;
    s = s.slice(dozen[0].length);
  } else {
    const num = s.match(/^(\d+)\s*x?\s+/);
    const word = s.match(/^([a-z]+)\s+/);
    if (num) {
      count = parseInt(num[1], 10);
      s = s.slice(num[0].length);
    } else if (word && NUMBER_WORDS[word[1]] !== undefined) {
      count = NUMBER_WORDS[word[1]];
      s = s.slice(word[0].length);
      s = s.replace(/^of\s+/, '');
    }
  }

  // Strip containers/units: "bag of spinach" → "spinach"
  if (CONTAINERS.test(s)) {
    s = s.replace(CONTAINERS, '');
    // "2 bags of spinach" means two units of spinach; keep count.
  }

  const name = normalizeName(s);
  if (!name) return null;
  return { name, count: Math.max(1, count), qtyLevel };
}
