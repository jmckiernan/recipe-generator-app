// Meal prep / batch cooking planner (feature #13).

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { Link } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppData } from '../state';
import { planMealPrep } from '../domain/mealPrep';
import * as repo from '../db/repo';
import { Button, C, Card, Chip, H1, H2, Muted, Row } from '../components/ui';

export default function MealPrep() {
  const db = useSQLiteContext();
  const { items, allRecipes, planningProfile: profile, ratings, refresh } = useAppData();
  const [dishes, setDishes] = useState(3);
  const [canBuy, setCanBuy] = useState(1);
  const [doubleBatch, setDoubleBatch] = useState(false);
  const [added, setAdded] = useState<string>();

  const plan = useMemo(
    () => planMealPrep(allRecipes, items, profile, ratings, { dishes, canBuy, doubleBatch }),
    [allRecipes, items, profile, ratings, dishes, canBuy, doubleBatch],
  );

  async function addShopping() {
    const n = await repo.addToShopping(
      db,
      plan.shopping.map((name) => ({ name, reason: 'for meal prep' })),
    );
    setAdded(n ? `Added ${n} to your shopping list` : 'Already on your list');
    await refresh();
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <H1>Prep for the week</H1>
      <Muted>Cook a few dishes at once and eat from them all week.</Muted>

      <Card>
        <H2>How many dishes?</H2>
        <Row>
          {[2, 3, 4, 5].map((n) => (
            <Chip key={n} label={`${n}`} active={dishes === n} onPress={() => setDishes(n)} />
          ))}
        </Row>
        <H2>Willing to buy per dish</H2>
        <Row>
          {[0, 1, 2, 3].map((n) => (
            <Chip key={n} label={n === 0 ? 'Nothing' : `Up to ${n}`} active={canBuy === n} onPress={() => setCanBuy(n)} />
          ))}
        </Row>
        <Row>
          <Chip label="Double batches" active={doubleBatch} onPress={() => setDoubleBatch(!doubleBatch)} />
        </Row>
      </Card>

      {plan.picks.length === 0 ? (
        <Muted>Not enough food for a prep plan. Allow buying a few items, or add food first.</Muted>
      ) : (
        <>
          <Card style={{ backgroundColor: C.primarySoft, borderColor: C.primarySoft }}>
            <Text style={{ fontSize: 16, color: C.text, fontWeight: '600' }}>
              About {plan.totalServings} servings from {plan.picks.length} dishes
            </Text>
            {plan.usesExpiring.length > 0 && <Text style={{ color: C.text }}>Uses up: {plan.usesExpiring.join(', ')}</Text>}
          </Card>

          {plan.picks.map((p) => (
            <Link key={p.recipe.id} href={{ pathname: '/recipe/[id]', params: { id: p.recipe.id } }} asChild>
              <Pressable>
                <Card>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 17, fontWeight: '600', color: C.text, flexShrink: 1 }}>
                      {p.recipe.title}
                      {doubleBatch ? ' ×2' : ''}
                    </Text>
                    <Muted>{p.recipe.minutes} min</Muted>
                  </Row>
                  <Muted>
                    {(p.recipe.servings ?? 2) * (doubleBatch ? 2 : 1)} servings
                    {p.missing.length ? ` · need ${p.missing.join(', ')}` : ' · have everything'}
                  </Muted>
                </Card>
              </Pressable>
            </Link>
          ))}

          <Card>
            <H2>Game plan</H2>
            {plan.order.map((t, i) => (
              <Text key={t} style={{ color: C.text, fontSize: 15 }}>
                {i + 1}. {i === 0 ? 'Start' : 'Then'} {t}
              </Text>
            ))}
            <Muted>Longest first, so everything finishes around the same time. Cool before you pack it away.</Muted>
          </Card>

          {plan.shopping.length > 0 && (
            <Card>
              <H2>To buy</H2>
              <Text style={{ color: C.text }}>{plan.shopping.join(', ')}</Text>
              <Button label="Add to shopping list" kind="secondary" onPress={addShopping} />
              {added && <Text style={{ color: C.primary }}>{added}</Text>}
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}
