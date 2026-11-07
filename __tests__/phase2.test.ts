import { parseQuickAdd } from '../src/domain/quickAdd';
import { estimateKcal, makeVariant, parseVariantId } from '../src/domain/variants';
import { planMealPrep } from '../src/domain/mealPrep';
import { listSuggestions, onList } from '../src/domain/shopping';
import { isFavoriteRestaurant, suggest } from '../src/domain/matcher';
import { changesForCooking, findItemFor } from '../src/domain/inventory';
import { categorize } from '../src/domain/shelfLife';
import { violatesAllergies } from '../src/domain/taste';
import { BUILTIN_RECIPES, DEFAULT_STAPLES } from '../src/data/recipes';
import type { InventoryItem, Profile, ShoppingItem } from '../src/domain/types';

const TODAY = new Date('2026-11-07T12:00:00');
let nextId = 1;
function addDays(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
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
const byId = (id: string) => BUILTIN_RECIPES.find((r) => r.id === id)!;

describe('lighter / hearty versions', () => {
  it('lighter swaps beef for turkey, cuts cheese, and lowers calories', () => {
    const tacos = byId('beef-tacos');
    const light = makeVariant(tacos, 'lighter');
    const names = light.recipe.ingredients.map((i) => i.name);
    expect(names).toContain('ground turkey');
    expect(names).not.toContain('ground beef');
    expect(light.changes.some((c) => c.includes('turkey'))).toBe(true);
    expect(light.kcal).toBeLessThan(estimateKcal(tacos));
  });
  it('hearty adds protein and has more calories than classic', () => {
    const salad = byId('side-salad');
    const hearty = makeVariant(salad, 'hearty');
    expect(hearty.kcal).toBeGreaterThan(estimateKcal(salad));
    expect(hearty.changes.length).toBeGreaterThan(0);
  });
  it('never introduces an allergen', () => {
    const salad = byId('side-salad');
    const hearty = makeVariant(salad, 'hearty', ['egg', 'dairy']);
    expect(violatesAllergies(hearty.recipe, ['egg', 'dairy'])).toBe(false);
  });
  it('variant ids round-trip', () => {
    expect(parseVariantId('beef-tacos~lighter')).toEqual({ baseId: 'beef-tacos', style: 'lighter' });
    expect(parseVariantId('beef-tacos')).toEqual({ baseId: 'beef-tacos', style: 'classic' });
  });
});

describe('restaurant copycats', () => {
  it('matches restaurant names loosely', () => {
    expect(isFavoriteRestaurant('Chick-fil-A', ['chick fil a'])).toBe(true);
    expect(isFavoriteRestaurant('Chipotle', ['Chipotle Mexican Grill'])).toBe(true);
    expect(isFavoriteRestaurant('Panera', ['chipotle'])).toBe(false);
  });
  it('boosts copycats of favorite restaurants with a savings reason', () => {
    const fridge = [item('chicken', 2), item('rice', 300), item('black bean', 300), item('lime', 6), item('broccoli', 5), item('cheddar', 20), item('milk', 6), item('onion', 20)];
    const fav = { ...profile, favoriteRestaurants: ['chipotle'] };
    const s = suggest(BUILTIN_RECIPES, fridge, fav, [], { canBuy: 0 }, TODAY);
    const bowl = s.find((x) => x.recipe.id === 'copycat-burrito-bowl')!;
    expect(bowl).toBeDefined();
    expect(bowl.reasons.join(' ')).toMatch(/Chipotle.*\$8/);
    const without = suggest(BUILTIN_RECIPES, fridge, profile, [], { canBuy: 0 }, TODAY).find((x) => x.recipe.id === 'copycat-burrito-bowl')!;
    expect(bowl.score).toBeGreaterThan(without.score);
  });
});

describe('leftovers', () => {
  it('leftovers are categorized and never stand in for raw ingredients', () => {
    const lo = item('leftover chicken stir-fry', 3);
    expect(lo.category).toBe('leftovers');
    expect(findItemFor([lo], 'chicken', TODAY)).toBeUndefined();
    expect(changesForCooking([lo], byId('chicken-stir-fry'), DEFAULT_STAPLES, TODAY)).toEqual([]);
  });
});

describe('meal prep', () => {
  const fridge = () => [
    item('chicken', 2, { count: 2 }),
    item('ground beef', 2),
    item('rice', 300),
    item('bell pepper', 6, { count: 3 }),
    item('onion', 20, { count: 3 }),
    item('potato', 20, { count: 4 }),
    item('sausage', 3),
    item('egg', 20, { count: 12 }),
    item('cheese', 20),
    item('tomato', 5, { count: 4 }),
  ];
  it('picks distinct dishes with varied proteins', () => {
    const plan = planMealPrep(BUILTIN_RECIPES, fridge(), profile, [], { dishes: 3, canBuy: 1, doubleBatch: false }, TODAY);
    expect(plan.picks).toHaveLength(3);
    const ids = plan.picks.map((p) => p.recipe.id);
    expect(new Set(ids).size).toBe(3);
    expect(plan.picks.every((p) => p.recipe.kind === 'recipe')).toBe(true);
    expect(plan.totalServings).toBeGreaterThanOrEqual(6);
  });
  it('uses up expiring food and orders longest-cooking first', () => {
    const plan = planMealPrep(BUILTIN_RECIPES, fridge(), profile, [], { dishes: 3, canBuy: 1, doubleBatch: false }, TODAY);
    expect(plan.usesExpiring.length).toBeGreaterThan(0);
    const mins = plan.order.map((t) => plan.picks.find((p) => p.recipe.title === t)!.recipe.minutes);
    expect([...mins].sort((a, b) => b - a)).toEqual(mins);
  });
  it('does not double-count food across dishes', () => {
    // One chicken only: two chicken dishes would both need it.
    const inv = [item('chicken', 2), item('rice', 300), item('bell pepper', 5), item('onion', 20), item('orange', 5), item('lime', 5), item('black bean', 300)];
    const plan = planMealPrep(BUILTIN_RECIPES, inv, profile, [], { dishes: 3, canBuy: 0, doubleBatch: false }, TODAY);
    const chickenDishes = plan.picks.filter((p) => p.have.includes('chicken'));
    expect(chickenDishes.length).toBeLessThanOrEqual(1);
  });
});

describe('shopping list suggestions', () => {
  const list: ShoppingItem[] = [{ id: 1, name: 'milk', reason: '', checked: false, addedAt: '' }];
  it('detects items already on the list', () => {
    expect(onList(list, 'milk')).toBe(true);
    expect(onList(list, 'egg')).toBe(false);
  });
  it('suggests regulars you are out of, then unlocks, skipping allergens and duplicates', () => {
    const inv = [item('bread', 5), item('cheese', 20)];
    const used = new Map([
      ['egg', 4],
      ['milk', 3],
      ['shrimp', 3],
    ]);
    const out = listSuggestions({
      inventory: inv,
      recipes: BUILTIN_RECIPES,
      profile: { ...profile, allergies: ['shellfish'], likes: ['onion'] },
      ratings: [],
      list,
      usedCounts: used,
      today: TODAY,
    });
    expect(out[0]).toMatchObject({ name: 'egg' });
    expect(out.find((o) => o.name === 'milk')).toBeUndefined(); // already on list
    expect(out.find((o) => o.name === 'shrimp')).toBeUndefined(); // allergy
    expect(out.some((o) => o.reason.startsWith('Unlocks'))).toBe(true);
    expect(out.some((o) => o.name === 'shallot')).toBe(true);
  });
});

describe('plural normalization regression', () => {
  it('plural inventory names match singular recipe ingredients', () => {
    const names = parseQuickAdd('tortillas, black beans, peas, noodles, chickpeas, hummus, asparagus').map((e) => e.name);
    expect(names).toEqual(['tortilla', 'black bean', 'pea', 'noodle', 'chickpea', 'hummus', 'asparagus']);
  });
});

describe('lighter version respects what you have', () => {
  it('keeps your rice (smaller portion) instead of requiring cauliflower rice', () => {
    const bowl = byId('copycat-burrito-bowl');
    const have = (n: string) => ['rice', 'chicken', 'lime'].includes(n);
    const light = makeVariant(bowl, 'lighter', [], have);
    const rice = light.recipe.ingredients.find((i) => i.name === 'rice');
    expect(rice?.use).toBe('some');
    expect(light.recipe.ingredients.some((i) => i.name === 'cauliflower rice')).toBe(false);
    expect(light.changes.join(' ')).toMatch(/cauliflower rice if you have it/);
  });
});
