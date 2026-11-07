/**
 * Shared helpers for the gamified practice modes.
 *
 * The screens stay presentational; queue building, grading/XP bookkeeping and
 * session copy all live here so Flashcards, Hide & Recite, Scratch and Quiz
 * grade a review exactly the same way.
 */

import { getIndex } from '@/data/quran';
import type { Ayah, AyahRef, SurahData } from '@/data/types';
import * as db from '@/lib/db';
import {
  localDateKey,
  type CardRow,
  type PlanDayRow,
  type PlanRow,
} from '@/lib/db';
import {
  generatePlanDay,
  gradeToRating,
  makeCardRow,
  parseUnitKey,
  scheduleCard,
  type Rating,
} from '@/lib/scheduler';
import { xpForRating } from '@/lib/xp';

export type { CardRow, PlanDayRow, PlanRow } from '@/lib/db';
export type { Rating } from '@/lib/scheduler';

export const GRADE_LABELS: Record<Rating, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
};

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** Earliest-due card in a queue (falls back to the first card). */
export function pickDueCard(cards: CardRow[]): CardRow | null {
  if (cards.length === 0) return null;
  const now = Date.now();
  const due = cards.filter((card) => card.due <= now);
  const pool = due.length > 0 ? due : cards;
  return [...pool].sort((a, b) => a.due - b.due)[0] ?? null;
}

/** Human line shown on a completed session card. */
export function sessionSummary(cardsDone: number, xp: number): string {
  if (cardsDone <= 0) return 'No cards reviewed yet.';
  const noun = cardsDone === 1 ? 'card' : 'cards';
  return `${cardsDone} ${noun} reviewed · +${xp} XP earned`;
}

/** Error-rate -> FSRS grade mapping (re-exported for screens and tests). */
export function gradeErrorMapping(errorRate: number): Rating {
  return gradeToRating(errorRate);
}

/** The ayah after `ref`, crossing surah boundaries; null at 114:6. */
export function nextAyahRef(ref: AyahRef): AyahRef | null {
  const index = getIndex();
  const surah = index.surahs[ref.surah - 1];
  if (!surah) return null;
  if (ref.ayah < surah.ayahCount) return { surah: ref.surah, ayah: ref.ayah + 1 };
  if (ref.surah < 114) return { surah: ref.surah + 1, ayah: 1 };
  return null;
}

/** First `count` words of an Uthmani line (used on the flashcard front). */
export function firstWords(text: string, count: number): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, Math.max(0, count))
    .join(' ');
}

/** All loaded ayahs that belong to a chunk card, clamped to the surah. */
export function cardAyahs(surah: SurahData, card: CardRow): Ayah[] {
  const from = Math.max(1, card.startAyah);
  const to = Math.min(surah.ayahCount, card.endAyah);
  if (from > to) return [];
  return surah.ayahs.slice(from - 1, to);
}

/** Full Uthmani text of a chunk card. */
export function fullCardText(surah: SurahData, card: CardRow): string {
  return cardAyahs(surah, card)
    .map((ayah) => ayah.text_uthmani)
    .join(' ');
}

