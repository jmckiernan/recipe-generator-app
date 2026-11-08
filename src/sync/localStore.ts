// The phone's side of household sync, backed by the app's SQLite database.

import type { SQLiteDatabase } from 'expo-sqlite';
import { decideMerge, EPOCH, type LocalStore, type PendingRow, type Table, type WireRow } from './engine';

/** The subset of expo-sqlite we use (lets tests run the same code on Node's SQLite). */
export type Db = Pick<SQLiteDatabase, 'runAsync' | 'getAllAsync' | 'getFirstAsync' | 'execAsync' | 'withTransactionAsync'>;

type Row = Record<string, string | number | null>;

const bool = (v: unknown) => (v ? 1 : 0);

function toWire(table: Table, r: Row, householdId: string): WireRow {
  if (table === 'items') {
    return {
      id: String(r.uid),
      household_id: householdId,
      name: r.name,
      category: r.category,
      location: r.location,
      count: r.count,
      qty_level: r.qty_level,
      purchased_at: r.purchased_at,
      expires_at: r.expires_at,
      expiry_estimated: r.expiry_estimated === 1,
      deleted: r.deleted === 1,
    };
  }
  if (table === 'shopping') {
    return {
      id: String(r.uid),
      household_id: householdId,
      name: r.name,
      reason: r.reason,
      checked: r.checked === 1,
      added_at: r.added_at,
      deleted: r.deleted === 1,
    };
  }
  return {
    id: String(r.id),
    household_id: householdId,
    json: JSON.parse(String(r.json)) as unknown,
    deleted: r.deleted === 1,
  };
}

/** Server dates can come back as "2026-11-08" or full timestamps; keep the local format. */
const day = (v: unknown) => String(v).slice(0, 10);

export function sqliteLocalStore(db: Db): LocalStore {
  const key = (t: Table) => (t === 'recipes' ? 'id' : 'uid');

  return {
    async pending(table, householdId): Promise<PendingRow[]> {
      const rows = await db.getAllAsync<Row>(`SELECT * FROM ${table} WHERE dirty = 1`);
      return rows.map((r) => ({ row: toWire(table, r, householdId), stamp: String(r.updated_at) }));
    },

    async markClean(table, rows) {
      for (const r of rows) {
        await db.runAsync(`UPDATE ${table} SET dirty = 0 WHERE ${key(table)} = ? AND updated_at = ?`, r.id, r.stamp);
      }
    },

    async applyRemote(table, rows) {
      let changed = 0;
      await db.withTransactionAsync(async () => {
        for (const w of rows) {
          const local = await db.getFirstAsync<{ dirty: number; updated_at: string }>(
            `SELECT dirty, updated_at FROM ${table} WHERE ${key(table)} = ?`,
            w.id,
          );
          const action = decideMerge(local ? { dirty: local.dirty === 1 } : undefined, w);
          if (action === 'skip') continue;
          // Already have exactly this version (e.g. our own upload coming back).
          if (action === 'update' && local?.updated_at === w.updated_at) continue;
          const ts = String(w.updated_at ?? '');
          if (action === 'delete') {
            await db.runAsync(`UPDATE ${table} SET deleted = 1, dirty = 0, updated_at = ? WHERE ${key(table)} = ?`, ts, w.id);
          } else if (table === 'items') {
            const vals = [
              w.name, w.category, w.location, w.count, w.qty_level, day(w.purchased_at), day(w.expires_at),
              bool(w.expiry_estimated), ts,
            ] as (string | number)[];
            if (action === 'insert') {
              await db.runAsync(
                `INSERT INTO items (name, category, location, count, qty_level, purchased_at, expires_at, expiry_estimated, updated_at, uid, dirty, deleted)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
                ...vals,
                w.id,
              );
            } else {
              await db.runAsync(
                `UPDATE items SET name = ?, category = ?, location = ?, count = ?, qty_level = ?, purchased_at = ?, expires_at = ?,
                 expiry_estimated = ?, updated_at = ?, dirty = 0, deleted = 0 WHERE uid = ?`,
                ...vals,
                w.id,
              );
            }
          } else if (table === 'shopping') {
            const vals = [w.name, w.reason ?? '', bool(w.checked), String(w.added_at ?? ts), ts] as (string | number)[];
            if (action === 'insert') {
              await db.runAsync(
                `INSERT INTO shopping (name, reason, checked, added_at, updated_at, uid, dirty, deleted) VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
                ...vals,
                w.id,
              );
            } else {
              await db.runAsync(
                `UPDATE shopping SET name = ?, reason = ?, checked = ?, added_at = ?, updated_at = ?, dirty = 0, deleted = 0 WHERE uid = ?`,
                ...vals,
                w.id,
              );
            }
          } else {
            const json = JSON.stringify(w.json);
            await db.runAsync(
              `INSERT INTO recipes (id, json, created_at, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 0, 0)
               ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, dirty = 0, deleted = 0`,
              w.id,
              json,
              ts,
              ts,
            );
          }
          changed += 1;
        }
      });
      return changed;
    },

    async getCursor(table) {
      const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', `sync_cursor_${table}`);
      return r?.value ?? EPOCH;
    },

    async setCursor(table, cursor) {
      await db.runAsync(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        `sync_cursor_${table}`,
        cursor,
      );
    },

    async purgeDeleted() {
      for (const t of ['items', 'shopping', 'recipes']) {
        await db.runAsync(`DELETE FROM ${t} WHERE deleted = 1 AND dirty = 0`);
      }
    },
  };
}

/**
 * Starting fresh with a household (join or create): forget old sync positions,
 * drop deletions that were never shared, and mark everything on this phone
 * for upload so your food merges into the household.
 */
export async function prepareForHousehold(db: Db): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const t of ['items', 'shopping', 'recipes']) {
      await db.runAsync(`DELETE FROM ${t} WHERE deleted = 1`);
      await db.runAsync(`UPDATE ${t} SET dirty = 1`);
    }
    await db.runAsync("DELETE FROM settings WHERE key LIKE 'sync_cursor_%'");
  });
}
