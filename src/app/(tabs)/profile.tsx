// "Taste": likes, dislikes, allergies, staples, favorite restaurants, reminder settings.

import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppData } from '../../state';
import type { Profile } from '../../domain/types';
import { saveProfile } from '../../db/repo';
import { ensurePermission } from '../../notifications';
import { Button, C, Card, Chip, H2, Input, Muted, Row } from '../../components/ui';

type ListKey = 'likes' | 'dislikes' | 'allergies' | 'staples' | 'favoriteRestaurants';

const SECTIONS: { key: ListKey; title: string; hint: string; placeholder: string }[] = [
  { key: 'likes', title: 'Foods & cuisines you like', hint: 'Used to rank suggestions and find similar foods.', placeholder: 'onion, mexican, spicy' },
  { key: 'dislikes', title: "Don't suggest", hint: 'Strongly avoided.', placeholder: 'mushroom, olives' },
  { key: 'allergies', title: 'Allergies & restrictions', hint: 'Hard rule. Never suggested. Groups like dairy, gluten, nuts are expanded.', placeholder: 'peanuts, shellfish, dairy' },
  { key: 'staples', title: 'Always on hand', hint: "Assumed you have these. They don't count toward 2- or 3-ingredient recipes.", placeholder: 'salt, olive oil' },
  { key: 'favoriteRestaurants', title: 'Favorite restaurants', hint: 'AI ideas can include cheaper homemade versions.', placeholder: 'Chipotle, Panera' },
];

export default function ProfileScreen() {
  const db = useSQLiteContext();
  const { profile: p, refresh, ratings } = useAppData();
  const [drafts, setDrafts] = useState<Record<ListKey, string>>({
    likes: '',
    dislikes: '',
    allergies: '',
    staples: '',
    favoriteRestaurants: '',
  });

  async function persist(next: Profile) {
    await saveProfile(db, next);
    await refresh();
  }

  function addTo(key: ListKey) {
    const vals = drafts[key]
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    if (!vals.length) return;
    const merged = Array.from(new Set([...p[key], ...vals]));
    setDrafts({ ...drafts, [key]: '' });
    persist({ ...p, [key]: merged });
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      {SECTIONS.map((sec) => (
        <Card key={sec.key}>
          <H2>{sec.title}</H2>
          <Muted>{sec.hint}</Muted>
          <Row>
            {p[sec.key].map((v) => (
              <Chip key={v} label={`${v}  ✕`} onPress={() => persist({ ...p, [sec.key]: p[sec.key].filter((x) => x !== v) })} />
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
        </Card>
      ))}

      <Card>
        <H2>Expiring-soon reminder</H2>
        <Muted>Warn me when food is this many days from expiring:</Muted>
        <Row>
          {[1, 2, 3, 4, 5].map((d) => (
            <Chip key={d} label={`${d} day${d > 1 ? 's' : ''}`} active={p.expiryWarnDays === d} onPress={() => persist({ ...p, expiryWarnDays: d })} />
          ))}
        </Row>
        <Muted>Daily reminder time:</Muted>
        <Row>
          {[15, 16, 17, 18].map((h) => (
            <Chip
              key={h}
              label={`${h - 12} pm`}
              active={p.notifyHour === h && p.notifyMinute === 0}
              onPress={() => persist({ ...p, notifyHour: h, notifyMinute: 0 })}
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
