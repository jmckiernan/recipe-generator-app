// Your favorite recipe sites (feature #3). We link out to them rather than copying content.

/** "https://www.SeriousEats.com/recipes" → "seriouseats.com" */
export function normalizeSite(input: string): string | null {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

/** Sites with a known search page; everything else uses a site-restricted web search. */
const SEARCH_PAGES: Record<string, (q: string) => string> = {
  'allrecipes.com': (q) => `https://www.allrecipes.com/search?q=${q}`,
  'seriouseats.com': (q) => `https://www.seriouseats.com/search?q=${q}`,
  'bonappetit.com': (q) => `https://www.bonappetit.com/search?q=${q}`,
  'budgetbytes.com': (q) => `https://www.budgetbytes.com/?s=${q}`,
  'food52.com': (q) => `https://food52.com/recipes/search?q=${q}`,
  'foodnetwork.com': (q) => `https://www.foodnetwork.com/search/${q}-`,
  'simplyrecipes.com': (q) => `https://www.simplyrecipes.com/search?q=${q}`,
  'delish.com': (q) => `https://www.delish.com/search/?q=${q}`,
  'bbcgoodfood.com': (q) => `https://www.bbcgoodfood.com/search?q=${q}`,
  'cooking.nytimes.com': (q) => `https://cooking.nytimes.com/search?q=${q}`,
};

export function siteSearchUrl(site: string, terms: string[]): string {
  const q = encodeURIComponent(terms.join(' '));
  const page = SEARCH_PAGES[site];
  if (page) return page(q);
  return `https://duckduckgo.com/?q=${encodeURIComponent(`site:${site} ${terms.join(' ')} recipe`)}`;
}

export const SUGGESTED_SITES = ['allrecipes.com', 'seriouseats.com', 'budgetbytes.com', 'bonappetit.com', 'simplyrecipes.com'];
