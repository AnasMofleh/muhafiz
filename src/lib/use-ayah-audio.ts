/**
 * useAyahAudio — one stable expo-audio player for ayah playback.
 *
 * Every practice mode needs the same tiny primitive: "play this ayah with the
 * selected reciter and speed". The player is created once per screen with a
 * `null` source (creating it with a source would release and rebuild the
 * native player whenever the ayah changes). New ayahs are swapped in with
 * `player.replace()`.
 */

import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ayahAudioUrl, getReciter } from '@/lib/reciters';
import { useSettings } from '@/store/settings';

export interface AyahAudioRef {
  surah: number;
  ayah: number;
}

export interface UseAyahAudioResult {
  /** Play (or replay) one ayah. Safe to call repeatedly with the same ref. */
  playAyah: (surah: number, ayah: number) => void;
  /** Stop playback without losing the current ayah reference. */
  pause: () => void;
  /** True while audio is actually playing. */
  playing: boolean;
  /** The ayah currently loaded in the player (null before first play). */
  current: AyahAudioRef | null;
}

export function useAyahAudio(): UseAyahAudioResult {
  const reciterId = useSettings((state) => state.reciterId);
  const playbackRate = useSettings((state) => state.playbackRate);

  // One stable player; sources are swapped with replace().
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  const [current, setCurrent] = useState<AyahAudioRef | null>(null);
  const currentRef = useRef<AyahAudioRef | null>(null);

  useEffect(() => {
    // Practice audio should be audible even when the phone is on silent.
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      player.setPlaybackRate(playbackRate, 'high');
    } catch {
      // Rate changes are best-effort; some platforms reject early calls.
    }
  }, [player, playbackRate]);

  const playAyah = useCallback(
    (surah: number, ayah: number) => {
      const previous = currentRef.current;
      const same = previous?.surah === surah && previous?.ayah === ayah;
      try {
        if (!same) {
          player.replace(ayahAudioUrl(getReciter(reciterId), surah, ayah));
          // replace() resets the rate, so re-apply it before playing.
          try {
            player.setPlaybackRate(playbackRate, 'high');
          } catch {
            // Keep playing even if the platform rejects the rate change.
          }
          currentRef.current = { surah, ayah };
          setCurrent({ surah, ayah });
        } else if (!player.playing) {
          // Replaying a finished/paused ayah starts from its beginning.
          void player.seekTo(0);
        }
        player.play();
      } catch {
        // Audio is an enhancement in practice modes — a failed stream must
        // never take down the grading flow.
      }
    },
    [player, playbackRate, reciterId]
  );

  const pause = useCallback(() => {
    try {
      player.pause();
    } catch {
      // Ignore: the player may already be released during unmount.
    }
  }, [player]);

  return { playAyah, pause, playing: status.playing, current };
}
