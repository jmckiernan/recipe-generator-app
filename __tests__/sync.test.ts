// Household sync, end to end: two "phones", each with a real SQLite database
// (Node's built-in SQLite running the app's own migrations and repo functions),
// syncing through a fake server that stamps writes with its own clock like Supabase does.

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { MIGRATIONS, migrate } from '../src/db/schema';
import * as repo from '../src/db/repo';
import { decideMerge, syncOnce, type RemoteStore, type Table, type WireRow } from '../src/sync/engine';
import { prepareForHousehold, sqliteLocalStore, type Db } from '../src/sync/localStore';
import { cookingForLabel, effectiveAllergies, isValidInviteCode, normalizeInviteCode, type Member } from '../src/domain/household';
import { amountAfterUse } from '../src/domain/inventory';

type Param = string | number | null;
function nodeDb(): Db & SQLiteDatabase {
  const d = new DatabaseSync(':memory:');
  const args = (p: unknown[]): Param[] => (p.length === 1 && Array.isArray(p[0]) ? (p[0] as Param[]) : (p as Param[]));
  const db = {
    async execAsync(sql: string) {
      d.exec(sql);
    },
    async runAsync(sql: string, ...p: unknown[]) {
      const r = d.prepare(sql).run(...args(p));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    async getAllAsync(sql: string, ...p: unknown[]) {
      return d.prepare(sql).all(...args(p));
    },
    async getFirstAsync(sql: string, ...p: unknown[]) {
      return d.prepare(sql).get(...args(p)) ?? null;
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      d.exec('BEGIN');
      try {
        await fn();
        d.exec('COMMIT');
      } catch (e) {
        d.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db as unknown as Db & SQLiteDatabase;
}

/** In-memory stand-in for the Supabase tables, with a server clock. */
function fakeServer() {
  const tables: Record<Table, Map<string, WireRow>> = { items: new Map(), shopping: new Map(), recipes: new Map() };
  let clock = Date.parse('2026-11-08T12:00:00.000Z');
  const remote: RemoteStore & { tables: typeof tables; offline: boolean } = {
    tables,
    offline: false,
    async upsert(table, rows) {
      if (remote.offline) throw new Error('offline');
      for (const r of rows) {
        clock += 1;
        tables[table].set(`${r.household_id}/${r.id}`, { ...r, updated_at: new Date(clock).toISOString() });
      }
    },
    async changedSince(table, hid, since, limit) {
      if (remote.offline) throw new Error('offline');
      return [...tables[table].values()]
        .filter((r) => r.household_id === hid && (r.updated_at ?? '') > since)
        .sort((a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? ''))
        .slice(0, limit);
    },
  };
  return remote;
}

async function phone() {
  const db = nodeDb();
  await migrate(db);
  return { db, local: sqliteLocalStore(db) };
}

const HH = 'house-1';
const names = async (db: SQLiteDatabase) => (await repo.listItems(db)).map((i) => i.name).sort();

describe('local migration v4', () => {
  it('gives existing food and list items a UUID and marks them for upload', async () => {
    const db = nodeDb();
    // An install from before sync existed (schema v3) with food in it.
    for (const m of MIGRATIONS.slice(0, 3)) await db.execAsync(m);
    await db.execAsync('PRAGMA user_version = 3');
    await db.runAsync(
      "INSERT INTO items (name, category, location, count, qty_level, purchased_at, expires_at, expiry_estimated) VALUES ('milk','dairy','fridge',1,'full','2026-11-01','2026-11-08',1), ('egg','eggs','fridge',6,'full','2026-11-01','2026-11-29',1)",
    );
    await db.runAsync("INSERT INTO shopping (name, reason, checked, added_at) VALUES ('bread','',0,'2026-11-01')");
    await migrate(db);
    const rows = await db.getAllAsync<{ uid: string; dirty: number }>('SELECT uid, dirty FROM items');
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(rows[0].uid).not.toBe(rows[1].uid);
    expect(rows.every((r) => r.dirty === 1)).toBe(true);
    expect((await db.getFirstAsync<{ uid: string }>('SELECT uid FROM shopping'))?.uid).toBeTruthy();
    expect(await names(db)).toEqual(['egg', 'milk']);
  });
});

describe('two phones in one household', () => {
  it('shares food, partial use, deletes, the shopping list, and recipes', async () => {
    const server = fakeServer();
    const a = await phone();
    const b = await phone();

    // A had food before creating the household; B had some too. Both merge in.
    await repo.addItem(a.db, { name: 'onion', count: 2 });
    await repo.addItem(a.db, { name: 'milk' });
    await repo.addItem(b.db, { name: 'tortilla' });
    await prepareForHousehold(a.db);
    await prepareForHousehold(b.db);
    await syncOnce(a.local, server, HH);
    await syncOnce(b.local, server, HH);
    await syncOnce(a.local, server, HH);
    expect(await names(a.db)).toEqual(['milk', 'onion', 'tortilla']);
    expect(await names(b.db)).toEqual(['milk', 'onion', 'tortilla']);

    // B uses half an onion; A sees "1 + ½".
    const onionB = (await repo.listItems(b.db)).find((i) => i.name === 'onion')!;
    await repo.applyChanges(b.db, [amountAfterUse(onionB, 'half')]);
    await syncOnce(b.local, server, HH);
    await syncOnce(a.local, server, HH);
    const onionA = (await repo.listItems(a.db)).find((i) => i.name === 'onion')!;
    expect([onionA.count, onionA.qtyLevel]).toEqual([2, 'half']);

    // A finishes the milk; it disappears on B too, and deleted rows get cleaned up.
    const milkA = (await repo.listItems(a.db)).find((i) => i.name === 'milk')!;
    await repo.removeItem(a.db, milkA, 'used');
    await syncOnce(a.local, server, HH);
    await syncOnce(b.local, server, HH);
    expect(await names(b.db)).toEqual(['onion', 'tortilla']);
    expect((await b.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM items WHERE deleted = 1'))?.n).toBe(0);

    // Shopping list: A adds, B checks it off at the store, A sees it checked.
    await repo.addToShopping(a.db, [{ name: 'eggs', reason: 'for frittata' }]);
    await syncOnce(a.local, server, HH);
    await syncOnce(b.local, server, HH);
    const eggsB = (await repo.listShopping(b.db)).find((s) => s.name === 'eggs')!;
    expect(eggsB.reason).toBe('for frittata');
    await repo.setShoppingChecked(b.db, eggsB.id, true);
    await syncOnce(b.local, server, HH);
    await syncOnce(a.local, server, HH);
    expect((await repo.listShopping(a.db)).find((s) => s.name === 'eggs')?.checked).toBe(true);

    // Recipes saved on one phone show up on the other.
    await repo.saveRecipe(b.db, {
      id: 'web-x-tacos', title: 'Tacos', minutes: 20, kind: 'recipe', tags: [], steps: ['Cook.'],
      ingredients: [{ name: 'tortilla', use: 'some' }], sourceUrl: 'https://example.com/tacos',
    });
    await syncOnce(b.local, server, HH);
    await syncOnce(a.local, server, HH);
    expect((await repo.listSavedRecipes(a.db)).map((r) => r.title)).toEqual(['Tacos']);
  });

  it('the edit that reaches the server last wins, and both phones end up the same', async () => {
    const server = fakeServer();
    const a = await phone();
    const b = await phone();
    await repo.addItem(a.db, { name: 'cheese', count: 3 });
    await prepareForHousehold(a.db);
    await syncOnce(a.local, server, HH);
    await prepareForHousehold(b.db);
    await syncOnce(b.local, server, HH);

    // Both edit the same cheese while offline.
    const ca = (await repo.listItems(a.db))[0];
    const cb = (await repo.listItems(b.db))[0];
    await repo.updateItem(a.db, ca.id, { count: 1 });
    await repo.updateItem(b.db, cb.id, { count: 2 });
    await syncOnce(a.local, server, HH);
    await syncOnce(b.local, server, HH); // B uploads last
    await syncOnce(a.local, server, HH);
    expect((await repo.listItems(a.db))[0].count).toBe(2);
    expect((await repo.listItems(b.db))[0].count).toBe(2);
  });

  it('keeps working offline and catches up later without losing edits', async () => {
    const server = fakeServer();
    const a = await phone();
    const b = await phone();
    await prepareForHousehold(a.db);
    await prepareForHousehold(b.db);
    server.offline = true;
    await repo.addItem(a.db, { name: 'salmon' });
    await expect(syncOnce(a.local, server, HH)).rejects.toThrow('offline');
    expect(await names(a.db)).toEqual(['salmon']); // still on the phone, still marked for upload
    server.offline = false;
    await syncOnce(a.local, server, HH);
    await syncOnce(b.local, server, HH);
    expect(await names(b.db)).toEqual(['salmon']);
  });

  it('an edit made during an upload is not marked as uploaded', async () => {
    const server = fakeServer();
    const a = await phone();
    await repo.addItem(a.db, { name: 'lemon' });
    await prepareForHousehold(a.db);
    const pending = await a.local.pending('items', HH);
    // The user edits the lemon after we read it but before the upload finishes.
    const lemon = (await repo.listItems(a.db))[0];
    await new Promise((r) => setTimeout(r, 2));
    await repo.updateItem(a.db, lemon.id, { count: 4 });
    await server.upsert('items', pending.map((p) => p.row));
    await a.local.markClean('items', pending.map((p) => ({ id: p.row.id, stamp: p.stamp })));
    expect((await a.local.pending('items', HH)).map((p) => p.row.count)).toEqual([4]);
  });
});

describe('merge rules', () => {
  it('never overwrites an unsent local edit', () => {
    expect(decideMerge({ dirty: true }, { deleted: false })).toBe('skip');
    expect(decideMerge({ dirty: true }, { deleted: true })).toBe('skip');
    expect(decideMerge({ dirty: false }, { deleted: false })).toBe('update');
    expect(decideMerge({ dirty: false }, { deleted: true })).toBe('delete');
    expect(decideMerge(undefined, { deleted: false })).toBe('insert');
    expect(decideMerge(undefined, { deleted: true })).toBe('skip');
  });
});

describe('cooking for: whose allergies count', () => {
  const members: Member[] = [
    { userId: 'me', displayName: 'Jay', allergies: ['shellfish'] },
    { userId: 'sam', displayName: 'Sam', allergies: ['Peanuts', 'dairy'] },
    { userId: 'kai', displayName: 'Kai', allergies: ['gluten'] },
  ];
  const mine = ['shellfish'];
  it('everyone (default) combines all allergies', () => {
    expect(effectiveAllergies(mine, members, undefined, 'me').sort()).toEqual(['dairy', 'gluten', 'peanuts', 'shellfish']);
    expect(effectiveAllergies(mine, members, 'everyone', 'me').sort()).toEqual(['dairy', 'gluten', 'peanuts', 'shellfish']);
  });
  it('just me uses only mine', () => {
    expect(effectiveAllergies(mine, members, 'me', 'me')).toEqual(['shellfish']);
  });
  it('specific people adds theirs to mine', () => {
    expect(effectiveAllergies(mine, members, ['kai'], 'me').sort()).toEqual(['gluten', 'shellfish']);
    expect(cookingForLabel(['kai'], members, 'me')).toBe('Me + Kai');
  });
  it('works without a household', () => {
    expect(effectiveAllergies(mine, [], 'everyone', undefined)).toEqual(['shellfish']);
  });
});

describe('invite codes', () => {
  it('accepts what people type', () => {
    expect(normalizeInviteCode(' k7q-2mx ')).toBe('K7Q2MX');
    expect(isValidInviteCode('k7q 2mx')).toBe(true);
    expect(isValidInviteCode('abc')).toBe(false);
  });
});
