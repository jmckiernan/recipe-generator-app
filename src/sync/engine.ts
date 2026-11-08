// Household sync: push local changes, pull everyone else's, merge by row id.
//
// Rules:
// - The server stamps every write with its own clock (updated_at), so phones
//   with wrong clocks can't confuse the order of changes.
// - If two people edit the same row, the edit that reaches the server last wins.
// - A row you changed locally that hasn't uploaded yet is never overwritten by a pull.
// - Deletes are rows with deleted = true, so they reach the other phones too.
//
// This file has no Supabase or SQLite imports: both sides are interfaces, so it
// can be tested with a fake server and Node's SQLite.

export type Table = 'items' | 'shopping' | 'recipes';
export const TABLES: Table[] = ['items', 'shopping', 'recipes'];

/** A row in the shape the server stores it. */
export interface WireRow {
  id: string;
  household_id: string;
  deleted: boolean;
  updated_at?: string;
  [column: string]: unknown;
}

export interface PendingRow {
  row: WireRow;
  /** The local change time we read; the row is only marked uploaded if it hasn't changed since. */
  stamp: string;
}

export interface LocalStore {
  pending(table: Table, householdId: string): Promise<PendingRow[]>;
  markClean(table: Table, rows: { id: string; stamp: string }[]): Promise<void>;
  /** Merge server rows into the local copy. Returns how many local rows changed. */
  applyRemote(table: Table, rows: WireRow[]): Promise<number>;
  getCursor(table: Table): Promise<string>;
  setCursor(table: Table, cursor: string): Promise<void>;
  purgeDeleted(): Promise<void>;
}

export interface RemoteStore {
  upsert(table: Table, rows: WireRow[]): Promise<void>;
  /** Rows with updated_at > since, oldest first, at most `limit`. */
  changedSince(table: Table, householdId: string, since: string, limit: number): Promise<WireRow[]>;
}

/** What to do with one incoming server row. */
export type MergeAction = 'insert' | 'update' | 'delete' | 'skip';

export function decideMerge(local: { dirty: boolean } | undefined, remote: { deleted: boolean }): MergeAction {
  if (local?.dirty) return 'skip'; // our unsent edit wins; it uploads next
  if (remote.deleted) return local ? 'delete' : 'skip';
  return local ? 'update' : 'insert';
}

const PAGE = 500;
/** Re-read a few seconds back, in case a slow write landed just behind the cursor. Merging is idempotent. */
const OVERLAP_MS = 5_000;
export const EPOCH = '1970-01-01T00:00:00.000Z';

function backOff(cursor: string): string {
  const t = Date.parse(cursor);
  return Number.isNaN(t) || cursor === EPOCH ? EPOCH : new Date(Math.max(0, t - OVERLAP_MS)).toISOString();
}

export interface SyncResult {
  pushed: number;
  changed: number;
}

export async function syncOnce(local: LocalStore, remote: RemoteStore, householdId: string): Promise<SyncResult> {
  let pushed = 0;
  let changed = 0;
  for (const table of TABLES) {
    // 1. Push
    const pending = await local.pending(table, householdId);
    for (let i = 0; i < pending.length; i += 200) {
      const chunk = pending.slice(i, i + 200);
      await remote.upsert(
        table,
        chunk.map((p) => p.row),
      );
      await local.markClean(
        table,
        chunk.map((p) => ({ id: p.row.id, stamp: p.stamp })),
      );
      pushed += chunk.length;
    }
    // 2. Pull
    let cursor = await local.getCursor(table);
    let since = backOff(cursor);
    for (;;) {
      const rows = await remote.changedSince(table, householdId, since, PAGE);
      if (!rows.length) break;
      changed += await local.applyRemote(table, rows);
      const last = rows[rows.length - 1].updated_at;
      if (last && last > cursor) cursor = last;
      if (rows.length < PAGE || !last || last === since) break;
      since = last;
    }
    await local.setCursor(table, cursor);
  }
  await local.purgeDeleted();
  return { pushed, changed };
}
