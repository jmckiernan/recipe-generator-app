// Scan groceries in: barcode (camera + Open Food Facts) or receipt photo (Claude reads it).

import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppData } from '../state';
import { lookupBarcode, type Product } from '../domain/barcode';
import { categorize, defaultLocation, estimateExpiry, toISODate } from '../domain/shelfLife';
import type { Location } from '../domain/types';
import { aiConfigured, scanReceipt } from '../ai/client';
import * as repo from '../db/repo';
import { Button, C, Card, Chip, H1, H2, Input, Muted, Row } from '../components/ui';

type Mode = 'barcode' | 'receipt';

export default function Scan() {
  const [mode, setMode] = useState<Mode>('barcode');
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <H1>Scan groceries</H1>
      <Row>
        <Chip label="Barcode" active={mode === 'barcode'} onPress={() => setMode('barcode')} />
        <Chip label="Receipt" active={mode === 'receipt'} onPress={() => setMode('receipt')} />
      </Row>
      {mode === 'barcode' ? <BarcodeScan /> : <ReceiptScan />}
    </ScrollView>
  );
}

// ---------- Barcode ----------

function BarcodeScan() {
  const db = useSQLiteContext();
  const { refresh } = useAppData();
  const [permission, requestPermission] = useCameraPermissions();
  const [code, setCode] = useState('');
  const [product, setProduct] = useState<Product | null>();
  const [name, setName] = useState('');
  const [loc, setLoc] = useState<Location>('fridge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [added, setAdded] = useState<string[]>([]);
  const lastScan = useRef<string>('');

  async function lookup(barcode: string) {
    if (busy || !barcode) return;
    setBusy(true);
    setError(undefined);
    try {
      const p = await lookupBarcode(barcode);
      setProduct(p);
      if (p) {
        setName(p.name);
        setLoc(defaultLocation(p.category));
      } else {
        setName('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const n = name.trim().toLowerCase();
    if (!n) return;
    await repo.addItem(db, { name: n, category: product?.category ?? categorize(n), location: loc });
    await refresh();
    setAdded((a) => [n, ...a]);
    setProduct(undefined);
    setName('');
    setCode('');
    lastScan.current = '';
  }

  const canUseCamera = Platform.OS !== 'web';

  return (
    <>
      {canUseCamera && !permission?.granted && (
        <Card>
          <Muted>FridgeChef needs the camera to scan barcodes.</Muted>
          <Button label="Allow camera" onPress={requestPermission} />
        </Card>
      )}
      {canUseCamera && permission?.granted && product === undefined && (
        <View style={{ height: 260, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
            onBarcodeScanned={({ data }) => {
              if (data === lastScan.current) return;
              lastScan.current = data;
              setCode(data);
              lookup(data);
            }}
          />
        </View>
      )}
      <Card>
        <Muted>{canUseCamera ? 'Point at the barcode, or type the number:' : 'Type the barcode number:'}</Muted>
        <Row>
          <Input value={code} onChangeText={setCode} placeholder="e.g. 0041190468836" keyboardType="number-pad" style={{ flex: 1 }} />
          <Chip label="Look up" onPress={() => lookup(code.trim())} />
        </Row>
        {busy && <ActivityIndicator color={C.primary} />}
        {error && <Text style={{ color: C.danger }}>{error}</Text>}
      </Card>

      {product === null && (
        <Card>
          <H2>Not in the database</H2>
          <Muted>Type what it is and we&apos;ll add it.</Muted>
          <Input value={name} onChangeText={setName} placeholder="e.g. greek yogurt" />
          <Button label="Add to My Food" onPress={add} disabled={!name.trim()} />
        </Card>
      )}
      {product && (
        <Card>
          <H2>{product.displayName}</H2>
          {product.brand && <Muted>{product.brand}</Muted>}
          {product.per100g?.kcal !== undefined && (
            <Muted>
              Per 100 g: {product.per100g.kcal} kcal · {product.per100g.protein ?? '?'} g protein · {product.per100g.carbs ?? '?'} g carbs ·{' '}
              {product.per100g.fat ?? '?'} g fat
            </Muted>
          )}
          <Muted>Save it as (short names match recipes best):</Muted>
          <Input value={name} onChangeText={setName} />
          <Row>
            {(['fridge', 'freezer', 'pantry'] as Location[]).map((l) => (
              <Chip key={l} label={l} active={loc === l} onPress={() => setLoc(l)} />
            ))}
          </Row>
          <Muted>
            Estimated to keep until ~{estimateExpiry(product.category, loc, toISODate(new Date()))}
          </Muted>
          <Row>
            <View style={{ flex: 1 }}>
              <Button label="Add to My Food" onPress={add} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Scan another"
                kind="secondary"
                onPress={() => {
                  setProduct(undefined);
                  lastScan.current = '';
                }}
              />
            </View>
          </Row>
        </Card>
      )}
      {added.length > 0 && <Text style={{ color: C.primary }}>Added: {added.join(', ')}</Text>}
      <Muted>Product data from Open Food Facts, a free, community-built food database.</Muted>
    </>
  );
}

// ---------- Receipt ----------

function ReceiptScan() {
  const db = useSQLiteContext();
  const { refresh } = useAppData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [store, setStore] = useState('');
  const [items, setItems] = useState<{ name: string; count: number; keep: boolean }[]>([]);

  async function pick(fromCamera: boolean) {
    setError(undefined);
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], base64: true, quality: 0.6 };
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setError('Camera permission is needed to photograph a receipt.');
    }
    const res = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const asset = res.canceled ? undefined : res.assets[0];
    if (!asset?.base64) return;
    const mediaType = asset.mimeType === 'image/png' ? 'image/png' : asset.mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg';
    setBusy(true);
    try {
      const r = await scanReceipt(asset.base64, mediaType);
      setStore(r.store);
      setItems(r.items.map((i) => ({ ...i, keep: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addAll() {
    const keep = items.filter((i) => i.keep);
    for (const i of keep) await repo.addItem(db, { name: i.name, count: i.count });
    await refresh();
    router.replace('/fridge');
  }

  if (!aiConfigured()) {
    return (
      <Card>
        <H2>Receipt scanning needs the AI server</H2>
        <Muted>Set EXPO_PUBLIC_AI_URL (see the README). Barcode scanning works without it.</Muted>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <Muted>Lay the receipt flat in good light. Long receipts: photograph the food section.</Muted>
        <Row>
          <View style={{ flex: 1 }}>
            <Button label="Take photo" onPress={() => pick(true)} disabled={busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="From photos" kind="secondary" onPress={() => pick(false)} disabled={busy} />
          </View>
        </Row>
        {busy && (
          <Row>
            <ActivityIndicator color={C.primary} />
            <Muted>Reading your receipt…</Muted>
          </Row>
        )}
        {error && <Text style={{ color: C.danger }}>{error}</Text>}
      </Card>
      {items.length > 0 && (
        <Card>
          <H2>{store ? `From ${store}` : 'Found on your receipt'}</H2>
          <Muted>Untick anything that isn&apos;t food you&apos;re keeping.</Muted>
          {items.map((i, idx) => (
            <Pressable
              key={`${i.name}-${idx}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: i.keep }}
              onPress={() => setItems(items.map((x, j) => (j === idx ? { ...x, keep: !x.keep } : x)))}
              style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 3 }}
            >
              <Text style={{ fontSize: 20, color: i.keep ? C.primary : C.border }}>{i.keep ? '☑' : '☐'}</Text>
              <Text style={{ fontSize: 16, color: C.text }}>
                {i.name}
                {i.count > 1 ? ` ×${i.count}` : ''}
              </Text>
            </Pressable>
          ))}
          <Button label={`Add ${items.filter((i) => i.keep).length} to My Food`} onPress={addAll} />
        </Card>
      )}
    </>
  );
}
