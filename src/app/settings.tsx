import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import {
  cancelAllReminders,
  getPermissionStatus,
  listScheduled,
  requestPermission,
  scheduleReminder,
  webUnsupported,
  type ReminderPermissionStatus,
} from '@/lib/notifications';
import {
  CITY_PRESETS,
  anchorToOffset,
  getCityCoordinates,
  getCityPreset,
  getPrayerTimes,
  slotTimeForAnchor,
  type PrayerTimeSet,
} from '@/lib/prayer-times';
import { PLAYBACK_RATES, RECITERS, REPEAT_OPTIONS } from '@/lib/reciters';
import { LANGUAGES, useT } from '@/lib/i18n';
import { applyRTL } from '@/lib/rtl';
import { useSettings, type ReminderAnchor, type ReminderSlot } from '@/store/settings';

const ANCHOR_OPTIONS: { value: ReminderAnchor; label: string }[] = [
  { value: 'fajr', label: 'Fajr' },
  { value: 'asr', label: 'Asr' },
  { value: 'maghrib', label: 'Maghrib' },
  { value: 'isha', label: 'Isha' },
  { value: 'fixed', label: 'Fixed' },
];

const REMINDER_IDS = ['muhafiz-sabaq-reminder-1', 'muhafiz-sabaq-reminder-2'] as const;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatClock(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function anchorLabel(anchor: ReminderAnchor): string {
  return ANCHOR_OPTIONS.find((option) => option.value === anchor)?.label ?? 'Fixed';
}

/** Quiet hours are 22:00 - 06:00 local time. */
function isQuietHour(hour: number): boolean {
  return hour >= 22 || hour < 6;
}

function parseCoordinate(text: string, min: number, max: number): number | null {
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const router = useRouter();
  const settings = useSettings();
  const t = useT();

  // Selected-chip colors that stay readable in both themes.
  const chipBg = isDark ? Brand.emeraldDark : Brand.emeraldSoft;
  const chipText = isDark ? '#ffffff' : Brand.emeraldDark;

  const handleLanguage = (language: 'en' | 'sv' | 'ar') => {
    settings.setLanguage(language);
    applyRTL(language);
  };

  const [permission, setPermission] = useState<ReminderPermissionStatus | 'unknown' | 'unsupported'>('unknown');
  const [scheduledCount, setScheduledCount] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(() => useSettings.persist.hasHydrated());
  const [locationEdited, setLocationEdited] = useState(false);
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');

  const selectedCity = getCityPreset(settings.anchorCity);
  const coordinates = getCityCoordinates(settings.anchorCity, settings.customLat, settings.customLng);
  const locationLabel = settings.anchorCity === 'custom' ? 'your coordinates' : selectedCity.name;

  // Never schedule (or cancel) against default values before AsyncStorage
  // hydration has merged the user's real reminder settings.
  useEffect(() => {
    if (useSettings.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsubscribe = useSettings.persist.onFinishHydration(() => setHydrated(true));
    // Hydration may have finished between the check and the subscription.
    if (useSettings.persist.hasHydrated()) setHydrated(true);
    return unsubscribe;
  }, []);

  // Show persisted custom coordinates once the async store hydration lands.
  useEffect(() => {
    if (locationEdited) return;
    setLatText(settings.customLat == null ? '' : String(settings.customLat));
    setLngText(settings.customLng == null ? '' : String(settings.customLng));
  }, [settings.customLat, settings.customLng, locationEdited]);

  // Permission status for the status line. Web returns 'unavailable' without
  // touching expo-notifications.
  useEffect(() => {
    if (webUnsupported) return;
    let active = true;
    getPermissionStatus().then((status) => {
      if (active) setPermission(status);
    });
    return () => {
      active = false;
    };
  }, []);

  // Recalculate prayer-anchored slots whenever the location or an anchor
  // changes (and on open). Fixed slots keep their user-picked time.
  useEffect(() => {
    const location = getCityCoordinates(settings.anchorCity, settings.customLat, settings.customLng);
    if (!location) return;

    let times: PrayerTimeSet;
    try {
      times = getPrayerTimes(location.lat, location.lng, getCityPreset(settings.anchorCity).calcMethod);
    } catch {
      return;
    }

    const recompute = (slot: ReminderSlot): ReminderSlot | null => {
      const computed = slotTimeForAnchor(slot.anchor, times);
      if (!computed) return null;
      if (computed.hour === slot.hour && computed.minute === slot.minute) return null;
      return { ...slot, hour: computed.hour, minute: computed.minute };
    };

    const nextSlot1 = recompute(settings.reminderSlot1);
    if (nextSlot1) settings.setReminderSlot1(nextSlot1);
    const nextSlot2 = recompute(settings.reminderSlot2);
    if (nextSlot2) settings.setReminderSlot2(nextSlot2);
  }, [
    settings.anchorCity,
    settings.customLat,
    settings.customLng,
    settings.reminderSlot1.anchor,
    settings.reminderSlot2.anchor,
  ]);

  // Reschedule both slots (debounced 500 ms) whenever reminder settings
  // change. The two slots are the daily cap. Scheduling is native-only.
  useEffect(() => {
    if (webUnsupported || !hydrated) return;

    let cancelled = false;

    if (!settings.remindersEnabled) {
      setScheduledCount(0);
      void cancelAllReminders();
      return () => {
        cancelled = true;
      };
    }

    const timeout = setTimeout(() => {
      void (async () => {
        await cancelAllReminders();
        if (cancelled) return;

        const location = getCityCoordinates(settings.anchorCity, settings.customLat, settings.customLng);
        let times: PrayerTimeSet | null = null;
        if (location) {
          try {
            times = getPrayerTimes(location.lat, location.lng, getCityPreset(settings.anchorCity).calcMethod);
          } catch {
            times = null;
          }
        }

        const slots: { slot: ReminderSlot; id: string; number: number }[] = [
          { slot: settings.reminderSlot1, id: REMINDER_IDS[0], number: 1 },
          { slot: settings.reminderSlot2, id: REMINDER_IDS[1], number: 2 },
        ];

        for (const { slot, id, number } of slots) {
          if (!slot.enabled) continue;

          // Prayer-anchored slots use today's prayer times at schedule time.
          const anchored = slot.anchor !== 'fixed' && times ? slotTimeForAnchor(slot.anchor, times) : null;
          const hour = anchored ? anchored.hour : slot.hour;
          const minute = anchored ? anchored.minute : slot.minute;

          if (settings.quietHoursEnabled && isQuietHour(hour)) continue;

          await scheduleReminder(
            hour,
            minute,
            number === 1 ? 'Muhafiz — time for your sabaq' : 'Muhafiz — time for your muraja’ah',
            'A few minutes with the Qur’an today keeps your hifz strong. Open Muhafiz and review today’s ayahs.',
            id
          );
          if (cancelled) return;
        }

        const count = await listScheduled();
        if (!cancelled) setScheduledCount(count);
      })();
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [
    settings.remindersEnabled,
    settings.reminderSlot1,
    settings.reminderSlot2,
    settings.quietHoursEnabled,
    settings.anchorCity,
    settings.customLat,
    settings.customLng,
    permission,
    hydrated,
  ]);

  const updateSlot = (which: 1 | 2, patch: Partial<ReminderSlot>) => {
    const current = which === 1 ? settings.reminderSlot1 : settings.reminderSlot2;
    const next = { ...current, ...patch };
    if (which === 1) settings.setReminderSlot1(next);
    else settings.setReminderSlot2(next);
  };

  const handleToggleReminders = async (enabled: boolean) => {
    if (!enabled) {
      settings.setRemindersEnabled(false);
      return;
    }
    // Permission first: the switch only turns on when notifications are
    // actually possible, so it never silently schedules nothing.
    if (webUnsupported) {
      settings.setRemindersEnabled(false);
      setPermission('unsupported');
      return;
    }
    if (permission !== 'granted') {
      const granted = await requestPermission();
      setPermission(granted ? 'granted' : 'denied');
      if (!granted) {
        settings.setRemindersEnabled(false);
        return;
      }
    }
    settings.setRemindersEnabled(true);
  };

  const handleRequestPermission = async () => {
    const granted = await requestPermission();
    setPermission(granted ? 'granted' : 'denied');
  };

  const handleCitySelect = (cityId: string) => {
    settings.setAnchorCity(cityId);
    if (cityId === 'custom') {
      setLatText(settings.customLat == null ? '' : String(settings.customLat));
      setLngText(settings.customLng == null ? '' : String(settings.customLng));
      setLocationEdited(false);
    }
  };

  const applyCustomLocation = (latValue: string, lngValue: string) => {
    const lat = parseCoordinate(latValue, -90, 90);
    const lng = parseCoordinate(lngValue, -180, 180);
    if (lat != null && lng != null) settings.setCustomLocation(lat, lng);
    else settings.setCustomLocation(null, null);
  };

  const handleLatChange = (text: string) => {
    setLatText(text);
    setLocationEdited(true);
    applyCustomLocation(text, lngText);
  };

  const handleLngChange = (text: string) => {
    setLngText(text);
    setLocationEdited(true);
    applyCustomLocation(latText, text);
  };

  const permissionText =
    permission === 'granted'
      ? 'Notifications are allowed on this device.'
      : permission === 'denied'
        ? 'Blocked in system settings. Enable notifications for Muhafiz to receive reminders.'
        : permission === 'unavailable'
          ? 'Not available on this platform.'
          : permission === 'undetermined'
            ? 'Not requested yet. Tap Allow to enable daily reminders.'
            : 'Checking permission...';

  const renderReminderSlot = (which: 1 | 2, slot: ReminderSlot) => {
    const shiftTime = (deltaMinutes: number) => {
      const total = (((slot.hour * 60 + slot.minute + deltaMinutes) % 1440) + 1440) % 1440;
      updateSlot(which, { anchor: 'fixed', hour: Math.floor(total / 60), minute: total % 60 });
    };

    return (
      <View key={which} style={[styles.slotCard, { backgroundColor: theme.backgroundElement }]}>
        <View style={styles.slotHeader}>
          <View style={styles.rowText}>
            <ThemedText style={styles.rowName}>Reminder {which}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {slot.anchor === 'fixed'
                ? `Fixed at ${formatClock(slot.hour, slot.minute)}`
                : `${anchorLabel(slot.anchor)} + ${anchorToOffset(slot.anchor)} min · ${formatClock(
                    slot.hour,
                    slot.minute
                  )}`}
            </ThemedText>
          </View>
          <Switch
            value={slot.enabled}
            onValueChange={(value) => updateSlot(which, { enabled: value })}
            trackColor={{ true: Brand.emerald }}
            ios_backgroundColor={theme.backgroundSelected}
            accessibilityLabel={`Enable reminder ${which}`}
            testID={`slot${which}-enable`}
          />
        </View>

        <ThemedText style={styles.subLabel} themeColor="textSecondary">
          ANCHOR
        </ThemedText>
        <View style={styles.chipWrap}>
          {ANCHOR_OPTIONS.map(({ value, label }) => {
            const active = slot.anchor === value;
            return (
              <Pressable
                key={value}
                onPress={() => updateSlot(which, { anchor: value })}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Anchor reminder ${which} to ${label}`}
                testID={`slot${which}-anchor-${value}`}
                style={[
                  styles.anchorChip,
                  {
                    borderColor: active ? Brand.emerald : theme.backgroundSelected,
                    backgroundColor: active ? chipBg : 'transparent',
                  },
                ]}>
                <ThemedText type="small" style={[styles.chipText, active && { color: chipText }]}>
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.stepperRow}>
          <View style={styles.stepperGroup}>
            <Pressable
              onPress={() => shiftTime(-60)}
              accessibilityRole="button"
              accessibilityLabel={`Decrease hour for reminder ${which}`}
              testID={`slot${which}-hour-down`}
              style={[styles.stepButton, { borderColor: theme.backgroundSelected }]}>
              <Ionicons name="remove" size={16} color={theme.text} />
            </Pressable>
            <ThemedText style={styles.stepValue}>{pad2(slot.hour)}</ThemedText>
            <Pressable
              onPress={() => shiftTime(60)}
              accessibilityRole="button"
              accessibilityLabel={`Increase hour for reminder ${which}`}
              testID={`slot${which}-hour-up`}
              style={[styles.stepButton, { borderColor: theme.backgroundSelected }]}>
              <Ionicons name="add" size={16} color={theme.text} />
            </Pressable>
            <ThemedText type="small" themeColor="textSecondary">
              hr
            </ThemedText>
          </View>
          <View style={styles.stepperGroup}>
            <Pressable
              onPress={() => shiftTime(-5)}
              accessibilityRole="button"
              accessibilityLabel={`Decrease minutes for reminder ${which}`}
              testID={`slot${which}-minute-down`}
              style={[styles.stepButton, { borderColor: theme.backgroundSelected }]}>
              <Ionicons name="remove" size={16} color={theme.text} />
            </Pressable>
            <ThemedText style={styles.stepValue}>{pad2(slot.minute)}</ThemedText>
            <Pressable
              onPress={() => shiftTime(5)}
              accessibilityRole="button"
              accessibilityLabel={`Increase minutes for reminder ${which}`}
              testID={`slot${which}-minute-up`}
              style={[styles.stepButton, { borderColor: theme.backgroundSelected }]}>
              <Ionicons name="add" size={16} color={theme.text} />
            </Pressable>
            <ThemedText type="small" themeColor="textSecondary">
              min
            </ThemedText>
          </View>
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.slotNote}>
          {slot.anchor === 'fixed'
            ? 'Fires at this fixed local time every day.'
            : coordinates
              ? `Prayer-anchored times are recalculated from ${locationLabel} when Settings opens. Adjusting the time switches this slot to Fixed.`
              : 'Choose a city or enter coordinates to anchor this slot. Until then it uses the fallback time above.'}
        </ThemedText>
      </View>
    );
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.iconBtn, { borderColor: theme.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel="Back">
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </Pressable>
          <ThemedText style={styles.title}>{t('settings.title')}</ThemedText>
          <View style={styles.headerRight} />
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {/* GENERAL — language + theme */}
          <View style={[styles.groupCard, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
              {t('settings.general')}
            </ThemedText>
            <ThemedText style={styles.groupLabel} themeColor="textSecondary">
              {t('settings.language')}
            </ThemedText>
            <View style={styles.optionRow}>
              {LANGUAGES.map((language) => (
                <Pressable
                  key={language.id}
                  onPress={() => handleLanguage(language.id)}
                  style={[
                    styles.option,
                    {
                      borderColor: settings.language === language.id ? Brand.emerald : theme.backgroundSelected,
                      backgroundColor: settings.language === language.id ? chipBg : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: settings.language === language.id }}
                  testID={`settings-language-${language.id}`}>
                  <ThemedText
                    style={[styles.optionText, settings.language === language.id && { color: chipText }]}>
                    {language.nativeLabel}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <ThemedText style={styles.rtlHint} themeColor="textSecondary">
              {t('settings.rtlHint')}
            </ThemedText>
            <ThemedText style={styles.groupLabel} themeColor="textSecondary">
              {t('settings.theme')}
            </ThemedText>
            <View style={styles.optionRow}>
              {(
                [
                  ['system', t('settings.themeSystem')],
                  ['light', t('settings.themeLight')],
                  ['dark', t('settings.themeDark')],
                ] as ['system' | 'light' | 'dark', string][]
              ).map(([themeId, label]) => (
                <Pressable
                  key={themeId}
                  onPress={() => settings.setTheme(themeId)}
                  style={[
                    styles.option,
                    {
                      borderColor: settings.theme === themeId ? Brand.emerald : theme.backgroundSelected,
                      backgroundColor: settings.theme === themeId ? chipBg : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: settings.theme === themeId }}
                  testID={`settings-theme-${themeId}`}>
                  <ThemedText
                    style={[styles.optionText, settings.theme === themeId && { color: chipText }]}>
                    {label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          {/* MUSHAF DISPLAY — layout + color presets */}
          <View style={[styles.groupCard, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
              {t('settings.mushafDisplay')}
            </ThemedText>
            <ThemedText style={styles.groupLabel} themeColor="textSecondary">
              {t('settings.layout')}
            </ThemedText>
            <View style={styles.optionRow}>
              {(
                [
                  ['lines', t('mushaf.layoutLines')],
                  ['flow', t('mushaf.layoutFlow')],
                ] as ['lines' | 'flow', string][]
              ).map(([layoutId, label]) => (
                <Pressable
                  key={layoutId}
                  onPress={() => settings.setMushafLayout(layoutId)}
                  style={[
                    styles.option,
                    {
                      borderColor: settings.mushafLayout === layoutId ? Brand.emerald : theme.backgroundSelected,
                      backgroundColor: settings.mushafLayout === layoutId ? chipBg : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: settings.mushafLayout === layoutId }}
                  testID={`settings-layout-${layoutId}`}>
                  <ThemedText
                    style={[styles.optionText, settings.mushafLayout === layoutId && { color: chipText }]}>
                    {label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <ThemedText style={styles.groupLabel} themeColor="textSecondary">
              {t('settings.textColor')}
            </ThemedText>
            <View style={styles.optionRow}>
              {(
                [
                  ['classic', t('mushaf.colorClassic')],
                  ['green', t('mushaf.colorGreen')],
                  ['gold', t('mushaf.colorGold')],
                  ['teal', t('mushaf.colorTeal')],
                ] as ['classic' | 'green' | 'gold' | 'teal', string][]
              ).map(([colorId, label]) => (
                <Pressable
                  key={colorId}
                  onPress={() => settings.setMushafTextColor(colorId)}
                  style={[
                    styles.option,
                    {
                      borderColor: settings.mushafTextColor === colorId ? Brand.emerald : theme.backgroundSelected,
                      backgroundColor: settings.mushafTextColor === colorId ? chipBg : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: settings.mushafTextColor === colorId }}
                  testID={`settings-color-${colorId}`}>
                  <ThemedText
                    style={[styles.optionText, settings.mushafTextColor === colorId && { color: chipText }]}>
                    {label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <View style={styles.switchRow}>
              <ThemedText style={styles.rowName}>{t('mushaf.parchment')}</ThemedText>
              <Switch
                value={settings.mushafParchment}
                onValueChange={settings.setMushafParchment}
                trackColor={{ true: Brand.emerald }}
                testID="settings-parchment"
              />
            </View>
          </View>

          {/* RECITER & AUDIO */}
          <View style={[styles.groupCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
            {t('settings.reciter')}
          </ThemedText>
          {RECITERS.map((r) => {
            const selected = r.id === settings.reciterId;
            return (
              <Pressable
                key={r.id}
                onPress={() => settings.setReciter(r.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Select reciter ${r.name}`}
                style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.rowText}>
                  <ThemedText style={styles.rowName}>{r.name}</ThemedText>
                  {r.note ? (
                    <ThemedText style={styles.rowNote} themeColor="textSecondary">
                      {r.note}
                    </ThemedText>
                  ) : null}
                </View>
                {selected && <Ionicons name="checkmark-circle" size={22} color={Brand.emerald} />}
              </Pressable>
            );
          })}

          <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
            PLAYBACK SPEED
          </ThemedText>
          <View style={styles.optionRow}>
            {PLAYBACK_RATES.map((rate) => (
              <Pressable
                key={rate}
                onPress={() => settings.setPlaybackRate(rate)}
                accessibilityRole="button"
                accessibilityState={{ selected: rate === settings.playbackRate }}
                accessibilityLabel={`Playback speed ${rate} times`}
                style={[
                  styles.option,
                  {
                    borderColor: rate === settings.playbackRate ? Brand.emerald : theme.backgroundSelected,
                    backgroundColor: rate === settings.playbackRate ? chipBg : 'transparent',
                  },
                ]}>
                <ThemedText style={[styles.optionText, rate === settings.playbackRate && { color: chipText }]}>
                  {rate}×
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
            REPEAT EACH AYAH
          </ThemedText>
          <View style={styles.optionRow}>
            {REPEAT_OPTIONS.map((n) => (
              <Pressable
                key={n}
                onPress={() => settings.setRepeatAyah(n)}
                accessibilityRole="button"
                accessibilityState={{ selected: n === settings.repeatAyah }}
                accessibilityLabel={`Repeat each ayah ${n} times`}
                style={[
                  styles.option,
                  {
                    borderColor: n === settings.repeatAyah ? Brand.emerald : theme.backgroundSelected,
                    backgroundColor: n === settings.repeatAyah ? chipBg : 'transparent',
                  },
                ]}>
                <ThemedText style={[styles.optionText, n === settings.repeatAyah && { color: chipText }]}>
                  ×{n}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
            MUSHAF TEXT SIZE
          </ThemedText>
          <View style={styles.optionRow}>
            {[0.85, 1, 1.15].map((scale) => (
              <Pressable
                key={scale}
                onPress={() => settings.setFontScale(scale)}
                accessibilityRole="button"
                accessibilityState={{ selected: scale === settings.fontScale }}
                accessibilityLabel={
                  scale === 0.85 ? 'Smaller mushaf text' : scale === 1.15 ? 'Larger mushaf text' : 'Default mushaf text'
                }
                style={[
                  styles.option,
                  {
                    borderColor: scale === settings.fontScale ? Brand.emerald : theme.backgroundSelected,
                    backgroundColor: scale === settings.fontScale ? chipBg : 'transparent',
                  },
                ]}>
                <ThemedText style={[styles.optionText, scale === settings.fontScale && { color: chipText }]}>
                  {scale === 0.85 ? 'A−' : scale === 1.15 ? 'A+' : 'A'}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
            LISTENING
          </ThemedText>
          <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.rowText}>
              <ThemedText style={styles.rowName}>Auto-advance to next ayah</ThemedText>
              <ThemedText style={styles.rowNote} themeColor="textSecondary">
                Continue playing through the surah
              </ThemedText>
            </View>
            <Switch
              value={settings.autoAdvance}
              onValueChange={settings.setAutoAdvance}
              trackColor={{ true: Brand.emerald }}
              ios_backgroundColor={theme.backgroundSelected}
              accessibilityLabel="Auto-advance to the next ayah"
            />
          </View>
          </View>

          {/* REMINDERS */}
          <View style={[styles.groupCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
            REMINDERS
          </ThemedText>

          <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.rowText}>
              <ThemedText style={styles.rowName}>Daily sabaq reminders</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Up to 2 reminders per day — one per slot below.
              </ThemedText>
            </View>
            <Switch
              value={settings.remindersEnabled}
              onValueChange={handleToggleReminders}
              trackColor={{ true: Brand.emerald }}
              ios_backgroundColor={theme.backgroundSelected}
              accessibilityLabel="Enable daily reminders"
              testID="remind-enable"
            />
          </View>

          {webUnsupported ? (
            <View style={[styles.noteBox, { backgroundColor: theme.backgroundElement }]}>
              <Ionicons name="information-circle-outline" size={18} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.noteText}>
                {'Reminders work in the mobile app (Expo Go) — on desktop the Today screen shows your due queue.'}
              </ThemedText>
            </View>
          ) : (
            <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.rowText}>
                <ThemedText style={styles.rowName}>Notification permission</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {permissionText}
                </ThemedText>
              </View>
              <Pressable
                onPress={handleRequestPermission}
                accessibilityRole="button"
                accessibilityLabel="Request notification permission"
                testID="remind-permission"
                style={[styles.permissionButton, { borderColor: Brand.emerald }]}>
                <Ionicons
                  name={permission === 'granted' ? 'checkmark-circle' : 'notifications-outline'}
                  size={16}
                  color={Brand.emerald}
                />
                <ThemedText type="smallBold" style={{ color: isDark ? '#ffffff' : Brand.emeraldDark }}>
                  {permission === 'granted' ? 'Allowed' : 'Allow'}
                </ThemedText>
              </Pressable>
            </View>
          )}

          <ThemedText style={styles.subLabel} themeColor="textSecondary">
            PRAYER ANCHOR CITY
          </ThemedText>
          <View style={styles.chipWrap}>
            {CITY_PRESETS.map((city) => {
              const active = city.id === settings.anchorCity;
              return (
                <Pressable
                  key={city.id}
                  onPress={() => handleCitySelect(city.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Use ${city.name} for prayer times`}
                  testID={`city-${city.id}`}
                  style={[
                    styles.cityChip,
                    {
                      borderColor: active ? Brand.emerald : theme.backgroundSelected,
                      backgroundColor: active ? chipBg : 'transparent',
                    },
                  ]}>
                  <ThemedText type="small" style={[styles.chipText, active && { color: chipText }]}>
                    {city.name}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {settings.anchorCity === 'custom' ? (
            <>
              <View style={styles.coordRow}>
                <View style={styles.coordField}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Latitude
                  </ThemedText>
                  <TextInput
                    value={latText}
                    onChangeText={handleLatChange}
                    placeholder="e.g. 51.5074"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Custom latitude"
                    testID="custom-lat"
                    style={[
                      styles.coordInput,
                      { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
                    ]}
                  />
                </View>
                <View style={styles.coordField}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Longitude
                  </ThemedText>
                  <TextInput
                    value={lngText}
                    onChangeText={handleLngChange}
                    placeholder="e.g. -0.1278"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="numbers-and-punctuation"
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Custom longitude"
                    testID="custom-lng"
                    style={[
                      styles.coordInput,
                      { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
                    ]}
                  />
                </View>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {coordinates
                  ? `Using ${coordinates.lat.toFixed(3)}, ${coordinates.lng.toFixed(3)}.`
                  : 'Enter a latitude (-90 to 90) and longitude (-180 to 180) to anchor to local prayer times.'}
              </ThemedText>
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {`Using ${selectedCity.name}${
                coordinates ? ` (${coordinates.lat.toFixed(3)}, ${coordinates.lng.toFixed(3)})` : ''
              }. Prayer-anchored times are recalculated when Settings opens.`}
            </ThemedText>
          )}

          {renderReminderSlot(1, settings.reminderSlot1)}
          {renderReminderSlot(2, settings.reminderSlot2)}

          <View style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.rowText}>
              <ThemedText style={styles.rowName}>Quiet hours</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                When on, reminders that fall between 22:00 and 06:00 are skipped. You can still open the app any
                time.
              </ThemedText>
            </View>
            <Switch
              value={settings.quietHoursEnabled}
              onValueChange={settings.setQuietHoursEnabled}
              trackColor={{ true: Brand.emerald }}
              ios_backgroundColor={theme.backgroundSelected}
              accessibilityLabel="Skip reminders during quiet hours"
              testID="quiet-hours-enable"
            />
          </View>

          {!webUnsupported && scheduledCount != null ? (
            <ThemedText type="small" themeColor="textSecondary">
              {scheduledCount === 0
                ? 'No reminders scheduled. Allow notifications and enable at least one slot.'
                : `${scheduledCount} reminder${scheduledCount === 1 ? '' : 's'} scheduled on this device.`}
            </ThemedText>
          ) : null}
          </View>

          {/* ABOUT */}
          <View style={[styles.groupCard, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText style={styles.sectionTitle} themeColor="textSecondary">
            {t('settings.about')}
          </ThemedText>
          <ThemedText style={styles.credits} themeColor="textSecondary">
            {t('settings.credits')}
          </ThemedText>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  iconBtn: { padding: Spacing.two, borderRadius: 999, borderWidth: 1 },
  title: { fontSize: 20, fontWeight: 700, flex: 1, textAlign: 'center' },
  headerRight: { width: 38 },
  body: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  sectionTitle: { fontSize: 12, fontWeight: 700, letterSpacing: 1, marginTop: Spacing.three },
  groupCard: { borderRadius: 14, padding: Spacing.three, marginBottom: Spacing.three },
  groupLabel: { fontSize: 13, fontWeight: 600, marginTop: Spacing.three },
  rtlHint: { fontSize: 11, lineHeight: 15, marginTop: Spacing.one },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.three,
  },
  subLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1, marginTop: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: 600 },
  rowNote: { fontSize: 12, marginTop: 1 },
  optionRow: { flexDirection: 'row', gap: Spacing.two },
  option: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  optionText: { fontSize: 14, fontWeight: 600 },
  credits: { fontSize: 11, lineHeight: 16, marginTop: Spacing.five, textAlign: 'center' },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.three,
  },
  noteText: { flex: 1, lineHeight: 18 },
  permissionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  cityChip: { borderRadius: 999, borderWidth: 1, paddingVertical: Spacing.one + 2, paddingHorizontal: Spacing.three },
  chipText: { fontSize: 13, fontWeight: 600 },
  coordRow: { flexDirection: 'row', gap: Spacing.two },
  coordField: { flex: 1, gap: Spacing.one },
  coordInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
    fontSize: 14,
  },
  slotCard: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two, marginTop: Spacing.one },
  slotHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  anchorChip: { borderRadius: 999, borderWidth: 1, paddingVertical: Spacing.one + 2, paddingHorizontal: Spacing.three },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flexWrap: 'wrap' },
  stepperGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  stepButton: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontSize: 18, fontWeight: 700, minWidth: 28, textAlign: 'center' },
  slotNote: { fontSize: 12, lineHeight: 17 },
});
