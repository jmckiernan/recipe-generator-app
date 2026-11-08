// Household rules that don't depend on Supabase: whose allergies count, invite codes.

export interface Member {
  userId: string;
  displayName: string;
  allergies: string[];
}

/** Who you're cooking for: everyone in the house, just you, or specific people (user ids). */
export type CookingFor = 'everyone' | 'me' | string[];

/**
 * Allergies that suggestions must avoid: always yours, plus those of whoever
 * you're cooking for. Duplicates removed, lowercase.
 */
export function effectiveAllergies(
  mine: string[],
  members: Member[],
  cookingFor: CookingFor | undefined,
  myUserId: string | undefined,
): string[] {
  const others = members.filter((m) => m.userId !== myUserId);
  const chosen =
    cookingFor === 'me'
      ? []
      : cookingFor === 'everyone' || cookingFor === undefined
        ? others
        : others.filter((m) => cookingFor.includes(m.userId));
  const all = [...mine, ...chosen.flatMap((m) => m.allergies)].map((a) => a.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(all));
}

/** "k7q-2mx " → "K7Q2MX". */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidInviteCode(input: string): boolean {
  return /^[A-Z0-9]{6}$/.test(normalizeInviteCode(input));
}

/** Friendly label for the "Cooking for" row. */
export function cookingForLabel(cookingFor: CookingFor | undefined, members: Member[], myUserId?: string): string {
  if (cookingFor === 'me') return 'Just me';
  if (cookingFor === 'everyone' || cookingFor === undefined) return 'Everyone';
  const names = members.filter((m) => m.userId !== myUserId && cookingFor.includes(m.userId)).map((m) => m.displayName || 'someone');
  return names.length ? `Me + ${names.join(', ')}` : 'Just me';
}
