/**
 * FSRS scheduling + the daily plan engine for Muhafiz.
 *
 * `ts-fsrs` handles the memory model (default weights, 0.90 retention, max
 * 365-day interval). This module maps app-level review outcomes onto FSRS
 * grades, chunks surahs into memorization units, and builds the idempotent
 * per-day SABAQ / SABQI / MANZIL plan.
 */

import { getIndex, getSurah } from '@/data/quran';
import type { SurahData } from '@/data/types';
import * as db from '@/lib/db';
import {
  addDaysToKey,
  type CardRow,
  type PlanDayRow,
  type PlanRow,
} from '@/lib/db';
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card,
  type Grade,
} from 'ts-fsrs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Rating = 1 | 2 | 3 | 4;

export interface UnitChunk {
  startAyah: number;
  endAyah: number;
  unitKey: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MASTERED_INTERVAL_DAYS = 180;
const REVIEWING_INTERVAL_DAYS = 21;
const MAX_CHUNKS_PER_DAY = 3;
const RECENT_CARD_DAYS = 7;
const MISSED_SABAQ_DAYS = 3;

// Default FSRS weights with a 90% desired retention and one-year maximum.
const scheduler = fsrs(
  generatorParameters({
    request_retention: 0.9,
    maximum_interval: 365,
    enable_fuzz: false,
  })
);

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Map a practice error rate (0..1) onto an FSRS grade.
 * <5% Easy, 5-15% Good, 15-30% Hard, >30% Again.
 */
export function gradeToRating(errorRate: number): Rating {
  const rate = Number.isFinite(errorRate) ? Math.max(0, errorRate) : 1;
  if (rate < 0.05) return 4;
  if (rate < 0.15) return 3;
  if (rate <= 0.3) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Card state serialization
// ---------------------------------------------------------------------------

interface StoredFsrsCard {
  due?: number;
  stability?: number;
  difficulty?: number;
  scheduled_days?: number;
  learning_steps?: number;
  reps?: number;
  lapses?: number;
  state?: number;
  last_review?: number | null;
}

function toFsrsCard(card: CardRow): Card {
  try {
    const raw = JSON.parse(card.fsrsState) as StoredFsrsCard;
    if (!raw || typeof raw.due !== 'number') throw new Error('empty');
    return {
      due: new Date(raw.due),
      stability: raw.stability ?? 0,
      difficulty: raw.difficulty ?? 0,
      scheduled_days: raw.scheduled_days ?? 0,
      learning_steps: raw.learning_steps ?? 0,
      reps: raw.reps ?? card.reps,
      lapses: raw.lapses ?? card.lapses,
      state: (raw.state ?? 0) as Card['state'],
      last_review: raw.last_review ? new Date(raw.last_review) : undefined,
    };
  } catch {
    // A card row without any FSRS state is treated as brand new.
    return createEmptyCard(new Date(card.createdAt || Date.now()));
  }
}

function serializeFsrsCard(card: Card): string {
  const stored: StoredFsrsCard = {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.getTime() : null,
  };
  return JSON.stringify(stored);
}

function statusForInterval(intervalDays: number): CardRow['status'] {
  if (intervalDays >= MASTERED_INTERVAL_DAYS) return 'mastered';
  if (intervalDays >= REVIEWING_INTERVAL_DAYS) return 'reviewing';
  return 'learning';
}

/**
 * Grade a card and return the updated row (not yet persisted — callers decide
 * when to `db.upsertCard`).
 */
export async function scheduleCard(
  card: CardRow,
  rating: Rating,
  now: number
): Promise<CardRow> {
  const current = toFsrsCard(card);
  const result = scheduler.next(current, new Date(now), rating as Grade);
  const next = result.card;
  const interval = Math.max(0, next.scheduled_days);

  return {
    ...card,
    fsrsState: serializeFsrsCard(next),
    due: next.due.getTime(),
    reps: next.reps,
    lapses: next.lapses,
    status: statusForInterval(interval),
    lastReview: now,
  };
}

/** Build an unscheduled CardRow for a unit (used by practice before grading). */
export function makeCardRow(
  surah: number,
  startAyah: number,
  endAyah: number,
  planId: number | null = null,
  kind = 'sabaq'
): CardRow {
  const now = Date.now();
  return {
    unitKey: unitKeyFor(surah, startAyah, endAyah),
    surah,
    startAyah,
    endAyah,
    kind,
    fsrsState: '',
    due: now,
    reps: 0,
    lapses: 0,
    status: 'new',
    createdAt: now,
    lastReview: null,
    planId,
  };
}

// ---------------------------------------------------------------------------
// Unit keys / chunks
// ---------------------------------------------------------------------------

export function unitKeyFor(surah: number, startAyah: number, endAyah: number): string {
  return `s${surah}:${startAyah}-${endAyah}`;
}

export function parseUnitKey(
  unitKey: string
): { surah: number; startAyah: number; endAyah: number } | null {
  const match = /^s(\d+):(\d+)-(\d+)$/.exec(unitKey);
  if (!match) return null;
  const surah = Number(match[1]);
  const startAyah = Number(match[2]);
  const endAyah = Number(match[3]);
  if (!surah || !startAyah || !endAyah) return null;
  return { surah, startAyah, endAyah };
}

export function unitAyahCount(unitKey: string): number {
  const parsed = parseUnitKey(unitKey);
  return parsed ? Math.max(0, parsed.endAyah - parsed.startAyah + 1) : 0;
}

export function sumUnitAyahs(unitKeys: string[]): number {
  return unitKeys.reduce((sum, key) => sum + unitAyahCount(key), 0);
}

/** Unite overlapping/adjacent chunks into per-surah ayah ranges. */
export function mergeUnits(
  unitKeys: string[]
): { surah: number; startAyah: number; endAyah: number }[] {
  const parsed = unitKeys
    .map(parseUnitKey)
    .filter((u): u is { surah: number; startAyah: number; endAyah: number } => u !== null)
    .sort((a, b) => a.surah - b.surah || a.startAyah - b.startAyah);
  const merged: { surah: number; startAyah: number; endAyah: number }[] = [];
  for (const unit of parsed) {
    const last = merged[merged.length - 1];
    if (last && last.surah === unit.surah && unit.startAyah <= last.endAyah + 1) {
      last.endAyah = Math.max(last.endAyah, unit.endAyah);
    } else {
      merged.push({ ...unit });
    }
  }
  return merged;
}

function chunkRange(surah: SurahData, rangeStart: number, rangeEnd: number): UnitChunk[] {
  const chunks: UnitChunk[] = [];
  const start = Math.max(1, rangeStart);
  const end = Math.min(surah.ayahCount, rangeEnd);
  if (start > end) return chunks;

  let chunkStart = start;
  let wordCount = 0;
  let ayahCount = 0;

  const push = (lastAyah: number) => {
    chunks.push({
      startAyah: chunkStart,
      endAyah: lastAyah,
      unitKey: unitKeyFor(surah.number, chunkStart, lastAyah),
    });
  };

  for (let ayah = start; ayah <= end; ayah++) {
    const words = surah.ayahs[ayah - 1]?.wordCount ?? 0;
    const wouldExceedWords = wordCount > 0 && wordCount + words > 15;
    const atMaxAyahs = ayahCount >= 7;
    const atMinAyahs = ayahCount >= 5;

    if (ayahCount > 0 && atMinAyahs && (wouldExceedWords || atMaxAyahs)) {
      push(ayah - 1);
      chunkStart = ayah;
      wordCount = 0;
      ayahCount = 0;
    }

    wordCount += words;
    ayahCount += 1;
  }
  if (ayahCount > 0) push(end);
  return chunks;
}

/** Chunks of 5-7 ayahs (or <=15 words / a single long ayah), whole surah. */
export function buildChunks(surah: SurahData): UnitChunk[] {
  return chunkRange(surah, 1, surah.ayahCount);
}

// ---------------------------------------------------------------------------
// Plan range helpers
// ---------------------------------------------------------------------------

/** Surah numbers covered by a plan, in mushaf order. */
export function getPlanSurahs(plan: PlanRow): number[] {
  const index = getIndex();
  if (plan.kind === 'surahs' && plan.surahs.length > 0) {
    return [...new Set(plan.surahs)]
      .filter((n) => n >= 1 && n <= 114)
      .sort((a, b) => a - b);
  }
  const result: number[] = [];
  for (let surah = 1; surah <= 114; surah++) {
    const start = (index.surahPrefix[surah - 1] ?? 0) + 1;
    const end = index.surahPrefix[surah] ?? index.ayahCount;
    if (start <= plan.goalEnd && end >= plan.goalStart) result.push(surah);
  }
  return result;
}

/** Total ayahs inside the plan's goal range. */
export function getGoalAyahCount(plan: PlanRow): number {
  const index = getIndex();
  let total = 0;
  for (const surah of getPlanSurahs(plan)) {
    const surahStart = (index.surahPrefix[surah - 1] ?? 0) + 1;
    const surahEnd = index.surahPrefix[surah] ?? index.ayahCount;
    const from = Math.max(surahStart, plan.goalStart);
    const to = Math.min(surahEnd, plan.goalEnd);
    if (to >= from) total += to - from + 1;
  }
  return total;
}

/** True when a global ayah falls inside the plan goal. */
export function isInGoal(plan: PlanRow, globalAyah: number): boolean {
  return globalAyah >= plan.goalStart && globalAyah <= plan.goalEnd;
}

// ---------------------------------------------------------------------------
// Plan engine
// ---------------------------------------------------------------------------

function chunksPerDay(dailyNew: number): number {
  return Math.max(1, Math.min(MAX_CHUNKS_PER_DAY, Math.ceil(dailyNew / 6)));
}

interface NextChunksResult {
  chunks: UnitChunk[];
  cursor: number;
}

/**
 * Walk the plan range from `fromGlobal`, skipping chunks that already have a
 * card, until `limit` fresh chunks are found. The cursor always advances past
 * skipped chunks so the plan doesn't get stuck.
 */
async function nextUnlearnedChunks(
  plan: PlanRow,
  fromGlobal: number,
  limit: number
): Promise<NextChunksResult> {
  const chunks: UnitChunk[] = [];
  const index = getIndex();
  let cursor = Math.max(plan.goalStart, fromGlobal);

  if (limit <= 0 || cursor > plan.goalEnd) return { chunks, cursor };

  for (const surahNumber of getPlanSurahs(plan)) {
    if (chunks.length >= limit) break;
    const surahStart = (index.surahPrefix[surahNumber - 1] ?? 0) + 1;
    const surahEnd = index.surahPrefix[surahNumber] ?? index.ayahCount;
    if (surahEnd < cursor) continue;
    if (surahStart > plan.goalEnd) break;

    const firstAyah = cursor > surahStart ? cursor - surahStart + 1 : 1;
    const maxAyah = Math.min(surahEnd, plan.goalEnd) - surahStart + 1;
    if (firstAyah > maxAyah) continue;

    const surah = await getSurah(surahNumber);
    if (!surah) continue;

    const candidates = chunkRange(surah, firstAyah, maxAyah);
    for (const candidate of candidates) {
      if (chunks.length >= limit) break;
      const chunkStartGlobal = surahStart + candidate.startAyah - 1;
      const chunkEndGlobal = surahStart + candidate.endAyah - 1;
      if (chunkStartGlobal > plan.goalEnd) {
        cursor = plan.goalEnd + 1;
        break;
      }
      const existing = await db.getCard(candidate.unitKey);
      cursor = chunkEndGlobal + 1;
      if (existing) continue;
      chunks.push(candidate);
    }
  }

  return { chunks, cursor: Math.min(cursor, plan.goalEnd + 1) };
}

/**
 * SABAQ list for a day: missed chunks from the previous 3 days first, then
 * fresh chunks from the plan cursor, capped at 3 chunks total. Returns the
 * new cursor WITHOUT persisting it — the caller persists day + cursor in one
 * transaction so a failed/concurrent day insert can never skip chunks.
 */
async function buildSabaq(
  plan: PlanRow,
  localDate: string
): Promise<{ keys: string[]; cursor: number }> {
  const cap = chunksPerDay(plan.dailyNew);
  const selected: string[] = [];
  let cursor = plan.cursorGlobal;

  const prior = await db.getUndonePlanDays(
    plan.id,
    addDaysToKey(localDate, -MISSED_SABAQ_DAYS),
    localDate
  );
  for (const day of prior) {
    for (const key of day.sabaq) {
      if (selected.length >= cap) break;
      if (selected.includes(key)) continue;
      // A chunk that already has a card is no longer "unlearned" — it lives
      // in SABQI/MANZIL instead.
      const card = await db.getCard(key);
      if (card) continue;
      selected.push(key);
    }
    if (selected.length >= cap) break;
  }

  if (selected.length < cap) {
    const { chunks, cursor: nextCursor } = await nextUnlearnedChunks(
      plan,
      plan.cursorGlobal,
      cap - selected.length
    );
    for (const chunk of chunks) {
      if (!selected.includes(chunk.unitKey)) selected.push(chunk.unitKey);
    }
    cursor = nextCursor;
  }

  return { keys: selected.slice(0, cap), cursor };
}

const MAX_BLOCK_UNITS = 10; // cap per SABQI/MANZIL block so a break never floods a day

/**
 * Build (or return) the plan day for `localDate`. Idempotent: a day is created
 * once and reused for the rest of the day. The day row and the advanced SABAQ
 * cursor are written in a single transaction so concurrent callers (Today +
 * Practice) can never skip chunks.
 */
export async function getOrCreatePlanDay(
  plan: PlanRow,
  localDate: string
): Promise<PlanDayRow> {
  await db.ensureDb();
  const existing = await db.getPlanDay(plan.id, localDate);
  if (existing) return existing;

  // Re-read the plan so a stale caller can never rewind the SABAQ cursor.
  const currentPlan = (await db.getPlan(plan.id)) ?? plan;
  const now = Date.now();
  const due = await db.getDueCards(now);
  const planSurahs = new Set(getPlanSurahs(currentPlan));
  const recentCutoff = now - RECENT_CARD_DAYS * DAY_MS;
  const sabqi: string[] = [];
  const manzil: string[] = [];

  for (const card of due) {
    // Only the plan's own material is revised through the daily blocks.
    if (!planSurahs.has(card.surah)) continue;
    if (card.createdAt >= recentCutoff) {
      if (sabqi.length < MAX_BLOCK_UNITS && !sabqi.includes(card.unitKey)) {
        sabqi.push(card.unitKey);
      }
    } else if (manzil.length < MAX_BLOCK_UNITS && !manzil.includes(card.unitKey)) {
      manzil.push(card.unitKey);
    }
  }

  const { keys: sabaq, cursor } = await buildSabaq(currentPlan, localDate);
  return db.createPlanDayWithCursor(currentPlan.id, localDate, sabaq, sabqi, manzil, cursor);
}

/** Contract name for the daily plan builder. */
export async function generatePlanDay(plan: PlanRow, localDate: string): Promise<PlanDayRow> {
  return getOrCreatePlanDay(plan, localDate);
}

/** All unit keys assigned to a day, SABAQ first. */
export function planDayUnits(day: PlanDayRow): string[] {
  return [...new Set([...day.sabaq, ...day.sabqi, ...day.manzil])];
}

/** Sum of ayahs across all three blocks (overlaps counted once). */
export function planDayAyahCount(day: PlanDayRow): number {
  return sumUnitAyahs(planDayUnits(day));
}

/** Rough session estimate in minutes, used by the Today card. */
export function planDayEtaMinutes(day: PlanDayRow): number {
  return Math.max(1, Math.round(planDayUnits(day).length * 2.5));
}
