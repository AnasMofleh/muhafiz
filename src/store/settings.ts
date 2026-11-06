import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Local-first app settings. Persisted on-device (AsyncStorage on native,
// localStorage on web). M2 replaces this with the SQLite-backed store for
// plan/progress data; simple preferences stay here.

interface SettingsState {
  reciterId: string;
  playbackRate: number;
  repeatAyah: number;
  autoAdvance: boolean;
  fontScale: number; // mushaf text size multiplier
  setReciter: (id: string) => void;
  setPlaybackRate: (rate: number) => void;
  setRepeatAyah: (n: number) => void;
  setAutoAdvance: (v: boolean) => void;
  setFontScale: (v: number) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      reciterId: 'husary',
      playbackRate: 1,
      repeatAyah: 1,
      autoAdvance: false,
      fontScale: 1,
      setReciter: (id) => set({ reciterId: id }),
      setPlaybackRate: (rate) => set({ playbackRate: rate }),
      setRepeatAyah: (n) => set({ repeatAyah: n }),
      setAutoAdvance: (v) => set({ autoAdvance: v }),
      setFontScale: (v) => set({ fontScale: v }),
    }),
    {
      name: 'muhafiz-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
