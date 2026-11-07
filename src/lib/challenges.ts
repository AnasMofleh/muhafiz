/**
 * Challenge helpers for the social screen (M6).
 *
 * Challenges are local-first: the code is just a short, human-friendly string
 * that friends exchange. Each device keeps its own challenge rows and computes
 * progress from its own FSRS cards, so no server is involved.
 */

import { getIndex } from '@/data/quran';

/** Characters used in codes: A-Z plus 2-9 (no 0/1 to avoid misreading). */
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export interface ChallengeRange {
  surahFrom: number;
  surahTo: number;
}

/** Minimal mastered-card shape needed to measure progress. */
export interface DoneCard {
  surah: number;
  startAyah: number;
  /** Inclusive last ayah; defaults to `startAyah` for single-ayah cards. */
  endAyah?: number;
}

export interface ChallengeProgress {
  /** Ayahs covered by mastered cards inside the challenge range. */
  done: number;
  /** Total ayahs in the challenge's surah range. */
  total: number;
  /** 0..100, rounded. */
  pct: number;
}

/** Generates a 6-character challenge code like "Q7K2M9". */
export function makeChallengeCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Progress for a surah-range challenge. `doneCards` should contain only cards
 * the user has mastered (e.g. cards fetched with `getCardsInRange` and filtered
 * by status). Overlapping chunks are merged so an ayah is counted only once.
 */
export function challengeProgress(
  challenge: ChallengeRange,
  doneCards: DoneCard[]
): ChallengeProgress {
  const index = getIndex();
  const from = Math.min(114, Math.max(1, Math.round(challenge.surahFrom)));
  const to = Math.min(114, Math.max(from, Math.round(challenge.surahTo)));

  let total = 0;
  for (let surah = from; surah <= to; surah += 1) {
    total += index.surahs[surah - 1]?.ayahCount ?? 0;
  }

  const bySurah = new Map<number, { start: number; end: number }[]>();
  for (const card of doneCards) {
    if (card.surah < from || card.surah > to) continue;
    const ayahCount = index.surahs[card.surah - 1]?.ayahCount ?? 0;
    const start = Math.min(ayahCount, Math.max(1, Math.round(card.startAyah)));
    const rawEnd = card.endAyah ?? card.startAyah;
    const end = Math.min(ayahCount, Math.max(start, Math.round(rawEnd)));
    if (ayahCount === 0 || start > end) continue;
    const ranges = bySurah.get(card.surah) ?? [];
    ranges.push({ start, end });
    bySurah.set(card.surah, ranges);
  }

  let done = 0;
  for (const ranges of bySurah.values()) {
    ranges.sort((a, b) => a.start - b.start);
    let currentStart = ranges[0].start;
    let currentEnd = ranges[0].end;
    for (let i = 1; i < ranges.length; i += 1) {
      const range = ranges[i];
      if (range.start <= currentEnd + 1) {
        currentEnd = Math.max(currentEnd, range.end);
      } else {
        done += currentEnd - currentStart + 1;
        currentStart = range.start;
        currentEnd = range.end;
      }
    }
    done += currentEnd - currentStart + 1;
  }

  const cappedDone = Math.min(done, total);
  return {
    done: cappedDone,
    total,
    pct: total > 0 ? Math.round((cappedDone / total) * 100) : 0,
  };
}

export interface ParsedInvite {
  code: string;
  /** Invite metadata carried by the CH: payload (null for a bare code). */
  title: string | null;
  surahFrom: number | null;
  surahTo: number | null;
  days: number | null;
}

/**
 * Extracts a challenge code from a shared invite, e.g.
 * "Quran challenge: Juz 30 ... code Q7K2M9 ... CH:Q7K2M9:78-114:14:Juz%2030 ...".
 * The optional `CH:code:from-to:days:title` payload reconstructs the full
 * challenge scope; a bare code returns nulls for the metadata fields.
 */
export function parseChallengeFromText(text: string): ParsedInvite | null {
  const payload = /CH:([A-Z2-9]{6}):(\d+)-(\d+):(\d+):([^\s]+)/.exec(text);
  if (payload) {
    let title: string | null = null;
    try {
      title = decodeURIComponent(payload[5]);
    } catch {
      title = null;
    }
    return {
      code: payload[1].toUpperCase(),
      surahFrom: Number(payload[2]),
      surahTo: Number(payload[3]),
      days: Number(payload[4]),
      title,
    };
  }
  const match = /code\s+([A-Z2-9]{6})/i.exec(text);
  if (!match) return null;
  return {
    code: match[1].toUpperCase(),
    title: null,
    surahFrom: null,
    surahTo: null,
    days: null,
  };
}
