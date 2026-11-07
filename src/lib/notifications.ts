// Local notification scheduling for daily sabaq reminders.
//
// expo-notifications is loaded lazily and only on native platforms: the web
// build must keep working even though reminders are a mobile-only feature.

import { Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';

type NotificationsModule = typeof ExpoNotifications;

/** True on web, where local notifications are not available. */
export const webUnsupported = Platform.OS === 'web';

export type ReminderPermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unavailable';

const REMINDER_CHANNEL = 'reminders';
const REMINDER_COLOR = '#0E7A5F';

let cachedModule: NotificationsModule | null = null;

function getNotifications(): NotificationsModule {
  if (webUnsupported) {
    throw new Error('Notifications are not available on web');
  }
  if (!cachedModule) {
    // Lazy on purpose: keeps expo-notifications out of the web code path.
    cachedModule = require('expo-notifications') as NotificationsModule;
  }
  return cachedModule;
}

function installForegroundHandler(Notifications: NotificationsModule): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
    name: 'Sabaq reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: REMINDER_COLOR,
    enableVibrate: true,
  });
}

/** Ask for notification permission (no-op returning false on web). */
export async function requestPermission(): Promise<boolean> {
  if (webUnsupported) return false;
  try {
    const Notifications = getNotifications();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return true;
    }
    const requested = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    return requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  } catch (error) {
    console.warn('[notifications] permission request failed', error);
    return false;
  }
}

/** Current permission state, for the Settings status line. */
export async function getPermissionStatus(): Promise<ReminderPermissionStatus> {
  if (webUnsupported) return 'unavailable';
  try {
    const Notifications = getNotifications();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return 'granted';
    }
    const status: string = current.status;
    return status === 'denied' ? 'denied' : 'undetermined';
  } catch (error) {
    console.warn('[notifications] permission check failed', error);
    return 'unavailable';
  }
}

/**
 * Schedule one daily repeating reminder at a local hour/minute.
 * On Android it uses the dedicated "reminders" notification channel; on iOS
 * the daily trigger is mapped to a repeating calendar trigger.
 */
export async function scheduleReminder(
  hour: number,
  minute: number,
  title: string,
  body: string,
  id: string
): Promise<void> {
  if (webUnsupported) return;
  try {
    const Notifications = getNotifications();
    installForegroundHandler(Notifications);
    await ensureAndroidChannel(Notifications);

    const safeHour = Math.min(23, Math.max(0, Math.round(Number.isFinite(hour) ? hour : 0)));
    const safeMinute = Math.min(59, Math.max(0, Math.round(Number.isFinite(minute) ? minute : 0)));

    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title,
        body,
        sound: true,
        color: REMINDER_COLOR,
        data: { kind: 'sabaq-reminder' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: safeHour,
        minute: safeMinute,
        ...(Platform.OS === 'android' ? { channelId: REMINDER_CHANNEL } : {}),
      },
    });
  } catch (error) {
    console.warn('[notifications] failed to schedule reminder', error);
  }
}

/** Remove every scheduled local notification (the app only schedules reminders). */
export async function cancelAllReminders(): Promise<void> {
  if (webUnsupported) return;
  try {
    await getNotifications().cancelAllScheduledNotificationsAsync();
  } catch (error) {
    console.warn('[notifications] failed to cancel reminders', error);
  }
}

/** Number of local notifications currently scheduled on this device. */
export async function listScheduled(): Promise<number> {
  if (webUnsupported) return 0;
  try {
    const scheduled = await getNotifications().getAllScheduledNotificationsAsync();
    return scheduled.length;
  } catch (error) {
    console.warn('[notifications] failed to list reminders', error);
    return 0;
  }
}
