// Shopping list (feature #7): add manually or from recipes and suggestions,
// check items off at the store, then move them into My Food in one tap.

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppData } from '../../state';
import { listSuggestions } from '../../domain/shopping';
import { parseQuickAdd } from '../../domain/quickAdd';
import * as repo from '../../db/repo';
import { Button, C, Card, Chip, H2, Input, Muted, Row } from '../../components/ui';

export default function ShoppingList() {
  const db = useSQLiteContext();
  const { shopping, items, allRecipes, profile, ratings, usedCounts, refresh } = useAppData();
  const [text, setText] = useState('');
  const [toast, setToast] = useState<string>();

  const suggestions = useMemo(
    () => listSuggestions({ inventory: items, recipes: allRecipes, profile, ratings, list: shopping, usedCounts }).slice(0, 6),
    [items, allRecipes, profile, ratings, shopping, usedCounts],
  );
  const unchecked = shopping.filter((s) => !s.checked);
  const checked = shopping.filter((s) => s.checked);

  async function addTyped() {
    const names = parseQuickAdd(text).map((e) => ({ name: e.name }));
    if (!names.length) return;
    await repo.addToShopping(db, names);
    setText('');
    await refresh();
  }

  async function moveToFood() {
    const n = await repo.moveCheckedToInventory(db);
    setToast(`Added ${n} item${n === 1 ? '' : 's'} to My Food`);
    await refresh();
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Card>
        <Row>
          <Input
            value={text}
            onChangeText={setText}
            placeholder="Add items: eggs, tortillas, limes"
            onSubmitEditing={addTyped}
            returnKeyType="done"
            style={{ flex: 1 }}
          />
          <Chip label="Add" onPress={addTyped} />
        </Row>
      </Card>

      {unchecked.length === 0 && checked.length === 0 && (
        <Muted>Your list is empty. Add items above, or from a recipe&apos;s missing ingredients.</Muted>
      )}

      {unchecked.length > 0 && (
        <Card>
          <H2>To buy ({unchecked.length})</H2>
          {unchecked.map((i) => (
            <ListRow key={i.id} id={i.id} name={i.name} reason={i.reason} checked={false} />
          ))}
        </Card>
      )}

      {checked.length > 0 && (
        <Card>
          <H2>In the cart ({checked.length})</H2>
          {checked.map((i) => (
            <ListRow key={i.id} id={i.id} name={i.name} reason={i.reason} checked />
          ))}
          <Button label="Home from the store: add to My Food" onPress={moveToFood} />
        </Card>
      )}
      {toast && <Text style={{ color: C.primary, fontWeight: '600' }}>{toast}</Text>}

      {suggestions.length > 0 && (
        <Card>
          <H2>Suggestions</H2>
          {suggestions.map((sg) => (
            <Row key={sg.name} style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: C.text }}>{sg.name}</Text>
                <Text style={{ fontSize: 13, color: C.muted }}>{sg.reason}</Text>
              </View>
              <Chip
                label="+ Add"
                onPress={async () => {
                  await repo.addToShopping(db, [{ name: sg.name, reason: sg.reason }]);
                  await refresh();
                }}
              />
            </Row>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

function ListRow({ id, name, reason, checked }: { id: number; name: string; reason: string; checked: boolean }) {
  const db = useSQLiteContext();
  const { refresh } = useAppData();
  return (
    <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap', paddingVertical: 4 }}>
      <Pressable
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={name}
        onPress={async () => {
          await repo.setShoppingChecked(db, id, !checked);
          await refresh();
        }}
      >
        <Text style={{ fontSize: 20, color: checked ? C.primary : C.border }}>{checked ? '☑' : '☐'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, color: checked ? C.muted : C.text, textDecorationLine: checked ? 'line-through' : 'none' }}>
            {name}
          </Text>
          {!!reason && <Text style={{ fontSize: 12, color: C.muted }}>{reason}</Text>}
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={`Remove ${name}`}
        hitSlop={8}
        onPress={async () => {
          await repo.removeShopping(db, id);
          await refresh();
        }}
      >
        <Text style={{ color: C.muted, fontSize: 16 }}>✕</Text>
      </Pressable>
    </Row>
  );
}
