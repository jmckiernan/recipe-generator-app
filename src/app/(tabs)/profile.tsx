// "Taste": likes, dislikes, allergies, staples, favorite restaurants, reminder settings.

import { useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { Link } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppData } from '../../state';
import type { Goal, Profile } from '../../domain/types';
import { normalizeSite, SUGGESTED_SITES } from '../../domain/sites';
import { getProfile, saveProfile } from '../../db/repo';
import { ensurePermission } from '../../notifications';
import { Button, C, Card, Chip, H2, Input, Muted, Row } from '../../components/ui';

type ListKey = 'likes' | 'dislikes' | 'allergies' | 'staples' | 'favoriteRestaurants' | 'favoriteSites';

const SECTIONS: { key: ListKey; title: string; hint: string; placeholder: string }[] = [
  { key: 'likes', title: 'Foods & cuisines you like', hint: 'Used to rank suggestions and find similar foods.', placeholder: 'onion, mexican, spicy' },
  { key: 'dislikes', title: "Don't suggest", hint: 'Strongly avoided.', placeholder: 'mushroom, olives' },
  { key: 'allergies', title: 'Allergies & restrictions', hint: 'Hard rule. Never suggested. Groups like dairy, gluten, nuts are expanded.', placeholder: 'peanuts, shellfish, dairy' },
  { key: 'staples', title: 'Always on hand', hint: "Assumed you have these. They don't count toward 2- or 3-ingredient recipes.", placeholder: 'salt, olive oil' },
  { key: 'favoriteRestaurants', title: 'Favorite restaurants', hint: 'Copycat recipes from these rank higher and show what you save.', placeholder: 'Chipotle, Panera' },
  { key: 'favoriteSites', title: 'Favorite recipe sites', hint: 'Find recipes on these that use what you have.', placeholder: 'seriouseats.com' },
];

export default function ProfileScreen() {
  const db = useSQLiteContext();
  const { profile: p, refresh, ratings, household: hh } = useAppData();
  const [drafts, setDrafts] = useState<Record<ListKey, string>>({
    likes: '',
    dislikes: '',
    allergies: '',
    staples: '',
    favoriteRestaurants: '',
    favoriteSites: '',
  });
  const [siteError, setSiteError] = useState<string>();

  // Merge into the latest saved profile, so quick taps in a row don't overwrite each other.
  async function persist(patch: Partial<Profile>) {
    const current = await getProfile(db);
    await saveProfile(db, { ...current, ...patch });
    await refresh();
  }

  function addTo(key: ListKey) {
    let vals = drafts[key]
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    if (key === 'favoriteSites') {
      const ok = vals.map(normalizeSite).filter((v): v is string => v !== null);
      setSiteError(ok.length < vals.length ? 'Use a site address like seriouseats.com' : undefined);
      vals = ok;
    }
    if (!vals.length) return;
    const merged = Array.from(new Set([...p[key], ...vals]));
    setDrafts({ ...drafts, [key]: '' });
    persist({ [key]: merged });
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Link href="/household" asChild>
        <Pressable>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <H2>Household</H2>
              <Text style={{ color: C.primary, fontSize: 22 }}>›</Text>
            </Row>
            <Muted>
              {hh.household
                ? `${hh.household.name} · ${hh.members.length} member${hh.members.length === 1 ? '' : 's'}`
                : 'Share your fridge and shopping list with the people you live with'}
            </Muted>
          </Card>
        </Pressable>
      </Link>

      {SECTIONS.map((sec) => (
        <Card key={sec.key}>
          <H2>{sec.title}</H2>
          <Muted>{sec.hint}</Muted>
          <Row>
            {p[sec.key].map((v) => (
              <Chip key={v} label={`${v}  ✕`} onPress={() => persist({ [sec.key]: p[sec.key].filter((x) => x !== v) })} />
            ))}
          </Row>
          <Row>
            <Input
              value={drafts[sec.key]}
              onChangeText={(t) => setDrafts({ ...drafts, [sec.key]: t })}
              placeholder={sec.placeholder}
              onSubmitEditing={() => addTo(sec.key)}
              style={{ flex: 1 }}
            />
            <Chip label="Add" onPress={() => addTo(sec.key)} />
          </Row>
          {sec.key === 'favoriteSites' && (
            <>
              {siteError && <Text style={{ color: C.danger }}>{siteError}</Text>}
              <Row>
                {SUGGESTED_SITES.filter((s) => !p.favoriteSites.includes(s)).map((s) => (
                  <Chip key={s} label={`+ ${s}`} onPress={() => persist({ favoriteSites: [...p.favoriteSites, s] })} />
                ))}
              </Row>
            </>
          )}
        </Card>
      ))}

      <Card>
        <H2>Your goal</H2>
        <Muted>Sets the default version of every recipe: lighter for cutting, hearty for bulking.</Muted>
        <Row>
          {(
            [
              ['cut', 'Cut (lighter)'],
              ['maintain', 'Maintain'],
              ['bulk', 'Bulk (hearty)'],
            ] as [Goal, string][]
          ).map(([g, label]) => (
            <Chip key={g} label={label} active={p.goal === g} onPress={() => persist({ goal: g })} />
          ))}
        </Row>
        <Muted>Daily protein target:</Muted>
        <Row>
          {[undefined, 100, 130, 160, 200].map((t) => (
            <Chip key={t ?? 'none'} label={t ? `${t} g` : 'None'} active={p.proteinTarget === t} onPress={() => persist({ proteinTarget: t })} />
          ))}
        </Row>
      </Card>

      <Card>
        <H2>Expiring-soon reminder</H2>
        <Muted>Warn me when food is this many days from expiring:</Muted>
        <Row>
          {[1, 2, 3, 4, 5].map((d) => (
            <Chip key={d} label={`${d} day${d > 1 ? 's' : ''}`} active={p.expiryWarnDays === d} onPress={() => persist({ expiryWarnDays: d })} />
          ))}
        </Row>
        <Muted>Daily reminder time:</Muted>
        <Row>
          {[15, 16, 17, 18].map((h) => (
            <Chip
              key={h}
              label={`${h - 12} pm`}
              active={p.notifyHour === h && p.notifyMinute === 0}
              onPress={() => persist({ notifyHour: h, notifyMinute: 0 })}
            />
          ))}
        </Row>
        <Button label="Turn on reminders" kind="secondary" onPress={() => ensurePermission().then(() => refresh())} />
      </Card>

      <Text style={{ color: C.muted, textAlign: 'center' }}>
        {ratings.length} recipe{ratings.length === 1 ? '' : 's'} rated. Ratings teach the app what you like.
      </Text>
    </ScrollView>
  );
}
