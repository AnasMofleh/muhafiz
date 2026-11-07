import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Local-first app settings. Persisted on-device (AsyncStorage on native,
// localStorage on web). M2 replaces this with the SQLite-backed store for
// plan/progress data; simple preferences stay here.

export type ReminderAnchor = 'fajr' | 'asr' | 'maghrib' | 'isha' | 'fixed';

export type AppLanguage = 'en' | 'sv' | 'ar';
export type AppTheme = 'system' | 'light' | 'dark';
export type MushafLayout = 'lines' | 'flow';
export type MushafTextColor = 'classic' | 'green' | 'gold' | 'teal';
export type FlashcardSection = 'today' | 'surah' | 'juz' | 'learned';

export interface ReminderSlot {
  enabled: boolean;
  anchor: ReminderAnchor;
  /** Local hour (0-23) of the daily notification. Prayer anchors store the computed time. */
  hour: number;
  minute: number;
}

const DEFAULT_SLOT_1: ReminderSlot = { enabled: false, anchor: 'fajr', hour: 5, minute: 0 };
const DEFAULT_SLOT_2: ReminderSlot = { enabled: false, anchor: 'isha', hour: 20, minute: 0 };

interface SettingsState {
  reciterId: string;
  playbackRate: number;
  repeatAyah: number;
  autoAdvance: boolean;
  fontScale: number; // mushaf text size multiplier

  // General (i18n + theme)
  language: AppLanguage;
  theme: AppTheme;

  // Mushaf display
  mushafLayout: MushafLayout;
  mushafTextColor: MushafTextColor;
  mushafParchment: boolean;

  // Flashcards
  flashcardSection: FlashcardSection;
  flashcardSurah: number;
  flashcardJuz: number;
  flashcardRandom: boolean;

  // Reminders (M3)
  remindersEnabled: boolean;
  /** City preset id from CITY_PRESETS, or 'custom'. */
  anchorCity: string;
  customLat: number | null;
  customLng: number | null;
  reminderSlot1: ReminderSlot;
  reminderSlot2: ReminderSlot;
  quietHoursEnabled: boolean;

  setReciter: (id: string) => void;
  setPlaybackRate: (rate: number) => void;
  setRepeatAyah: (n: number) => void;
  setAutoAdvance: (v: boolean) => void;
  setFontScale: (v: number) => void;

  setLanguage: (language: AppLanguage) => void;
  setTheme: (theme: AppTheme) => void;

  setMushafLayout: (layout: MushafLayout) => void;
  setMushafTextColor: (color: MushafTextColor) => void;
  setMushafParchment: (v: boolean) => void;

  setFlashcardSection: (section: FlashcardSection) => void;
  setFlashcardSurah: (n: number) => void;
  setFlashcardJuz: (n: number) => void;
  setFlashcardRandom: (v: boolean) => void;

  setRemindersEnabled: (v: boolean) => void;
  setAnchorCity: (id: string) => void;
  setCustomLocation: (lat: number | null, lng: number | null) => void;
  setCustomLat: (lat: number | null) => void;
  setCustomLng: (lng: number | null) => void;
  setReminderSlot1: (slot: ReminderSlot) => void;
  setReminderSlot2: (slot: ReminderSlot) => void;
  updateReminderSlot1: (patch: Partial<ReminderSlot>) => void;
  updateReminderSlot2: (patch: Partial<ReminderSlot>) => void;
  setQuietHoursEnabled: (v: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      reciterId: 'husary',
      playbackRate: 1,
      repeatAyah: 1,
      autoAdvance: false,
      fontScale: 1,

      language: 'en',
      theme: 'system',

      mushafLayout: 'lines',
      mushafTextColor: 'classic',
      mushafParchment: false,

      flashcardSection: 'today',
      flashcardSurah: 1,
      flashcardJuz: 30,
      flashcardRandom: false,

      remindersEnabled: false,
      anchorCity: 'custom',
      customLat: null,
      customLng: null,
      reminderSlot1: DEFAULT_SLOT_1,
      reminderSlot2: DEFAULT_SLOT_2,
      quietHoursEnabled: false,

      setReciter: (id) => set({ reciterId: id }),
      setPlaybackRate: (rate) => set({ playbackRate: rate }),
      setRepeatAyah: (n) => set({ repeatAyah: n }),
      setAutoAdvance: (v) => set({ autoAdvance: v }),
      setFontScale: (v) => set({ fontScale: v }),

      setLanguage: (language) => set({ language }),
      setTheme: (theme) => set({ theme }),

      setMushafLayout: (mushafLayout) => set({ mushafLayout }),
      setMushafTextColor: (mushafTextColor) => set({ mushafTextColor }),
      setMushafParchment: (mushafParchment) => set({ mushafParchment }),

      setFlashcardSection: (flashcardSection) => set({ flashcardSection }),
      setFlashcardSurah: (flashcardSurah) => set({ flashcardSurah }),
      setFlashcardJuz: (flashcardJuz) => set({ flashcardJuz }),
      setFlashcardRandom: (flashcardRandom) => set({ flashcardRandom }),

      setRemindersEnabled: (v) => set({ remindersEnabled: v }),
      setAnchorCity: (id) => set({ anchorCity: id }),
      setCustomLocation: (lat, lng) => set({ customLat: lat, customLng: lng }),
      setCustomLat: (lat) => set({ customLat: lat }),
      setCustomLng: (lng) => set({ customLng: lng }),
      setReminderSlot1: (slot) => set({ reminderSlot1: slot }),
      setReminderSlot2: (slot) => set({ reminderSlot2: slot }),
      updateReminderSlot1: (patch) =>
        set((state) => ({ reminderSlot1: { ...state.reminderSlot1, ...patch } })),
      updateReminderSlot2: (patch) =>
        set((state) => ({ reminderSlot2: { ...state.reminderSlot2, ...patch } })),
      setQuietHoursEnabled: (v) => set({ quietHoursEnabled: v }),
    }),
    {
      name: 'muhafiz-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
