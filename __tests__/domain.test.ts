import { parseQuickAdd } from '../src/domain/quickAdd';
import { categorize, daysUntil, estimateExpiry, shouldSuggestFreezing } from '../src/domain/shelfLife';
import { changesForCooking, totalAmount, amountAfterUse } from '../src/domain/inventory';
import { countedIngredients, expiringItems, suggest, unlockSuggestions } from '../src/domain/matcher';
import { adjacentSuggestions, buildTaste, violatesAllergies } from '../src/domain/taste';
import { ingredientMatches } from '../src/domain/normalize';
import { BUILTIN_RECIPES, DEFAULT_STAPLES } from '../src/data/recipes';
import type { InventoryItem, Profile, Recipe } from '../src/domain/types';

const TODAY = new Date('2026-11-07T12:00:00');

let nextId = 1;
function item(name: string, daysLeft: number, extra: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: nextId++,
    name,
    category: categorize(name),
    location: 'fridge',
    count: 1,
    qtyLevel: 'full',
    purchasedAt: '2026-11-01',
    expiresAt: addDays(daysLeft),
    expiryEstimated: true,
    ...extra,
  };
}
function addDays(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const profile: Profile = {
  likes: [],
  dislikes: [],
  allergies: [],
  staples: DEFAULT_STAPLES,
  favoriteRestaurants: [],
  favoriteSites: [],
  goal: 'maintain',
  expiryWarnDays: 2,
  notifyHour: 16,
  notifyMinute: 0,
};

describe('quick add parser', () => {
  it('parses counts, halves, and containers', () => {
    const out = parseQuickAdd('2 onions, milk, half a bag of spinach and a dozen eggs');
    expect(out).toEqual([
      { name: 'onion', count: 2, qtyLevel: 'full' },
      { name: 'milk', count: 1, qtyLevel: 'full' },
      { name: 'spinach', count: 1, qtyLevel: 'half' },
      { name: 'egg', count: 12, qtyLevel: 'full' },
    ]);
  });
  it('handles number words and newlines', () => {
    expect(parseQuickAdd('three tomatoes\nchicken thighs')).toEqual([
      { name: 'tomato', count: 3, qtyLevel: 'full' },
      { name: 'chicken thigh', count: 1, qtyLevel: 'full' },
    ]);
  });
});

describe('shelf life', () => {
  it('categorizes common foods', () => {
    expect(categorize('chicken thigh')).toBe('poultry');
    expect(categorize('turkey')).toBe('deli');
    expect(categorize('cheddar cheese')).toBe('cheese');
    expect(categorize('spinach')).toBe('leafy');
    expect(categorize('onion')).toBe('hardy_produce');
  });
  it('estimates expiry and freezer extends it', () => {
    expect(estimateExpiry('poultry', 'fridge', '2026-11-07')).toBe('2026-11-09');
    expect(daysUntil(estimateExpiry('poultry', 'freezer', '2026-11-07'), TODAY)).toBeGreaterThan(200);
  });
  it('suggests freezing meat that is about to expire, not lettuce', () => {
    expect(shouldSuggestFreezing('poultry', 'fridge', addDays(1), 2, TODAY)).toBe(true);
    expect(shouldSuggestFreezing('leafy', 'fridge', addDays(1), 2, TODAY)).toBe(false);
  });
});

describe('partial quantities (half an onion)', () => {
  it('cooking a recipe that uses half an onion leaves half', () => {
    const onion = item('onion', 10);
    const recipe: Recipe = {
      id: 'x', title: 'x', kind: 'recipe', minutes: 10, tags: [],
      ingredients: [{ name: 'onion', use: 'half' }, { name: 'salt', use: 'some' }],
      steps: [],
    };
    const changes = changesForCooking([onion], recipe, DEFAULT_STAPLES, TODAY);
    expect(changes).toEqual([{ id: onion.id, kind: 'update', name: 'onion', count: 1, qtyLevel: 'half' }]);
  });
  it('using all of the last unit removes the item', () => {
    const onion = item('onion', 10, { qtyLevel: 'half' });
    expect(amountAfterUse(onion, 'half')).toEqual({ id: onion.id, kind: 'remove', name: 'onion' });
  });
  it('3 onions minus half = 2 + half', () => {
    const onion = item('onion', 10, { count: 3 });
    expect(totalAmount(onion)).toBe(3);
    expect(amountAfterUse(onion, 'half')).toMatchObject({ count: 3, qtyLevel: 'half' });
  });
  it('does not cook with expired food', () => {
    const old = item('chicken', -1);
    const recipe = BUILTIN_RECIPES.find((r) => r.id === 'chicken-stir-fry')!;
    expect(changesForCooking([old], recipe, DEFAULT_STAPLES, TODAY)).toEqual([]);
  });
});

describe('matcher', () => {
  const fridge = [
    item('bread', 5),
    item('turkey', 1),
    item('lettuce', 3),
    item('egg', 20, { count: 6 }),
    item('spinach', 1, { qtyLevel: 'half' }),
    item('cheddar cheese', 15),
  ];

  it('staples do not count toward ingredient limits', () => {
    const gc = BUILTIN_RECIPES.find((r) => r.id === 'grilled-cheese')!;
    expect(countedIngredients(gc, DEFAULT_STAPLES)).toEqual(['bread', 'cheese']);
  });

  it('ranks recipes using expiring food first', () => {
    const s = suggest(BUILTIN_RECIPES, fridge, profile, [], { canBuy: 0 }, TODAY);
    expect(s.length).toBeGreaterThan(0);
    const top = s.slice(0, 2).map((x) => x.recipe.id);
    // Turkey (1 day) and half bag of spinach (1 day) are the urgent items.
    expect(top.some((id) => id === 'turkey-sandwich' || id === 'scrambled-eggs-spinach')).toBe(true);
    expect(s.every((x) => x.missing.length === 0)).toBe(true);
  });

  it('respects the 2-ingredient filter', () => {
    const s = suggest(BUILTIN_RECIPES, fridge, profile, [], { canBuy: 0, maxIngredients: 2 }, TODAY);
    for (const x of s) expect(countedIngredients(x.recipe, DEFAULT_STAPLES).length).toBeLessThanOrEqual(2);
  });

  it('respects the time filter', () => {
    const s = suggest(BUILTIN_RECIPES, fridge, profile, [], { canBuy: 3, maxMinutes: 10 }, TODAY);
    for (const x of s) expect(x.recipe.minutes).toBeLessThanOrEqual(10);
  });

  it('allows buying N missing ingredients', () => {
    const none = suggest(BUILTIN_RECIPES, fridge, profile, [], { canBuy: 0 }, TODAY);
    const two = suggest(BUILTIN_RECIPES, fridge, profile, [], { canBuy: 2 }, TODAY);
    expect(two.length).toBeGreaterThan(none.length);
    expect(two.every((x) => x.missing.length <= 2)).toBe(true);
  });

  it('never suggests allergens, even with matching inventory', () => {
    const p = { ...profile, allergies: ['dairy', 'gluten'] };
    const s = suggest(BUILTIN_RECIPES, fridge, p, [], { canBuy: 3 }, TODAY);
    for (const x of s) expect(violatesAllergies(x.recipe, ['dairy', 'gluten'])).toBe(false);
    expect(s.find((x) => x.recipe.id === 'grilled-cheese')).toBeUndefined();
    expect(s.find((x) => x.recipe.id === 'turkey-sandwich')).toBeUndefined();
  });

  it('lists expiring items within the warning window', () => {
    expect(expiringItems(fridge, 2, TODAY).map((i) => i.name).sort()).toEqual(['spinach', 'turkey']);
  });

  it('suggests ingredients that unlock recipes', () => {
    const u = unlockSuggestions(BUILTIN_RECIPES, fridge, profile, TODAY);
    expect(u.length).toBeGreaterThan(0);
    expect(u[0].unlocks.length).toBeGreaterThanOrEqual(u[u.length - 1].unlocks.length);
  });
});

describe('taste', () => {
  it('likes onions → suggests shallots with a reason', () => {
    const t = buildTaste({ ...profile, likes: ['onion'] }, []);
    const adj = adjacentSuggestions(t, []);
    expect(adj[0]).toMatchObject({ name: 'shallot', because: 'onion' });
  });
  it('ratings shift the score', () => {
    const t = buildTaste(profile, [{ recipeId: 'a', stars: 5, tags: ['mexican'], ingredients: ['tortilla'] }]);
    expect(t.tag.get('mexican')).toBe(2);
  });
  it('matches names loosely', () => {
    expect(ingredientMatches('red onion', 'onion')).toBe(true);
    expect(ingredientMatches('cheddar cheese', 'cheese')).toBe(true);
    expect(ingredientMatches('chicken thigh', 'chicken')).toBe(true);
    expect(ingredientMatches('onion', 'green onion')).toBe(false);
  });
});

describe('compound ingredient names', () => {
  it('does not confuse compounds with their last word', () => {
    expect(ingredientMatches('peanut butter', 'butter')).toBe(false);
    expect(ingredientMatches('garlic powder', 'garlic')).toBe(false);
    expect(ingredientMatches('bell pepper', 'pepper')).toBe(false);
    expect(ingredientMatches('green bell pepper', 'bell pepper')).toBe(true);
    expect(ingredientMatches('sweet potato', 'potato')).toBe(false);
  });
  it('fresh garlic and bell peppers are not treated as staples', () => {
    const stir = BUILTIN_RECIPES.find((r) => r.id === 'chicken-stir-fry')!;
    expect(countedIngredients(stir, DEFAULT_STAPLES)).toContain('bell pepper');
    const shrimp = BUILTIN_RECIPES.find((r) => r.id === 'garlic-butter-shrimp')!;
    expect(countedIngredients(shrimp, DEFAULT_STAPLES)).toEqual(['shrimp', 'garlic']);
  });
});
