// Recipe detail: what you have / need, steps, "I made this" (deducts inventory), star rating.

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { pendingRecipes, useAppData } from '../../state';
import { changesForCooking, findItemFor } from '../../domain/inventory';
import { isStaple } from '../../domain/matcher';
import * as repo from '../../db/repo';
import { Button, C, Card, H1, H2, Muted, Row } from '../../components/ui';

export default function RecipeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const data = useAppData();
  const recipe = data.findRecipe(id) ?? pendingRecipes.get(id);
  const existing = data.ratings.find((r) => r.recipeId === id)?.stars ?? 0;
  const [stars, setStars] = useState(existing);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string>();

  const changes = useMemo(
    () => (recipe ? changesForCooking(data.items, recipe, data.profile.staples) : []),
    [recipe, data.items, data.profile.staples],
  );

  if (!recipe) {
    return (
      <View style={{ padding: 16 }}>
        <Muted>Recipe not found.</Muted>
      </View>
    );
  }

  async function cooked() {
    if (!recipe) return;
    if (recipe.source === 'ai') await repo.saveRecipe(db, recipe);
    await repo.applyChanges(db, changes);
    await repo.logCook(db, recipe);
    await data.refresh();
    setConfirming(false);
    setDone('Nice! Your food list is updated. How was it?');
  }

  async function rate(n: number) {
    if (!recipe) return;
    setStars(n);
    if (recipe.source === 'ai') await repo.saveRecipe(db, recipe);
    await repo.rateRecipe(db, recipe, n);
    await data.refresh();
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Stack.Screen options={{ title: recipe.kind === 'assembly' ? 'Quick idea' : 'Recipe' }} />
      <H1>{recipe.title}</H1>
      <Muted>
        {recipe.minutes} min{recipe.cuisine ? ` · ${recipe.cuisine}` : ''}
        {recipe.kind === 'assembly' ? ' · no recipe needed' : ''}
      </Muted>
      {recipe.why && <Text style={{ fontStyle: 'italic', color: C.text }}>{recipe.why}</Text>}

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

      {!confirming && !done && <Button label="I made this" onPress={() => setConfirming(true)} />}
      {confirming && (
        <Card>
          <H2>Update your food?</H2>
          {changes.length === 0 && <Muted>Nothing to update.</Muted>}
          {changes.map((c) => (
            <Text key={c.id} style={{ color: C.text }}>
              {c.kind === 'remove'
                ? `• ${c.name}: used up`
                : `• ${c.name}: ${c.qtyLevel === 'full' ? c.count : c.count > 1 ? `${c.count - 1} + ${c.qtyLevel === 'half' ? '½' : 'a little'}` : c.qtyLevel === 'half' ? '½' : 'a little'} left`}
            </Text>
          ))}
          <Row>
            <View style={{ flex: 1 }}>
              <Button label="Confirm" onPress={cooked} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" kind="secondary" onPress={() => setConfirming(false)} />
            </View>
          </Row>
        </Card>
      )}
      {done && <Text style={{ color: C.primary, fontWeight: '600' }}>{done}</Text>}

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

      {done && <Button label="Back to Tonight" kind="secondary" onPress={() => router.back()} />}
    </ScrollView>
  );
}