/** Alternate two lists so SABQI and MANZIL revision are interleaved. */
export function interleave<T>(first: T[], second: T[]): T[] {
  const result: T[] = [];
  const max = Math.max(first.length, second.length);
  for (let i = 0; i < max; i += 1) {
    if (i < first.length) result.push(first[i]);
    if (i < second.length) result.push(second[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Queue building
// ---------------------------------------------------------------------------

/**
 * Default queue for a free practice session: cards due now, then the most
 * recently reviewed cards (so a beginner always has something to practice).
 */
export async function loadDefaultQueue(limit = 10): Promise<CardRow[]> {
  await db.ensureDb();
  const due = await db.getDueCards(Date.now());
  if (due.length > 0) return due.slice(0, limit);

  // Nothing due: replay the cards from the latest review logs.
  const logs = await db.getReviewLogsSince(0);
  const seen: string[] = [];
  for (const log of [...logs].sort((a, b) => b.at - a.at)) {
    if (!seen.includes(log.cardKey)) seen.push(log.cardKey);
    if (seen.length >= limit) break;
  }

  const recent: CardRow[] = [];
  for (const key of seen) {
    const card = await db.getCard(key);
    if (card) recent.push(card);
  }
  if (recent.length > 0) return recent;

  // Last resort for a brand-new database with a plan but no reviews yet.
  const all = await db.getAllCards();
  return all
    .sort((a, b) => (b.lastReview ?? b.createdAt) - (a.lastReview ?? a.createdAt))
    .slice(0, limit);
}

export interface TodaySession {
  plan: PlanRow | null;
  day: PlanDayRow | null;
  cards: CardRow[];
  sabaqCount: number;
  sabqiCount: number;
  manzilCount: number;
}

function cardKindFor(kind: string): string {
  return kind === 'sabqi' || kind === 'manzil' ? kind : 'sabaq';
}

function addUniqueKey(keys: string[], key: string): void {
  if (!keys.includes(key)) keys.push(key);
}

/**
 * The "today's session" queue: SABAQ chunks first, then the SABQI/MANZIL
 * revision blocks interleaved, with any extra due cards appended.
 */
export async function loadTodaySession(limit = 20): Promise<TodaySession> {
  await db.ensureDb();
  const plan = await db.getActivePlan();
  if (!plan) {
    return {
      plan: null,
      day: null,
      cards: await loadDefaultQueue(limit),
      sabaqCount: 0,
      sabqiCount: 0,
      manzilCount: 0,
    };
  }

  const day = await generatePlanDay(plan, localDateKey());
  const keys: string[] = [];
  const kinds = new Map<string, string>();

  for (const key of day.sabaq) {
    addUniqueKey(keys, key);
    kinds.set(key, 'sabaq');
  }
  for (const key of interleave(day.sabqi, day.manzil)) {
    addUniqueKey(keys, key);
    if (!kinds.has(key)) {
      const inSabqi = day.sabqi.includes(key);
      kinds.set(key, inSabqi ? 'sabqi' : 'manzil');
    }
  }

  const cards: CardRow[] = [];
  for (const key of keys) {
    if (cards.length >= limit) break;
    let card = await db.getCard(key);
    if (!card) {
      const parsed = parseUnitKey(key);
      if (!parsed) continue;
      card = makeCardRow(
        parsed.surah,
        parsed.startAyah,
        parsed.endAyah,
        plan.id,
        cardKindFor(kinds.get(key) ?? 'sabaq')
      );
      await db.upsertCard(card);
    }
    cards.push(card);
  }

  const due = await db.getDueCards(Date.now());
  for (const card of due) {
    if (cards.length >= limit) break;
    if (!keys.includes(card.unitKey)) cards.push(card);
  }

  return {
    plan,
    day,
    cards: cards.slice(0, limit),
    sabaqCount: day.sabaq.length,
    sabqiCount: day.sabqi.length,
    manzilCount: day.manzil.length,
  };
}

// ---------------------------------------------------------------------------
// Grading pipeline
// ---------------------------------------------------------------------------

export interface GradeResult {
  xp: number;
  card: CardRow;
}

/**
 * Grade one card: schedule it with FSRS, persist the card, append the review
 * log and award XP. `db.addReviewLog` also mirrors XP into the ledger and
 * registers the daily streak activity, so we do not call those twice.
 */
export async function gradeCardReview(input: {
  card: CardRow;
  rating: Rating;
  mode: string;
  errorCount?: number;
  at?: number;
}): Promise<GradeResult> {
  const at = input.at ?? Date.now();
  const errorCount = Math.max(0, Math.round(input.errorCount ?? 0));
  const xp = xpForRating(input.rating, errorCount);
  const scheduled = await scheduleCard(input.card, input.rating, at);

  await db.upsertCard(scheduled);
  await db.addReviewLog({
    cardKey: scheduled.unitKey,
    rating: input.rating,
    mode: input.mode,
    errorCount,
    xp,
    at,
  });

  return { xp, card: scheduled };
}

/** Card status counts expressed in ayahs (used by badges). */
export async function getProgressSummary(): Promise<{
  mastered: number;
  learning: number;
  reviewing: number;
}> {
  const cards = await db.getAllCards();
  let mastered = 0;
  let learning = 0;
  let reviewing = 0;

  for (const card of cards) {
    const ayahs = Math.max(1, card.endAyah - card.startAyah + 1);
    if (card.status === 'mastered') mastered += ayahs;
    else if (card.status === 'reviewing') reviewing += ayahs;
    else learning += ayahs;
  }

  return { mastered, learning, reviewing };
}
