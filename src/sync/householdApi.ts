// Sign-in, households, and the Supabase side of sync.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RemoteStore, Table, WireRow } from './engine';
import type { Member } from '../domain/household';
import { normalizeInviteCode } from '../domain/household';

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
}

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

// ---------- Sign in with an emailed 6-digit code ----------

export async function sendCode(sb: SupabaseClient, email: string): Promise<void> {
  const { error } = await sb.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } });
  fail(error);
}

export async function verifyCode(sb: SupabaseClient, email: string, code: string): Promise<void> {
  const { error } = await sb.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.replace(/\D/g, ''),
    type: 'email',
  });
  fail(error);
}

// ---------- Households ----------

interface HouseholdRow {
  id: string;
  name: string;
  invite_code: string;
}
const toHousehold = (r: HouseholdRow): Household => ({ id: r.id, name: r.name, inviteCode: r.invite_code });

export async function myHousehold(sb: SupabaseClient, userId: string): Promise<Household | null> {
  const { data: m, error } = await sb.from('household_members').select('household_id').eq('user_id', userId).maybeSingle();
  fail(error);
  if (!m) return null;
  const { data: h, error: e2 } = await sb.from('households').select('id, name, invite_code').eq('id', m.household_id).single();
  fail(e2);
  return toHousehold(h as HouseholdRow);
}

export async function listMembers(sb: SupabaseClient, householdId: string): Promise<Member[]> {
  const { data, error } = await sb
    .from('household_members')
    .select('user_id, display_name, allergies, joined_at')
    .eq('household_id', householdId)
    .order('joined_at');
  fail(error);
  return (data ?? []).map((r: { user_id: string; display_name: string; allergies: string[] | null }) => ({
    userId: r.user_id,
    displayName: r.display_name,
    allergies: r.allergies ?? [],
  }));
}

export async function createHousehold(sb: SupabaseClient, name: string, displayName: string): Promise<Household> {
  const { data, error } = await sb.rpc('create_household', { p_name: name, p_display_name: displayName });
  fail(error);
  return toHousehold(data as HouseholdRow);
}

export async function joinHousehold(sb: SupabaseClient, code: string, displayName: string): Promise<Household> {
  const { data, error } = await sb.rpc('join_household', { p_code: normalizeInviteCode(code), p_display_name: displayName });
  fail(error);
  return toHousehold(data as HouseholdRow);
}

export async function leaveHousehold(sb: SupabaseClient): Promise<void> {
  const { error } = await sb.rpc('leave_household');
  fail(error);
}

export async function updateMe(sb: SupabaseClient, displayName: string, allergies: string[]): Promise<void> {
  const { error } = await sb.rpc('update_my_member', { p_display_name: displayName, p_allergies: allergies });
  fail(error);
}

// ---------- Sync transport ----------

export function supabaseRemote(sb: SupabaseClient): RemoteStore {
  return {
    async upsert(table: Table, rows: WireRow[]) {
      // The server sets updated_at / updated_by itself.
      const clean = rows.map(({ updated_at: _u, ...r }) => r);
      const { error } = await sb.from(table).upsert(clean, { onConflict: table === 'recipes' ? 'household_id,id' : 'id' });
      fail(error);
    },
    async changedSince(table, householdId, since, limit) {
      const { data, error } = await sb
        .from(table)
        .select('*')
        .eq('household_id', householdId)
        .gt('updated_at', since)
        .order('updated_at', { ascending: true })
        .limit(limit);
      fail(error);
      return (data ?? []) as WireRow[];
    },
  };
}
