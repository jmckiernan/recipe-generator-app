// SQLite schema + migrations. Bump DB_VERSION and append to MIGRATIONS to change it.

import type { SQLiteDatabase } from 'expo-sqlite';

/** SQL expression for a random version-4 UUID (SQLite has no built-in). */
export const UUID_SQL =
  "(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || " +
  "substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))";

export const MIGRATIONS: string[] = [
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
  // v4: household sync. Shared rows get a UUID, a change time, a "needs upload"
  // flag, and soft deletes (so a delete can be sent to the other phones).
  `
  ALTER TABLE items ADD COLUMN uid TEXT;
  ALTER TABLE items ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE items ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE items ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
  UPDATE items SET uid = ${UUID_SQL} WHERE uid IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS items_uid ON items (uid);

  ALTER TABLE shopping ADD COLUMN uid TEXT;
  ALTER TABLE shopping ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE shopping ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE shopping ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
  UPDATE shopping SET uid = ${UUID_SQL} WHERE uid IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS shopping_uid ON shopping (uid);

  ALTER TABLE recipes ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE recipes ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE recipes ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
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
