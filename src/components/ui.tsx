// Small shared UI pieces and the color palette.

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { daysUntil } from '../domain/shelfLife';

export const C = {
  bg: '#F7F5F0',
  card: '#FFFFFF',
  text: '#1F2421',
  muted: '#6B716D',
  border: '#E4E1D8',
  primary: '#2F7D5B',
  primarySoft: '#DDEFE6',
  danger: '#C2410C',
  dangerSoft: '#FDE6D8',
  warn: '#B45309',
  warnSoft: '#FEF3C7',
};

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text style={s.h1}>{children}</Text>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return <Text style={s.h2}>{children}</Text>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={s.muted}>{children}</Text>;
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={[s.chip, active && s.chipActive]}
    >
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  const bg = kind === 'primary' ? C.primary : kind === 'danger' ? C.dangerSoft : C.primarySoft;
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? C.danger : C.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <Text style={[s.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={C.muted} {...props} style={[s.input, props.style]} />;
}

export function ExpiryBadge({ expiresAt, estimated }: { expiresAt: string; estimated?: boolean }) {
  const d = daysUntil(expiresAt);
  const label =
    d < 0 ? 'expired' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : d > 60 ? `${Math.round(d / 30)} mo` : `${d} days`;
  const [bg, fg] = d <= 1 ? [C.dangerSoft, C.danger] : d <= 3 ? [C.warnSoft, C.warn] : [C.primarySoft, C.primary];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: fg }]}>
        {estimated ? '~' : ''}
        {label}
      </Text>
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export const s = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    gap: 6,
  },
  h1: { fontSize: 26, fontWeight: '700', color: C.text },
  h2: { fontSize: 17, fontWeight: '600', color: C.text },
  muted: { fontSize: 14, color: C.muted },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  chipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 14, color: C.text },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '600' },
  input: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: C.text,
  },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '600' },
});
