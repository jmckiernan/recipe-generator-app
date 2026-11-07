// Data access. All screens go through these functions, never raw SQL.

import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  Category,
  InventoryItem,
  Location,
  Profile,
  QtyLevel,
  Rating,
  Recipe,
} from '../domain/types';
import type { InventoryChange } from '../domain/inventory';
import { categorize, defaultLocation, estimateExpiry, toISODate } from '../domain/shelfLife';
import { DEFAULT_STAPLES } from '../data/recipes';

interface ItemRow {
  id: number;
  name: string;
  category: string;
  location: string;
  count: number;
  qty_level: string;
  purchased_at: string;
  expires_at: string;
  expiry_estimated: number;
}

const toItem = (r: ItemRow): InventoryItem => ({
  id: r.id,
  name: r.name,
  category: r.category as Category,
  location: r.location as Location,
  count: r.count,
  qtyLevel: r.qty_level as QtyLevel,
  purchasedAt: r.purchased_at,
  expiresAt: r.expires_at,
  expiryEstimated: r.expiry_estimated === 1,
});

// ---------- Inventory ----------

export async function listItems(db: SQLiteDatabase): Promise<InventoryItem[]> {
  const rows = await db.getAllAsync<ItemRow>('SELECT * FROM items ORDER BY expires_at ASC');
  return rows.map(toItem);
}

export interface NewItem {
  name: string;
  count?: number;
  qtyLevel?: QtyLevel;
  location?: Location;
  category?: Category;
  purchasedAt?: string;
  /** Printed date if the user entered one; otherwise we estimate. */
  expiresAt?: string;
}

