// Recipe detail: lighter / classic / hearty versions, what you have vs need,
// steps, "I made this" (updates My Food + saves leftovers), and star rating.

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppData } from '../../state';
import { changesForCooking, findItemFor } from '../../domain/inventory';
import { isStaple } from '../../domain/matcher';
import { makeVariant, parseVariantId } from '../../domain/variants';
import type { Style } from '../../domain/types';
import * as repo from '../../db/repo';
import { Button, C, Card, Chip, H1, H2, Muted, Row } from '../../components/ui';

const STYLES: { key: Style; label: string }[] = [
  { key: 'lighter', label: 'Lighter' },
  { key: 'classic', label: 'Classic' },
  { key: 'hearty', label: 'Hearty' },
];

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const data = useAppData();
  const parsed = parseVariantId(id);
  const base = data.findRecipe(parsed.baseId);
  const [style, setStyle] = useState<Style>(parsed.style);
  const existing = data.ratings.find((r) => r.recipeId === parsed.baseId)?.stars ?? 0;
  const [stars, setStars] = useState(existing);
  const [step, setStep] = useState<'idle' | 'confirm' | 'leftovers' | 'done'>('idle');
  const [note, setNote] = useState<string>();

  const variants = useMemo(() => {
    if (!base) return null;
    const a = data.profile.allergies;
    const have = (n: string) => isStaple(n, data.profile.staples) || !!findItemFor(data.items, n);
    return {
      lighter: makeVariant(base, 'lighter', a, have),
      classic: makeVariant(base, 'classic', a, have),
      hearty: makeVariant(base, 'hearty', a, have),
    };
  }, [base, data.profile.allergies, data.profile.staples, data.items]);

  const shown = variants?.[style];
  const recipe = shown?.recipe;
  const changes = useMemo(
    () => (recipe ? changesForCooking(data.items, recipe, data.profile.staples) : []),
    [recipe, data.items, data.profile.staples],
  );

  if (!base || !recipe || !variants || !shown) {
    return (
      <View style={{ padding: 16 }}>
        <Muted>Recipe not found.</Muted>
      </View>
    );
  }

  const missing = recipe.ingredients.filter(
    (i) => !i.optional && !isStaple(i.name, data.profile.staples) && !findItemFor(data.items, i.name),
  );

  async function cooked() {
    if (!base || !recipe) return;
    if (base.source === 'ai') await repo.saveRecipe(db, base);
    await repo.applyChanges(db, changes);
    await repo.logCook(db, recipe);
    await data.refresh();
    setStep(recipe.kind === 'assembly' ? 'done' : 'leftovers');
  }

  async function saveLeftovers(n: number) {
    if (!recipe) return;
    await repo.addLeftovers(db, recipe, n);
    await data.refresh();
    setStep('done');
    if (n > 0) setNote(`Saved ${n} serving${n === 1 ? '' : 's'} of leftovers. They'll show up on Tonight.`);
  }

  async function rate(n: number) {
    if (!base || !recipe) return;
    setStars(n);
    if (base.source === 'ai') await repo.saveRecipe(db, base);
    // Rate under the base id, with the chosen style's tags, so the app learns
    // both "you like this dish" and "you like lighter versions".
    await repo.rateRecipe(db, { ...recipe, id: base.id }, n);
    await data.refresh();
  }

  async function addMissing() {
    if (!recipe) return;
    const n = await repo.addToShopping(
      db,
      missing.map((m) => ({ name: m.name, reason: `for ${base?.title}` })),
    );
    setNote(n ? `Added ${n} to your shopping list` : 'Already on your list');
    await data.refresh();
  }

  const servings = recipe.servings ?? 2;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Stack.Screen options={{ title: recipe.kind === 'assembly' ? 'Quick idea' : 'Recipe' }} />
      <H1>{base.title}</H1>
      <Muted>
        {recipe.minutes} min · {servings} serving{servings === 1 ? '' : 's'}
        {recipe.cuisine ? ` · ${recipe.cuisine}` : ''}
        {recipe.kind === 'assembly' ? ' · no recipe needed' : ''}
      </Muted>
      {base.why && <Text style={{ fontStyle: 'italic', color: C.text }}>{base.why}</Text>}
      {base.copycat && (
        <Card style={{ backgroundColor: C.primarySoft, borderColor: C.primarySoft }}>
          <Text style={{ color: C.text }}>
            Homemade take on {base.copycat.restaurant}&apos;s {base.copycat.dish}. About ${base.copycat.savingsPerServing} cheaper per serving.
          </Text>
        </Card>
      )}

      <Card>
        <Row>
          {STYLES.map((st) => (
            <Chip
              key={st.key}
              label={`${st.label} ≈${variants[st.key].kcal}`}
              active={style === st.key}
              onPress={() => setStyle(st.key)}
            />
          ))}
        </Row>
        <Muted>Rough calories per serving, to compare versions.</Muted>
        {shown.changes.map((c) => (
          <Text key={c} style={{ color: C.text, fontSize: 14 }}>
            • {c}
          </Text>
        ))}
      </Card>

      <Card>
        <H2>Ingredients</H2>
        {recipe.ingredients.map((ing) => {
          const staple = isStaple(ing.name, data.profile.staples);
          const have = staple || !!findItemFor(data.items, ing.name);
          return (
            <Row key={ing.name} style={{ justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 15, color: C.text }}>
                {have ? '✓' : '○'} {ing.name}
                {ing.use === 'half' ? ' (half)' : ''}
                {ing.optional ? <Text style={{ color: C.muted }}> optional</Text> : null}
              </Text>
              <Text style={{ fontSize: 13, color: have ? C.primary : C.warn }}>
                {staple ? 'staple' : have ? 'have it' : ing.optional ? '' : 'need'}
              </Text>
            </Row>
          );
        })}
        {missing.length > 0 && (
          <Button label={`Add ${missing.length} missing to shopping list`} kind="secondary" onPress={addMissing} />
        )}
      </Card>

      <Card>
        <H2>{recipe.kind === 'assembly' ? 'How' : 'Steps'}</H2>
        {recipe.steps.map((st, idx) => (
          <Text key={idx} style={{ fontSize: 15, color: C.text, lineHeight: 22 }}>
            {recipe.steps.length > 1 ? `${idx + 1}. ` : ''}
            {st}
          </Text>
        ))}
      </Card>

      {step === 'idle' && <Button label="I made this" onPress={() => setStep('confirm')} />}
      {step === 'confirm' && (
        <Card>
          <H2>Update your food?</H2>
          {changes.length === 0 && <Muted>Nothing to update.</Muted>}
          {changes.map((c) => (
            <Text key={c.id} style={{ color: C.text }}>
              {c.kind === 'remove' ? `• ${c.name}: used up` : `• ${c.name}: ${amountLabel(c.count, c.qtyLevel)} left`}
            </Text>
          ))}
          <Row>
            <View style={{ flex: 1 }}>
              <Button label="Confirm" onPress={cooked} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" kind="secondary" onPress={() => setStep('idle')} />
            </View>
          </Row>
        </Card>
      )}
      {step === 'leftovers' && (
        <Card>
          <H2>Any leftovers?</H2>
          <Muted>We&apos;ll remind you to eat them before they go bad (about 4 days).</Muted>
          <Row>
            <Chip label="None" onPress={() => saveLeftovers(0)} />
            {[1, 2, 3, 4].map((n) => (
              <Chip key={n} label={`${n} serving${n === 1 ? '' : 's'}`} onPress={() => saveLeftovers(n)} />
            ))}
          </Row>
        </Card>
      )}
      {step === 'done' && <Text style={{ color: C.primary, fontWeight: '600' }}>Nice! Your food list is updated. How was it?</Text>}
      {note && <Text style={{ color: C.primary }}>{note}</Text>}

      <Card>
        <H2>Rate it</H2>
        <Row>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => rate(n)} accessibilityLabel={`${n} stars`} hitSlop={6}>
              <Text style={{ fontSize: 32, color: n <= stars ? '#E0A100' : C.border }}>★</Text>
            </Pressable>
          ))}
        </Row>
        <Muted>Ratings shape what gets suggested next.</Muted>
      </Card>

      {step === 'done' && <Button label="Back" kind="secondary" onPress={() => router.back()} />}
    </ScrollView>
  );
}

function amountLabel(count: number, level: 'full' | 'half' | 'little'): string {
  const frac = level === 'half' ? '½' : 'a little';
  if (level === 'full') return String(count);
  return count > 1 ? `${count - 1} + ${frac}` : frac;
}
