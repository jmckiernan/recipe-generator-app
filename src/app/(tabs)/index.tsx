// "Tonight": the main screen. Open the app → see what to cook, expiring food first.

import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppData, pendingRecipes } from '../../state';
import { expiringItems, suggest, unlockSuggestions } from '../../domain/matcher';
import { adjacentSuggestions, buildTaste } from '../../domain/taste';
import { shouldSuggestFreezing } from '../../domain/shelfLife';
import type { Filters, Recipe, Suggestion } from '../../domain/types';
import { aiConfigured, generateRecipes } from '../../ai/client';
import { freezeItem } from '../../db/repo';
import { Button, C, Card, Chip, ExpiryBadge, H2, Input, Muted, Row } from '../../components/ui';

const TIME_OPTS: [string, number | undefined][] = [['15 min', 15], ['30 min', 30], ['45 min', 45], ['Any time', undefined]];
const ING_OPTS: [string, number | undefined][] = [['2 ingredients', 2], ['3 ingredients', 3], ['Any', undefined]];
const BUY_OPTS = [0, 1, 2, 3];

export default function Tonight() {
  const db = useSQLiteContext();
  const data = useAppData();
  const { items, profile, ratings, allRecipes, ready } = data;
  const [filters, setFilters] = useState<Filters>({ canBuy: 0 });
  const [ask, setAsk] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string>();
  const [aiRecipes, setAiRecipes] = useState<Recipe[]>([]);
  const [tryNext, setTryNext] = useState<{ ingredient: string; why: string }[]>([]);

  const expiring = useMemo(() => expiringItems(items, profile.expiryWarnDays), [items, profile]);
  const suggestions = useMemo(
    () => suggest([...aiRecipes, ...allRecipes], items, profile, ratings, filters),
    [aiRecipes, allRecipes, items, profile, ratings, filters],
  );
  const unlocks = useMemo(
    () => (filters.canBuy > 0 ? [] : unlockSuggestions(allRecipes, items, profile).slice(0, 3)),
    [allRecipes, items, profile, filters.canBuy],
  );
  const adjacent = useMemo(
    () => adjacentSuggestions(buildTaste(profile, ratings), items.map((i) => i.name)).slice(0, 2),
    [profile, ratings, items],
  );

  async function getAiIdeas() {
    setAiLoading(true);
    setAiError(undefined);
    try {
      const ratedTitles = new Map(allRecipes.map((r) => [r.id, r.title]));
      const res = await generateRecipes({
        inventory: items,
        profile,
        ratings,
        ratedTitles,
        recentCooks: data.recentCooks,
        filters,
        request: ask.trim() || undefined,
      });
      res.recipes.forEach((r) => pendingRecipes.put(r));
      setAiRecipes(res.recipes);
      setTryNext(res.tryNext);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  }

  if (!ready) return <ActivityIndicator style={{ marginTop: 40 }} color={C.primary} />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      {expiring.length > 0 && (
        <Card style={{ backgroundColor: C.warnSoft, borderColor: '#F5D88A' }}>
          <H2>Use these up soon</H2>
          {expiring.map((i) => (
            <Row key={i.id} style={{ justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 15, color: C.text }}>{i.name}</Text>
              <Row>
                {shouldSuggestFreezing(i.category, i.location, i.expiresAt, profile.expiryWarnDays) && (
                  <Pressable
                    onPress={async () => {
                      await freezeItem(db, i);
                      await data.refresh();
                    }}
                  >
                    <Text style={{ color: C.primary, fontWeight: '600' }}>Freeze it</Text>
                  </Pressable>
                )}
                <ExpiryBadge expiresAt={i.expiresAt} estimated={i.expiryEstimated} />
              </Row>
            </Row>
          ))}
        </Card>
      )}

      {items.length === 0 && (
        <Card>
          <H2>Your kitchen is empty</H2>
          <Muted>Add what you have, and dinner ideas show up here.</Muted>
          <Button label="Add food" onPress={() => router.push('/fridge')} />
        </Card>
      )}

      <View style={{ gap: 8 }}>
        <Row>
          {TIME_OPTS.map(([label, v]) => (
            <Chip key={label} label={label} active={filters.maxMinutes === v} onPress={() => setFilters({ ...filters, maxMinutes: v })} />
          ))}
        </Row>
        <Row>
          {ING_OPTS.map(([label, v]) => (
            <Chip key={label} label={label} active={filters.maxIngredients === v} onPress={() => setFilters({ ...filters, maxIngredients: v })} />
          ))}
        </Row>
        <Row>
          {BUY_OPTS.map((n) => (
            <Chip
              key={n}
              label={n === 0 ? 'Only what I have' : `Can buy ${n}`}
              active={filters.canBuy === n}
              onPress={() => setFilters({ ...filters, canBuy: n })}
            />
          ))}
        </Row>
      </View>

      {aiConfigured() && (
        <Card>
          <H2>Ask for something specific</H2>
          <Input
            value={ask}
            onChangeText={setAsk}
            placeholder="e.g. something creative, or a cheap Chipotle bowl"
            returnKeyType="go"
            onSubmitEditing={getAiIdeas}
          />
          <Button label={aiLoading ? 'Thinking…' : 'Get fresh ideas'} onPress={getAiIdeas} disabled={aiLoading} />
          {aiError && <Text style={{ color: C.danger }}>{aiError}</Text>}
        </Card>
      )}

      {items.length > 0 && <H2>{suggestions.length ? 'You can make' : 'No matches with these filters'}</H2>}
      {suggestions.length === 0 && items.length > 0 && (
        <Muted>Try “Can buy 1”, or loosen the time or ingredient limits.</Muted>
      )}
      {suggestions.slice(0, 12).map((sg) => (
        <SuggestionCard key={sg.recipe.id} sg={sg} />
      ))}

      {unlocks.length > 0 && (
        <Card>
          <H2>Worth picking up</H2>
          {unlocks.map((u) => (
            <Text key={u.ingredient} style={{ fontSize: 15, color: C.text }}>
              <Text style={{ fontWeight: '600' }}>{u.ingredient}</Text> unlocks {u.unlocks.length}{' '}
              {u.unlocks.length === 1 ? 'recipe' : 'recipes'}: {u.unlocks.slice(0, 3).join(', ')}
            </Text>
          ))}
        </Card>
      )}

      {(adjacent.length > 0 || tryNext.length > 0) && (
        <Card>
          <H2>You might like</H2>
          {adjacent.map((a) => (
            <Text key={a.name} style={{ fontSize: 15, color: C.text }}>
              <Text style={{ fontWeight: '600' }}>{a.name}</Text>, since you like {a.because}: {a.why}.
            </Text>
          ))}
          {tryNext.map((t) => (
            <Text key={t.ingredient} style={{ fontSize: 15, color: C.text }}>
              <Text style={{ fontWeight: '600' }}>{t.ingredient}</Text>: {t.why}
            </Text>
          ))}
        </Card>
      )}

      {data.stats.used + data.stats.tossed > 0 && (
        <Muted>
          You&apos;ve used {data.stats.used} of {data.stats.used + data.stats.tossed} items before they went bad.
        </Muted>
      )}
    </ScrollView>
  );
}

function SuggestionCard({ sg }: { sg: Suggestion }) {
  const r = sg.recipe;
  return (
    <Link href={{ pathname: '/recipe/[id]', params: { id: r.id } }} asChild>
      <Pressable>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: C.text, flexShrink: 1 }}>{r.title}</Text>
            <Muted>{r.minutes} min</Muted>
          </Row>
          <Row>
            {r.kind === 'assembly' && <Tag label="No recipe needed" />}
            {r.source === 'ai' && <Tag label="New idea" />}
          </Row>
          {r.why && <Text style={{ color: C.text, fontStyle: 'italic' }}>{r.why}</Text>}
          {sg.reasons.map((reason) => (
            <Text key={reason} style={{ color: C.muted, fontSize: 14 }}>
              • {reason}
            </Text>
          ))}
        </Card>
      </Pressable>
    </Link>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <View style={{ backgroundColor: C.primarySoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ color: C.primary, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}
