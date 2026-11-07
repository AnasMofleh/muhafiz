import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { AlignedWord } from '@/lib/align';

/** Personal daily cap for Groq Whisper requests. */
export const DAILY_ASR_QUOTA = 20;

export interface AsrLastResult {
  surah: number;
  ayah: number;
  words: AlignedWord[];
  score: number;
}

interface AsrState {
  /** Groq API key. Stored on-device only; never committed. */
  groqKey: string;
  /** Number of Groq checks used on `quotaDate` (local calendar day). */
  quotaUsedToday: number;
  /** Local date key (`YYYY-MM-DD`) for `quotaUsedToday`. */
  quotaDate: string;
  lastResult: AsrLastResult | null;

  setGroqKey: (key: string) => void;
  /** True while today's personal Groq quota still has room. */
  canUseQuota: () => boolean;
  /** Number of checks used today, accounting for a stale persisted date. */
  checksToday: () => number;
  /** Call after a successful Groq transcription. */
  recordCheck: () => void;
  resetQuota: () => void;
  setLastResult: (result: AsrLastResult | null) => void;
  clearLastResult: () => void;
}

/** Local calendar date (not UTC) so the cap resets at local midnight. */
export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const useAsrStore = create<AsrState>()(
  persist(
    (set, get) => ({
      groqKey: '',
      quotaUsedToday: 0,
      quotaDate: localDateKey(),
      lastResult: null,

      setGroqKey: (key) => set({ groqKey: key.trim() }),

      canUseQuota: () => {
        const state = get();
        if (state.quotaDate !== localDateKey()) return true;
        return state.quotaUsedToday < DAILY_ASR_QUOTA;
      },

      checksToday: () => {
        const state = get();
        return state.quotaDate === localDateKey() ? state.quotaUsedToday : 0;
      },

      recordCheck: () =>
        set((state) => {
          const today = localDateKey();
          const used = state.quotaDate === today ? state.quotaUsedToday : 0;
          return {
            quotaDate: today,
            quotaUsedToday: Math.min(used + 1, DAILY_ASR_QUOTA),
          };
        }),

      resetQuota: () => set({ quotaUsedToday: 0, quotaDate: localDateKey() }),

      setLastResult: (result) => set({ lastResult: result }),
      clearLastResult: () => set({ lastResult: null }),
    }),
    {
      name: 'muhafiz-asr',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
