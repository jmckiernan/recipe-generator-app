// Recipes from the web (feature #3): import a recipe by link, or find recipes
// on your favorite sites that use what's in your fridge. Always links back to the source.

import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppData } from '../state';
import { recipeFromHtml, siteName } from '../domain/recipeImport';
import { siteSearchUrl } from '../domain/sites';
import { expiringItems, isStaple } from '../domain/matcher';
import { findItemFor } from '../domain/inventory';
import { violatesAllergies } from '../domain/taste';
import type { Recipe } from '../domain/types';
import { aiConfigured, findOnSites, type FoundRecipe } from '../ai/client';
import * as repo from '../db/repo';
import { Button, C, Card, Chip, H1, H2, Input, Muted, Row } from '../components/ui';

export default function ImportScreen() {
  const params = useLocalSearchParams<{ url?: string }>();
  const db = useSQLiteContext();
  const { items, profile, refresh } = useAppData();
  const [url, setUrl] = useState(params.url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<Recipe>();
  const [found, setFound] = useState<FoundRecipe[]>();
  const [searching, setSearching] = useState(false);

  // Search terms: what expires soonest first, then other non-staples.
  const terms = useMemo(() => {
    const exp = expiringItems(items, profile.expiryWarnDays + 2).map((i) => i.name);
    const rest = items.filter((i) => i.category !== 'leftovers' && !isStaple(i.name, profile.staples)).map((i) => i.name);
    return Array.from(new Set([...exp, ...rest])).slice(0, 8);
  }, [items, profile]);
  const [picked, setPicked] = useState<string[]>([]);
  const query = picked.length ? picked : terms.slice(0, 2);

  async function importUrl(target: string) {
    const u = target.trim();
    if (!/^https?:\/\//i.test(u)) return setError('Paste the full link, starting with https://');
    setBusy(true);
    setError(undefined);
    setPreview(undefined);
    try {
      const res = await fetch(u, { headers: { Accept: 'text/html' } });
      if (!res.ok) throw new Error(`The site answered ${res.status}.`);
      const r = recipeFromHtml(await res.text(), u);
      if (!r) throw new Error("Couldn't find a recipe on that page. Try the recipe's own page, not a list or search page.");
      setPreview(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        Platform.OS === 'web' && /fetch|network/i.test(msg)
          ? 'Browsers block reading other sites. Importing works in the phone app.'
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview) return;
    await repo.saveRecipe(db, preview);
    await refresh();
    router.replace({ pathname: '/recipe/[id]', params: { id: preview.id } });
  }

  async function searchSites() {
    setSearching(true);
    setError(undefined);
    try {
      setFound(
        await findOnSites({
          sites: profile.favoriteSites,
          ingredients: query,
          likes: profile.likes,
          allergies: profile.allergies,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  const allergyHit = preview ? violatesAllergies(preview, profile.allergies) : false;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <H1>Recipes from the web</H1>

      <Card>
        <H2>Import by link</H2>
        <Muted>Works with most recipe sites. We save a summary and link back to the original.</Muted>
        <Input value={url} onChangeText={setUrl} placeholder="https://…" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Button label={busy ? 'Reading…' : 'Import'} onPress={() => importUrl(url)} disabled={busy || !url.trim()} />
        {error && <Text style={{ color: C.danger }}>{error}</Text>}
      </Card>

      {preview && (
        <Card>
          <H2>{preview.title}</H2>
          <Muted>
            {siteName(preview.sourceUrl ?? '')} · {preview.minutes} min
            {preview.servings ? ` · ${preview.servings} servings` : ''}
          </Muted>
          {allergyHit && <Text style={{ color: C.danger, fontWeight: '600' }}>Contains something on your allergy list.</Text>}
          {preview.ingredients.map((i) => {
            const have = isStaple(i.name, profile.staples) || !!findItemFor(items, i.name);
            return (
              <Text key={i.name} style={{ color: C.text }}>
                {have ? '✓' : '○'} {i.name}
                {i.optional ? <Text style={{ color: C.muted }}> optional</Text> : null}
              </Text>
            );
          })}
          <Button label="Save to my recipes" onPress={save} />
        </Card>
      )}

      <Card>
        <H2>Find on your sites</H2>
        {profile.favoriteSites.length === 0 ? (
          <>
            <Muted>Add your favorite recipe sites first.</Muted>
            <Button label="Add sites" kind="secondary" onPress={() => router.push('/profile')} />
          </>
        ) : (
          <>
            <Muted>Using: {query.join(', ') || 'anything'}. Tap to change.</Muted>
            <Row>
              {terms.map((t) => (
                <Chip
                  key={t}
                  label={t}
                  active={query.includes(t)}
                  onPress={() => setPicked(query.includes(t) ? query.filter((x) => x !== t) : [...query, t])}
                />
              ))}
            </Row>
            {aiConfigured() && (
              <Button label={searching ? 'Searching…' : 'Search my sites for me'} onPress={searchSites} disabled={searching} />
            )}
            {searching && <ActivityIndicator color={C.primary} />}
            {found?.length === 0 && <Muted>Nothing found. Try fewer ingredients.</Muted>}
            {found?.map((f) => (
              <View key={f.url} style={{ gap: 4, paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.border }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>{f.title}</Text>
                <Muted>
                  {f.site} · {f.why}
                </Muted>
                <Row>
                  <Chip
                    label="Import"
                    onPress={() => {
                      setUrl(f.url);
                      importUrl(f.url);
                    }}
                  />
                  <Chip label="Open site" onPress={() => Linking.openURL(f.url)} />
                </Row>
              </View>
            ))}
            <Muted>Or search a site yourself:</Muted>
            <Row>
              {profile.favoriteSites.map((s) => (
                <Pressable key={s} onPress={() => Linking.openURL(siteSearchUrl(s, query))}>
                  <Text style={{ color: C.primary, fontWeight: '600', paddingVertical: 4 }}>{s} ↗</Text>
                </Pressable>
              ))}
            </Row>
          </>
        )}
      </Card>
    </ScrollView>
  );
}
