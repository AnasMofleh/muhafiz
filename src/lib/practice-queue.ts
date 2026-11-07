/**
 * Practice queue building shared by Flashcards and Quiz: section choice
 * (today's session / specific surah / juz / learned cards) + optional
 * shuffle. Extracted so both modes honor the same settings.
 */

import { getSurah, globalAyahNumber, juzStartGlobal } from '@/data/quran';
import { ensureDb, getAllCards, getCardsForSurah, getOrCreateCard } from '@/lib/db';
import { loadTodaySession, type CardRow } from '@/lib/modes';
import { buildChunks } from '@/lib/scheduler';
import type { FlashcardSection } from '@/store/settings';

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Build the practice queue for the chosen section. */
export async function loadSectionQueue(
  section: FlashcardSection,
  surahNumber: number,
  juzNumber: number
): Promise<CardRow[]> {
  await ensureDb();
  switch (section) {
    case 'today': {
      return (await loadTodaySession(20)).cards;
    }
    case 'surah': {
      const surah = await getSurah(surahNumber);
      if (!surah) return [];
      const cards: CardRow[] = [];
      for (const chunk of buildChunks(surah)) {
        cards.push(await getOrCreateCard(chunk.unitKey));
      }
      return cards;
    }
    case 'juz': {
      // Cards overlapping the juz's global ayah range.
      const from = juzStartGlobal(juzNumber);
      const to = juzNumber < 30 ? juzStartGlobal(juzNumber + 1) - 1 : 6236;
      const result: CardRow[] = [];
      for (let s = 1; s <= 114; s += 1) {
        for (const card of await getCardsForSurah(s)) {
          const start = globalAyahNumber({ surah: card.surah, ayah: card.startAyah });
          const end = globalAyahNumber({ surah: card.surah, ayah: card.endAyah });
          if (start <= to && end >= from) result.push(card);
        }
      }
      return result;
    }
    case 'learned': {
      return (await getAllCards()).filter((card) => card.status !== 'new');
    }
  }
}
