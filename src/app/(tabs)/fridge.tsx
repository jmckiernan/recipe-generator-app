// "My Food": quick add + inventory grouped by location, soonest-expiring first.

import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppData } from '../../state';
import { parseQuickAdd } from '../../domain/quickAdd';
import { describeAmount, amountAfterUse } from '../../domain/inventory';
import type { InventoryItem, Location } from '../../domain/types';
import * as repo from '../../db/repo';
import { ensurePermission } from '../../notifications';
import { Button, C, Card, Chip, ExpiryBadge, H2, Input, Muted, Row } from '../../components/ui';

const LOCATIONS: Location[] = ['fridge', 'freezer', 'pantry'];
const LOC_LABEL: Record<Location, string> = { fridge: 'Fridge', freezer: 'Freezer', pantry: 'Pantry' };

export default function Fridge() {
  const db = useSQLiteContext();
  const { items, refresh } = useAppData();
  const [text, setText] = useState('');
  const [loc, setLoc] = useState<Location | 'auto'>('auto');
  const [open, setOpen] = useState<number | null>(null);

  async function add() {
    const entries = parseQuickAdd(text);
    if (!entries.length) return;
    for (const e of entries) {
      await repo.addItem(db, { ...e, location: loc === 'auto' ? undefined : loc });
    }
    setText('');
    await refresh();
    // Ask for notification permission the first time food is added, when it makes sense.
    ensurePermission().catch(() => {});
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Card>
        <H2>Add food</H2>
        <Input
          value={text}
          onChangeText={setText}
          placeholder="2 onions, milk, half a bag of spinach"
          returnKeyType="done"
          onSubmitEditing={add}
          multiline={false}
        />
        <Row>
          <Chip label="Auto" active={loc === 'auto'} onPress={() => setLoc('auto')} />
          {LOCATIONS.map((l) => (
            <Chip key={l} label={LOC_LABEL[l]} active={loc === l} onPress={() => setLoc(l)} />
          ))}
        </Row>
        <Button label="Add" onPress={add} disabled={!text.trim()} />
        <Muted>Expiry dates are estimated (~). Tap an item to set the printed date.</Muted>
      </Card>

      {LOCATIONS.map((l) => {
        const group = items.filter((i) => i.location === l);
        if (!group.length) return null;
        return (
          <View key={l} style={{ gap: 8 }}>
            <H2>
              {LOC_LABEL[l]} ({group.length})
            </H2>
            {group.map((i) => (
              <ItemRow key={i.id} item={i} open={open === i.id} onToggle={() => setOpen(open === i.id ? null : i.id)} />
            ))}
          </View>
        );
      })}
      {items.length === 0 && <Muted>Nothing here yet. Add what&apos;s in your fridge above.</Muted>}
    </ScrollView>
  );
}

function ItemRow({ item, open, onToggle }: { item: InventoryItem; open: boolean; onToggle: () => void }) {
  const db = useSQLiteContext();
  const { refresh } = useAppData();
  const [date, setDate] = useState(item.expiresAt);

  async function use(kind: 'half' | 'all') {
    const change = amountAfterUse(item, kind);
    await repo.applyChanges(db, [change]);
    await refresh();
  }
  async function toss() {
    const doIt = async () => {
      await repo.removeItem(db, item, 'tossed');
      await refresh();
    };
    if (Platform.OS === 'web') return doIt();
    Alert.alert(`Toss ${item.name}?`, 'This counts as wasted food in your stats.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Toss', style: 'destructive', onPress: doIt },
    ]);
  }
  async function saveDate() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    await repo.updateItem(db, item.id, { expiresAt: date });
    await refresh();
  }
  async function move(l: Location) {
    if (l === 'freezer') await repo.freezeItem(db, item);
    else await repo.updateItem(db, item.id, { location: l });
    await refresh();
  }

  return (
    <Card>
      <Pressable onPress={onToggle} accessibilityRole="button">
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 16, color: C.text, flexShrink: 1 }}>
            {item.name} <Text style={{ color: C.muted }}>· {describeAmount(item)}</Text>
          </Text>
          <ExpiryBadge expiresAt={item.expiresAt} estimated={item.expiryEstimated} />
        </Row>
      </Pressable>
      {open && (
        <View style={{ gap: 8, marginTop: 6 }}>
          <Row>
            <Chip label="Used half" onPress={() => use('half')} />
            <Chip label="Used it" onPress={() => use('all')} />
            <Chip label="Tossed" onPress={toss} />
          </Row>
          <Row>
            {LOCATIONS.filter((l) => l !== item.location).map((l) => (
              <Chip key={l} label={`Move to ${LOC_LABEL[l].toLowerCase()}`} onPress={() => move(l)} />
            ))}
          </Row>
          <Row>
            <Input value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" style={{ flex: 1 }} />
            <Chip label="Set date" onPress={saveDate} />
          </Row>
        </View>
      )}
    </Card>
  );
}
