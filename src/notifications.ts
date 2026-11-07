// The nightly "use it up" nudge (feature #4).
//
// Local notifications are fixed when scheduled, so instead of one repeating
// notification with stale text, we schedule the next 7 days individually,
// each listing what will be inside the user's X-day window on that day.
// We re-run this whenever the inventory or settings change.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import type { InventoryItem, Profile } from './domain/types';
import { expiringItems } from './domain/matcher';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

/** Text for one day's nudge, or null if nothing is in the window. */
export function nudgeText(
  inventory: InventoryItem[],
  warnDays: number,
  on: Date,
): { title: string; body: string } | null {
  const items = expiringItems(inventory, warnDays, on);
  if (!items.length) return null;
  const names = items.slice(0, 4).map((i) => i.name);
  const more = items.length > 4 ? ` and ${items.length - 4} more` : '';
  return {
    title: items.length === 1 ? 'Cook this soon' : `${items.length} things to use up`,
    body: `${names.join(', ')}${more} ${items.length === 1 ? 'is' : 'are'} expiring. Tap for dinner ideas.`,
  };
}

export async function rescheduleNudges(inventory: InventoryItem[], profile: Profile): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('nudges', {
      name: 'Use-it-up reminders',
      importance: AndroidImportance.DEFAULT,
    });
  }

  const now = new Date();
  for (let d = 0; d < 7; d++) {
    const at = new Date(now);
    at.setDate(now.getDate() + d);
    at.setHours(profile.notifyHour, profile.notifyMinute, 0, 0);
    if (at <= now) continue;
    const text = nudgeText(inventory, profile.expiryWarnDays, at);
    if (!text) continue;
    await Notifications.scheduleNotificationAsync({
      content: { ...text, data: { url: '/' } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        channelId: 'nudges',
      },
    });
  }
}