export async function addItem(db: SQLiteDatabase, n: NewItem): Promise<void> {
  const category = n.category ?? categorize(n.name);
  const location = n.location ?? defaultLocation(category);
  const purchasedAt = n.purchasedAt ?? toISODate(new Date());
  const expiresAt = n.expiresAt ?? estimateExpiry(category, location, purchasedAt);
  await db.runAsync(
    `INSERT INTO items (name, category, location, count, qty_level, purchased_at, expires_at, expiry_estimated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    n.name,
    category,
    location,
    n.count ?? 1,
    n.qtyLevel ?? 'full',
    purchasedAt,
    expiresAt,
    n.expiresAt ? 0 : 1,
  );
}

export async function updateItem(
  db: SQLiteDatabase,
  id: number,
  patch: Partial<Pick<InventoryItem, 'count' | 'qtyLevel' | 'location' | 'expiresAt' | 'name'>>,
): Promise<void> {
  const cols: string[] = [];
  const vals: (string | number)[] = [];
  const set = (col: string, v: string | number | undefined) => {
    if (v === undefined) return;
    cols.push(`${col} = ?`);
    vals.push(v);
  };
  set('count', patch.count);
  set('qty_level', patch.qtyLevel);
  set('location', patch.location);
  set('name', patch.name);
  if (patch.expiresAt !== undefined) {
    cols.push('expires_at = ?', 'expiry_estimated = 0');
    vals.push(patch.expiresAt);
  }
  if (!cols.length) return;
  await db.runAsync(`UPDATE items SET ${cols.join(', ')} WHERE id = ?`, ...vals, id);
}

/** Move to the freezer and re-estimate the expiry from today. */
export async function freezeItem(db: SQLiteDatabase, item: InventoryItem): Promise<void> {
  const exp = estimateExpiry(item.category, 'freezer', toISODate(new Date()));
  await db.runAsync(
    `UPDATE items SET location = 'freezer', expires_at = ?, expiry_estimated = 1 WHERE id = ?`,
    exp,
    item.id,
  );
}

export async function removeItem(
  db: SQLiteDatabase,
  item: Pick<InventoryItem, 'id' | 'name'>,
  outcome: 'used' | 'tossed',
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM items WHERE id = ?', item.id);
    await db.runAsync(
      'INSERT INTO waste_log (name, outcome, logged_at) VALUES (?, ?, ?)',
      item.name,
      outcome,
      new Date().toISOString(),
    );
  });
}

export async function applyChanges(db: SQLiteDatabase, changes: InventoryChange[]): Promise<void> {
  for (const c of changes) {
    if (c.kind === 'remove') await removeItem(db, c, 'used');
    else await updateItem(db, c.id, { count: c.count, qtyLevel: c.qtyLevel });
  }
}

export async function wasteStats(db: SQLiteDatabase): Promise<{ used: number; tossed: number }> {
  const rows = await db.getAllAsync<{ outcome: string; n: number }>(
    'SELECT outcome, COUNT(*) as n FROM waste_log GROUP BY outcome',
  );
  const get = (k: string) => rows.find((r) => r.outcome === k)?.n ?? 0;
  return { used: get('used'), tossed: get('tossed') };
}

// ---------- Profile / settings ----------

export const DEFAULT_PROFILE: Profile = {
  likes: [],
  dislikes: [],
  allergies: [],
  staples: DEFAULT_STAPLES,
  favoriteRestaurants: [],
  expiryWarnDays: 2,
  notifyHour: 16,
  notifyMinute: 0,
};

export async function getProfile(db: SQLiteDatabase): Promise<Profile> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'profile'",
  );
  if (!row) return DEFAULT_PROFILE;
  return { ...DEFAULT_PROFILE, ...(JSON.parse(row.value) as Partial<Profile>) };
}

export async function saveProfile(db: SQLiteDatabase, p: Profile): Promise<void> {
  await db.runAsync(
    "INSERT INTO settings (key, value) VALUES ('profile', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(p),
  );
}

// ---------- Recipes (AI-generated / saved) ----------

export async function saveRecipe(db: SQLiteDatabase, r: Recipe): Promise<void> {
  await db.runAsync(
    'INSERT INTO recipes (id, json, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
    r.id,
    JSON.stringify(r),
    new Date().toISOString(),
  );
}

export async function listSavedRecipes(db: SQLiteDatabase): Promise<Recipe[]> {
  const rows = await db.getAllAsync<{ json: string }>(
    'SELECT json FROM recipes ORDER BY created_at DESC',
  );
  return rows.map((r) => JSON.parse(r.json) as Recipe);
}

// ---------- Ratings & cook log ----------

export async function rateRecipe(db: SQLiteDatabase, recipe: Recipe, stars: number): Promise<void> {
  const tags = [...recipe.tags, ...(recipe.cuisine ? [recipe.cuisine] : [])];
  await db.runAsync(
    `INSERT INTO ratings (recipe_id, stars, tags, ingredients, rated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(recipe_id) DO UPDATE SET stars = excluded.stars, rated_at = excluded.rated_at`,
    recipe.id,
    stars,
    JSON.stringify(tags),
    JSON.stringify(recipe.ingredients.map((i) => i.name)),
    new Date().toISOString(),
  );
}

export async function listRatings(db: SQLiteDatabase): Promise<Rating[]> {
  const rows = await db.getAllAsync<{
    recipe_id: string;
    stars: number;
    tags: string;
    ingredients: string;
  }>('SELECT * FROM ratings');
  return rows.map((r) => ({
    recipeId: r.recipe_id,
    stars: r.stars,
    tags: JSON.parse(r.tags) as string[],
    ingredients: JSON.parse(r.ingredients) as string[],
  }));
}

export async function logCook(db: SQLiteDatabase, recipe: Recipe): Promise<void> {
  await db.runAsync(
    'INSERT INTO cook_log (recipe_id, title, cooked_at) VALUES (?, ?, ?)',
    recipe.id,
    recipe.title,
    new Date().toISOString(),
  );
}

export async function recentCooks(db: SQLiteDatabase, limit = 10): Promise<string[]> {
  const rows = await db.getAllAsync<{ title: string }>(
    'SELECT title FROM cook_log ORDER BY cooked_at DESC LIMIT ?',
    limit,
  );
  return rows.map((r) => r.title);
}
