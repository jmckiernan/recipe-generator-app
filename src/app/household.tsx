// Household sharing: sign in with an emailed code, then create or join a household.
// Everyone in a household shares My Food, the shopping list, and saved recipes.

import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, Share, Text, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppData } from '../state';
import { getProfile, saveProfile } from '../db/repo';
import { isValidInviteCode } from '../domain/household';
import { Button, C, Card, Chip, H1, H2, Input, Muted, Row } from '../components/ui';

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export default function HouseholdScreen() {
  const { household: hh } = useAppData();

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <H1>Household</H1>
      <Muted>Share one fridge, shopping list, and recipe box with the people you live with. Changes show up on everyone&apos;s phone within seconds.</Muted>
      {!hh.configured ? <NotConfigured /> : !hh.session ? <SignIn /> : !hh.household ? <CreateOrJoin /> : <InHousehold />}
    </ScrollView>
  );
}

function NotConfigured() {
  return (
    <Card>
      <H2>Not set up yet</H2>
      <Muted>
        Household sharing needs a Supabase project. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env.local (see the README),
        then restart the app. Everything else works without it.
      </Muted>
    </Card>
  );
}

function SignIn() {
  const { household: hh } = useAppData();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <Card>
      <H2>Sign in</H2>
      {!sent ? (
        <>
          <Muted>We&apos;ll email you a 6-digit code. No password needed.</Muted>
          <Input
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
          />
          <Button
            label={busy ? 'Sending…' : 'Email me a code'}
            disabled={busy || !emailOk}
            onPress={() =>
              run(async () => {
                await hh.sendCode(email);
                setSent(true);
              })
            }
          />
        </>
      ) : (
        <>
          <Muted>Enter the code we sent to {email.trim()}.</Muted>
          <Input
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={8}
          />
          <Button
            label={busy ? 'Checking…' : 'Sign in'}
            disabled={busy || code.replace(/\D/g, '').length < 6}
            onPress={() => run(() => hh.verifyCode(email, code))}
          />
          <Row>
            <Chip label="Use a different email" onPress={() => setSent(false)} />
            <Chip label="Send again" onPress={() => run(() => hh.sendCode(email))} />
          </Row>
        </>
      )}
      {error && <Text style={{ color: C.danger }}>{error}</Text>}
    </Card>
  );
}

function CreateOrJoin() {
  const db = useSQLiteContext();
  const { household: hh, profile, refresh } = useAppData();
  const [name, setName] = useState(profile.displayName || (hh.email?.split('@')[0] ?? ''));
  const [houseName, setHouseName] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, run } = useAction();

  async function rememberName() {
    const p = await getProfile(db);
    await saveProfile(db, { ...p, displayName: name.trim() });
  }

  return (
    <>
      <Card>
        <H2>Your name</H2>
        <Muted>Shown to the people you share with.</Muted>
        <Input value={name} onChangeText={setName} placeholder="e.g. Jay" maxLength={40} />
      </Card>
      <Card>
        <H2>Join a household</H2>
        <Muted>Ask someone in the household for their 6-character invite code.</Muted>
        <Input value={code} onChangeText={setCode} placeholder="K7Q2MX" autoCapitalize="characters" autoCorrect={false} maxLength={9} />
        <Button
          label={busy ? 'Joining…' : 'Join'}
          disabled={busy || !isValidInviteCode(code) || !name.trim()}
          onPress={() =>
            run(async () => {
              await rememberName();
              await hh.joinHousehold(code, name.trim());
              await refresh();
            })
          }
        />
      </Card>
      <Card>
        <H2>Or start a new one</H2>
        <Input value={houseName} onChangeText={setHouseName} placeholder="e.g. Maple St kitchen" maxLength={60} />
        <Button
          label={busy ? 'Creating…' : 'Create household'}
          kind="secondary"
          disabled={busy || !name.trim()}
          onPress={() =>
            run(async () => {
              await rememberName();
              await hh.createHousehold(houseName.trim() || 'Our kitchen', name.trim());
              await refresh();
            })
          }
        />
        <Muted>The food and list already on this phone will be added to the household.</Muted>
      </Card>
      {error && <Text style={{ color: C.danger }}>{error}</Text>}
      <Chip label={`Sign out (${hh.email ?? ''})`} onPress={() => hh.signOut()} />
    </>
  );
}

function InHousehold() {
  const { household: hh } = useAppData();
  const { busy, error, run } = useAction();
  const h = hh.household!;
  const code = `${h.inviteCode.slice(0, 3)}-${h.inviteCode.slice(3)}`;

  const leave = () => {
    const doIt = () => run(hh.leaveHousehold);
    if (Platform.OS === 'web') return doIt();
    Alert.alert(`Leave ${h.name}?`, 'You keep a copy of the food and list on this phone, but stop seeing updates.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: doIt },
    ]);
  };

  return (
    <>
      <Card>
        <H2>{h.name}</H2>
        <Muted>Invite code</Muted>
        <Text style={{ fontSize: 32, fontWeight: '700', letterSpacing: 4, color: C.text }}>{code}</Text>
        <Button
          label="Share invite"
          onPress={() =>
            Share.share({
              message: `Join our kitchen on FridgeChef! Open the app → Taste → Household → Join, and enter code ${code}.`,
            })
          }
        />
      </Card>

      <Card>
        <H2>Members ({hh.members.length})</H2>
        {hh.members.map((m) => (
          <View key={m.userId} style={{ paddingVertical: 4 }}>
            <Text style={{ fontSize: 16, color: C.text }}>
              {m.displayName || 'Someone'}
              {m.userId === hh.myUserId ? ' (you)' : ''}
            </Text>
            <Muted>{m.allergies.length ? `Allergies: ${m.allergies.join(', ')}` : 'No allergies listed'}</Muted>
          </View>
        ))}
        <Muted>Allergies come from each person&apos;s Taste tab. Choose who you&apos;re cooking for on Tonight.</Muted>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Muted>
            {hh.sync.state === 'syncing'
              ? 'Syncing…'
              : hh.sync.state === 'error'
                ? `Offline. Changes are saved on this phone and will sync later. (${hh.sync.error})`
                : hh.sync.lastSyncedAt
                  ? `Synced at ${hh.sync.lastSyncedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                  : 'Not synced yet'}
          </Muted>
          {hh.sync.state === 'syncing' ? <ActivityIndicator color={C.primary} /> : <Chip label="Sync now" onPress={() => hh.syncNow()} />}
        </Row>
      </Card>

      {error && <Text style={{ color: C.danger }}>{error}</Text>}
      <Row>
        <Chip label={busy ? 'Leaving…' : 'Leave household'} onPress={leave} />
        <Chip label={`Sign out (${hh.email ?? ''})`} onPress={() => hh.signOut()} />
      </Row>
    </>
  );
}
