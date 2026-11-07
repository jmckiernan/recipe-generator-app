// Partial-quantity math. An item is "count" units where the last opened unit
// may be full, half, or a little. Cooking subtracts from that.

import type { InventoryItem, QtyLevel, Recipe, UseAmount } from './types';
import { ingredientMatches } from './normalize';
import { daysUntil } from './shelfLife';

const LEVEL_VALUE: Record<QtyLevel, number> = { full: 1, half: 0.5, little: 0.25 };
const USE_VALUE: Record<UseAmount, number> = { all: 1, half: 0.5, some: 0.25 };

export function totalAmount(item: Pick<InventoryItem, 'count' | 'qtyLevel'>): number {
  return Math.max(0, item.count - 1) + LEVEL_VALUE[item.qtyLevel];
}

/** Turn a numeric amount back into count + level. Returns null when used up. */
export function fromAmount(total: number): { count: number; qtyLevel: QtyLevel } | null {
  if (total <= 0.1) return null;
  const count = Math.ceil(total - 1e-9);
  const frac = total - (count - 1);
  const qtyLevel: QtyLevel = frac >= 0.75 ? 'full' : frac >= 0.375 ? 'half' : 'little';
  return { count, qtyLevel };
}

export type InventoryChange =
  | { id: number; kind: 'update'; count: number; qtyLevel: QtyLevel; name: string }
  | { id: number; kind: 'remove'; name: string };

/**
 * Pick which inventory item to use for a recipe ingredient: the one expiring soonest.
 * Expired items are skipped, so the app never quietly cooks with spoiled food.
 */
export function findItemFor(
  inventory: InventoryItem[],
  ingredientName: string,
  today: Date = new Date(),
): InventoryItem | undefined {
  return inventory
    .filter((i) => ingredientMatches(i.name, ingredientName) && daysUntil(i.expiresAt, today) >= 0)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0];
}

/** Compute inventory changes for cooking a recipe (feature #11). */
export function changesForCooking(
  inventory: InventoryItem[],
  recipe: Recipe,
  staples: string[],
  today: Date = new Date(),
): InventoryChange[] {
  const changes: InventoryChange[] = [];
  // Work on a copy so two ingredients matching the same item stack correctly.
  const remaining = new Map(inventory.map((i) => [i.id, totalAmount(i)]));
  for (const ing of recipe.ingredients) {
    if (staples.some((s) => ingredientMatches(s, ing.name))) continue;
    const item = findItemFor(inventory, ing.name, today);
    if (!item) continue;
    const left = (remaining.get(item.id) ?? 0) - USE_VALUE[ing.use];
    remaining.set(item.id, left);
  }
  for (const item of inventory) {
    const before = totalAmount(item);
    const after = remaining.get(item.id)!;
    if (Math.abs(before - after) < 1e-9) continue;
    const next = fromAmount(after);
    changes.push(
      next
        ? { id: item.id, kind: 'update', name: item.name, ...next }
        : { id: item.id, kind: 'remove', name: item.name },
    );
  }
  return changes;
}

/** Manual "used half" / "used it" from the fridge screen. */
export function amountAfterUse(item: InventoryItem, use: UseAmount): InventoryChange {
  const next = fromAmount(totalAmount(item) - USE_VALUE[use]);
  return next
    ? { id: item.id, kind: 'update', name: item.name, ...next }
    : { id: item.id, kind: 'remove', name: item.name };
}

export function describeAmount(item: Pick<InventoryItem, 'count' | 'qtyLevel'>): string {
  const lvl = item.qtyLevel === 'full' ? '' : item.qtyLevel === 'half' ? '½' : 'a little';
  if (item.count <= 1) return lvl || '1';
  return lvl ? `${item.count - 1} + ${lvl}` : String(item.count);
}
