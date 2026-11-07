// SQLite schema + migrations. Bump DB_VERSION and append to MIGRATIONS to change it.

import type { SQLiteDatabase } from 'expo-sqlite';

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT 'fridge',
    count INTEGER NOT NULL DEFAULT 1,
    qty_level TEXT NOT NULL DEFAULT 'full',
    purchased_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    expiry_estimated INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY NOT NULL,
    json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ratings (
    recipe_id TEXT PRIMARY KEY NOT NULL,
    stars INTEGER NOT NULL,
    tags TEXT NOT NULL,
    ingredients TEXT NOT NULL,
    rated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cook_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id TEXT NOT NULL,
    title TEXT NOT NULL,
    cooked_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS waste_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    outcome TEXT NOT NULL,
    logged_at TEXT NOT NULL
  );
  `,
  // v2: shopping list
  `
  CREATE TABLE IF NOT EXISTS shopping (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    checked INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL
  );
  `,
  // v3: nutrition per cooked serving
  `
  ALTER TABLE cook_log ADD COLUMN kcal INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE cook_log ADD COLUMN protein INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE cook_log ADD COLUMN carbs INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE cook_log ADD COLUMN fat INTEGER NOT NULL DEFAULT 0;
  `,
];

export const DB_NAME = 'fridgechef.db';

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
    });
    version += 1;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}
