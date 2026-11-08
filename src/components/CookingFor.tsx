// "Cooking for" chips on Tonight: whose allergies suggestions should avoid.

import { Text } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppData } from '../state';
import { getProfile, saveProfile } from '../db/repo';
import type { Profile } from '../domain/types';
import { C, Chip, Row } from './ui';

export function CookingFor() {
  const db = useSQLiteContext();
  const { household: hh, profile, planningProfile, refresh } = useAppData();
  const others = hh.members.filter((m) => m.userId !== hh.myUserId);
  if (!hh.household || others.length === 0) return null;

  const cf = profile.cookingFor ?? 'everyone';
  const set = async (next: Profile['cookingFor']) => {
    const p = await getProfile(db);
    await saveProfile(db, { ...p, cookingFor: next });
    await refresh();
  };
  const picked = (id: string) => cf === 'everyone' || (Array.isArray(cf) && cf.includes(id));
  const toggle = (id: string) => {
    const current = cf === 'everyone' ? others.map((o) => o.userId) : cf === 'me' ? [] : cf;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    if (next.length === 0) return set('me');
    if (next.length === others.length) return set('everyone');
    return set(next);
  };

  return (
    <>
      <Row>
        <Text style={{ color: C.muted, fontSize: 14 }}>Cooking for:</Text>
        <Chip label="Everyone" active={cf === 'everyone'} onPress={() => set('everyone')} />
        <Chip label="Just me" active={cf === 'me'} onPress={() => set('me')} />
        {others.length > 1 &&
          others.map((m) => (
            <Chip key={m.userId} label={m.displayName || 'Someone'} active={cf !== 'everyone' && picked(m.userId)} onPress={() => toggle(m.userId)} />
          ))}
      </Row>
      {planningProfile.allergies.length > 0 && (
        <Text style={{ color: C.muted, fontSize: 13 }}>Avoiding: {planningProfile.allergies.join(', ')}</Text>
      )}
    </>
  );
}
