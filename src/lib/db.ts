/**
 * Local-first persistence for Muhafiz (M2).
 *
 * A single SQLite database (`muhafiz.db`) hosted by expo-sqlite. The same
 * module runs on native and on web (expo-sqlite ships a WASM/worker driver
 * for web), so every method here is async and platform-neutral.
 *
 * Tables:
 *  - plans       — one memorization plan (goal range, pace, cursor)
 *  - plan_days   — one row per plan per local calendar day (SABAQ/SABQI/MANZIL)
 *  - cards       — FSRS cards keyed by a chunk unit key ("s2:1-5")
 *  - review_logs — append-only review history
 *  - streaks     — single row (id = 1)
 *  - xp_events   — append-only XP ledger
 *  - challenges  — group challenges
 */

import { getIndex, globalAyahNumber, juzStartGlobal } from '@/data/quran';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlanKind = 'surahs' | 'juz' | 'quran';
export type CardStatus = 'new' | 'learning' | 'reviewing' | 'mastered';

export interface PlanRow {
  id: number;
  kind: PlanKind;
  /** Selected surahs for `kind === 'surahs'` (empty for juz/quran plans). */
  surahs: number[];
  juzFrom: number;
  juzTo: number;
  /** Global ayah range covered by the plan (1..6236, inclusive). */
  goalStart: number;
  goalEnd: number;
  dailyNew: number;
  daysPerWeek: number;
  prayerAnchor: string;
  doomscroll: string;
  reciterId: string;
  /** Global ayah number the SABAQ cursor points at (next unlearned ayah). */
  cursorGlobal: number;
  createdAt: number;
  active: boolean;
}

export interface CreatePlanInput {
  kind: PlanKind;
  surahs?: number[];
  juzFrom?: number;
  juzTo?: number;
  goalStart?: number;
  goalEnd?: number;
  dailyNew?: number;
  daysPerWeek?: number;
  prayerAnchor?: string;
  doomscroll?: string;
  reciterId?: string;
}

export interface PlanDayRow {
  id: number;
  planId: number;
  localDate: string;
  /** Unit keys (e.g. "s2:1-5") assigned to each block for this day. */
  sabaq: string[];
  sabqi: string[];
  manzil: string[];
  doneSabaq: boolean;
  doneSabqi: boolean;
  doneManzil: boolean;
  createdAt: number;
}

export interface CardRow {
  unitKey: string;
  surah: number;
  startAyah: number;
  endAyah: number;
  kind: string;
  /** JSON-encoded ts-fsrs card state. */
  fsrsState: string;
  /** Due timestamp (ms since epoch). */
  due: number;
  reps: number;
  lapses: number;
  status: CardStatus;
  createdAt: number;
  lastReview: number | null;
  planId: number | null;
}

export interface ReviewLogRow {
  id: number;
  cardKey: string;
  rating: number;
  mode: string;
  errorCount: number;
  xp: number;
  at: number;
}

export interface ReviewLogInput {
  cardKey: string;
  rating: number;
  mode?: string;
  errorCount?: number;
  xp?: number;
  at?: number;
}

export interface StreakRow {
  current: number;
  best: number;
  freezes: number;
  /** Local date key ("YYYY-MM-DD") of the last activity, or null. */
  lastActive: string | null;
}

export interface XpEventRow {
  id: number;
  amount: number;
  reason: string;
  at: number;
}

export interface ChallengeRow {
  id: number;
  title: string;
  surahFrom: number;
  surahTo: number;
  days: number;
  deadline: string;
  code: string;
  createdAt: number;
  completedAt: number | null;
}

export interface CreateChallengeInput {
  title: string;
  surahFrom: number;
  surahTo: number;
  days: number;
  /** ISO date key or a ms timestamp — stored as text. */
  deadline: string | number;
  code: string;
}

export interface SurahProgress {
  surah: number;
  ayahCount: number;
  /** Ayahs covered by mastered cards. */
  masteredAyahs: number;
  totalCards: number;
  masteredCards: number;
  /** 0..100 */
  percent: number;
}

// ---------------------------------------------------------------------------
// Dates (local calendar days, not UTC)
// ---------------------------------------------------------------------------

/** Local calendar date key, e.g. "2026-11-07". */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Shift a "YYYY-MM-DD" key by a number of local days (DST-safe at noon). */
export function addDaysToKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  return localDateKey(new Date(y, m - 1, d + delta, 12, 0, 0, 0));
}

// ---------------------------------------------------------------------------
// Connection + schema
// ---------------------------------------------------------------------------

let dbPromise: Promise<SQLiteDatabase> | null = null;
let ensurePromise: Promise<void> | null = null;

function getDb(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabaseAsync('muhafiz.db').catch((error) => {
      // Allow a later call to retry instead of caching a rejected promise.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'quran',
  surahs TEXT NOT NULL DEFAULT '[]',
  juz_from INTEGER NOT NULL DEFAULT 1,
  juz_to INTEGER NOT NULL DEFAULT 30,
  goal_start INTEGER NOT NULL DEFAULT 1,
  goal_end INTEGER NOT NULL DEFAULT 6236,
  daily_new INTEGER NOT NULL DEFAULT 5,
  days_per_week INTEGER NOT NULL DEFAULT 7,
  prayer_anchor TEXT NOT NULL DEFAULT 'none',
  doomscroll TEXT NOT NULL DEFAULT '',
  reciter_id TEXT NOT NULL DEFAULT 'husary',
  cursor_global INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plan_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  sabaq TEXT NOT NULL DEFAULT '[]',
  sabqi TEXT NOT NULL DEFAULT '[]',
  manzil TEXT NOT NULL DEFAULT '[]',
  done_sabaq INTEGER NOT NULL DEFAULT 0,
  done_sabqi INTEGER NOT NULL DEFAULT 0,
  done_manzil INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(plan_id, local_date)
);

CREATE TABLE IF NOT EXISTS cards (
  unit_key TEXT PRIMARY KEY NOT NULL,
  surah INTEGER NOT NULL,
  start_ayah INTEGER NOT NULL,
  end_ayah INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'sabaq',
  fsrs_state TEXT NOT NULL DEFAULT '',
  due INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL DEFAULT 0,
  last_review INTEGER,
  plan_id INTEGER
);

CREATE TABLE IF NOT EXISTS review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_key TEXT NOT NULL,
  rating INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT 'recite',
  error_count INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS streaks (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 0,
  freezes INTEGER NOT NULL DEFAULT 0,
  last_active TEXT
);

CREATE TABLE IF NOT EXISTS xp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  surah_from INTEGER NOT NULL DEFAULT 1,
  surah_to INTEGER NOT NULL DEFAULT 114,
  days INTEGER NOT NULL DEFAULT 7,
  deadline TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_plan_days_plan_date ON plan_days(plan_id, local_date);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);
CREATE INDEX IF NOT EXISTS idx_cards_surah ON cards(surah);
CREATE INDEX IF NOT EXISTS idx_review_logs_at ON review_logs(at);
CREATE INDEX IF NOT EXISTS idx_xp_events_at ON xp_events(at);
`;

/** Idempotent schema creation. Safe to call from every screen. */
export function ensureDb(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const db = await getDb();
      await db.execAsync(SCHEMA);
      await db.runAsync(
        `INSERT OR IGNORE INTO streaks (id, current, best, freezes, last_active)
         VALUES (1, 0, 0, 1, NULL)`
      );
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface PlanDbRow {
  id: number;
  kind: string;
  surahs: string;
  juz_from: number;
  juz_to: number;
  goal_start: number;
  goal_end: number;
  daily_new: number;
  days_per_week: number;
  prayer_anchor: string;
  doomscroll: string;
  reciter_id: string;
  cursor_global: number;
  created_at: number;
  active: number;
}

interface PlanDayDbRow {
  id: number;
  plan_id: number;
  local_date: string;
  sabaq: string;
  sabqi: string;
  manzil: string;
  done_sabaq: number;
  done_sabqi: number;
  done_manzil: number;
  created_at: number;
}

interface CardDbRow {
  unit_key: string;
  surah: number;
  start_ayah: number;
  end_ayah: number;
  kind: string;
  fsrs_state: string;
  due: number;
  reps: number;
  lapses: number;
  status: string;
  created_at: number;
  last_review: number | null;
  plan_id: number | null;
}

interface ReviewLogDbRow {
  id: number;
  card_key: string;
  rating: number;
  mode: string;
  error_count: number;
  xp: number;
  at: number;
}

interface StreakDbRow {
  id: number;
  current: number;
  best: number;
  freezes: number;
  last_active: string | null;
}

interface ChallengeDbRow {
  id: number;
  title: string;
  surah_from: number;
  surah_to: number;
  days: number;
  deadline: string;
  code: string;
  created_at: number;
  completed_at: number | null;
}

function parseNumberArray(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => typeof n === 'number');
  } catch {
    return [];
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function mapPlan(row: PlanDbRow): PlanRow {
  return {
    id: row.id,
    kind: (row.kind === 'surahs' || row.kind === 'juz' ? row.kind : 'quran') as PlanKind,
    surahs: parseNumberArray(row.surahs),
    juzFrom: row.juz_from,
    juzTo: row.juz_to,
    goalStart: row.goal_start,
    goalEnd: row.goal_end,
    dailyNew: row.daily_new,
    daysPerWeek: row.days_per_week,
    prayerAnchor: row.prayer_anchor,
    doomscroll: row.doomscroll,
    reciterId: row.reciter_id,
    cursorGlobal: row.cursor_global,
    createdAt: row.created_at,
    active: row.active === 1,
  };
}

function mapPlanDay(row: PlanDayDbRow): PlanDayRow {
  return {
    id: row.id,
    planId: row.plan_id,
    localDate: row.local_date,
    sabaq: parseStringArray(row.sabaq),
    sabqi: parseStringArray(row.sabqi),
    manzil: parseStringArray(row.manzil),
    doneSabaq: row.done_sabaq === 1,
    doneSabqi: row.done_sabqi === 1,
    doneManzil: row.done_manzil === 1,
    createdAt: row.created_at,
  };
}

function mapCard(row: CardDbRow): CardRow {
  const status: CardStatus =
    row.status === 'learning' || row.status === 'reviewing' || row.status === 'mastered'
      ? row.status
      : 'new';
  return {
    unitKey: row.unit_key,
    surah: row.surah,
    startAyah: row.start_ayah,
    endAyah: row.end_ayah,
    kind: row.kind,
    fsrsState: row.fsrs_state,
    due: row.due,
    reps: row.reps,
    lapses: row.lapses,
    status,
    createdAt: row.created_at,
    lastReview: row.last_review,
    planId: row.plan_id,
  };
}

function mapReviewLog(row: ReviewLogDbRow): ReviewLogRow {
  return {
    id: row.id,
    cardKey: row.card_key,
    rating: row.rating,
    mode: row.mode,
    errorCount: row.error_count,
    xp: row.xp,
    at: row.at,
  };
}

function mapStreak(row: StreakDbRow): StreakRow {
  return {
    current: row.current,
    best: row.best,
    freezes: row.freezes,
    lastActive: row.last_active,
  };
}

function mapChallenge(row: ChallengeDbRow): ChallengeRow {
  return {
    id: row.id,
    title: row.title,
    surahFrom: row.surah_from,
    surahTo: row.surah_to,
    days: row.days,
    deadline: row.deadline,
    code: row.code,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

function resolveGoalRange(input: CreatePlanInput): { start: number; end: number } {
  if (input.goalStart && input.goalEnd && input.goalEnd >= input.goalStart) {
    return { start: input.goalStart, end: input.goalEnd };
  }
  const index = getIndex();
  if (input.kind === 'quran') return { start: 1, end: index.ayahCount };
  if (input.kind === 'juz') {
    const from = Math.min(30, Math.max(1, Math.round(input.juzFrom ?? 1)));
    const to = Math.min(30, Math.max(from, Math.round(input.juzTo ?? from)));
    return {
      start: juzStartGlobal(from),
      end: to < 30 ? juzStartGlobal(to + 1) - 1 : index.ayahCount,
    };
  }
  // Specific surahs: the plan covers the span from the first to the last one,
  // while scheduler.getPlanSurahs() keeps the actual set non-contiguous.
  const picks = [...new Set((input.surahs ?? []).filter((n) => n >= 1 && n <= 114))].sort(
    (a, b) => a - b
  );
  const first = picks[0] ?? 1;
  const last = picks[picks.length - 1] ?? 114;
  return {
    start: globalAyahNumber({ surah: first, ayah: 1 }),
    end: index.surahPrefix[last] ?? index.ayahCount,
  };
}

/** The plan currently shown on Today/Path. Newest active plan wins. */
export async function getActivePlan(): Promise<PlanRow | null> {
  await ensureDb();
  const db = await getDb();
  const row = await db.getFirstAsync<PlanDbRow>(
    'SELECT * FROM plans WHERE active = 1 ORDER BY id DESC LIMIT 1'
  );
  return row ? mapPlan(row) : null;
}

export async function getPlan(planId: number): Promise<PlanRow | null> {
  await ensureDb();
  const db = await getDb();
  const row = await db.getFirstAsync<PlanDbRow>('SELECT * FROM plans WHERE id = ?', planId);
  return row ? mapPlan(row) : null;
}

/** Create a new active plan and retire any previous one. */
export async function createPlan(input: CreatePlanInput): Promise<PlanRow> {
  await ensureDb();
  const db = await getDb();
  const kind: PlanKind = input.kind;
  const juzFrom = Math.min(30, Math.max(1, Math.round(input.juzFrom ?? 1)));
  const juzTo =
    kind === 'juz'
      ? Math.min(30, Math.max(juzFrom, Math.round(input.juzTo ?? juzFrom)))
      : 30;
  const range = resolveGoalRange({ ...input, kind, juzFrom, juzTo });
  const surahs =
    kind === 'surahs'
      ? [...new Set((input.surahs ?? []).filter((n) => n >= 1 && n <= 114))].sort((a, b) => a - b)
      : [];
  const now = Date.now();

  await db.runAsync('UPDATE plans SET active = 0 WHERE active = 1');
  const result = await db.runAsync(
    `INSERT INTO plans
      (kind, surahs, juz_from, juz_to, goal_start, goal_end, daily_new, days_per_week,
       prayer_anchor, doomscroll, reciter_id, cursor_global, created_at, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    kind,
    JSON.stringify(surahs),
    juzFrom,
    juzTo,
    range.start,
    range.end,
    Math.min(15, Math.max(1, Math.round(input.dailyNew ?? 5))),
    Math.min(7, Math.max(1, Math.round(input.daysPerWeek ?? 7))),
    input.prayerAnchor ?? 'none',
    input.doomscroll ?? '',
    input.reciterId ?? 'husary',
    range.start,
    now
  );

  const created = await db.getFirstAsync<PlanDbRow>('SELECT * FROM plans WHERE id = ?', [
    result.lastInsertRowId,
  ]);
  if (!created) throw new Error('Could not create plan');
  return mapPlan(created);
}

/** Persist the SABAQ cursor after the plan engine consumes chunks. */
export async function updatePlanCursor(planId: number, cursorGlobal: number): Promise<void> {
  await ensureDb();
  const db = await getDb();
  await db.runAsync('UPDATE plans SET cursor_global = ? WHERE id = ?', cursorGlobal, planId);
}

// ---------------------------------------------------------------------------
// Plan days
// ---------------------------------------------------------------------------

export async function getPlanDay(planId: number, localDate: string): Promise<PlanDayRow | null> {
  await ensureDb();
  const db = await getDb();
  const row = await db.getFirstAsync<PlanDayDbRow>(
    'SELECT * FROM plan_days WHERE plan_id = ? AND local_date = ?',
    planId,
    localDate
  );
  return row ? mapPlanDay(row) : null;
}

/** Idempotent insert: returns the existing row when one is already there. */
export async function insertPlanDay(
  planId: number,
  localDate: string,
  sabaq: string[],
  sabqi: string[],
  manzil: string[]
): Promise<PlanDayRow> {
  return createPlanDayWithCursor(planId, localDate, sabaq, sabqi, manzil, null);
}

/**
 * Create the plan day and (when `cursorGlobal` is provided) advance the plan's
 * SABAQ cursor in ONE transaction. If the day already exists the transaction
 * returns it untouched — the cursor is only advanced by the caller that
 * actually inserted the row, so concurrent plan-day generation can never skip
 * chunks.
 */
export async function createPlanDayWithCursor(
  planId: number,
  localDate: string,
  sabaq: string[],
  sabqi: string[],
  manzil: string[],
  cursorGlobal: number | null
): Promise<PlanDayRow> {
  await ensureDb();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<PlanDayDbRow>(
      'SELECT * FROM plan_days WHERE plan_id = ? AND local_date = ?',
      planId,
      localDate
    );
    if (existing) return; // someone else created it — leave the cursor alone
    await db.runAsync(
      `INSERT INTO plan_days
        (plan_id, local_date, sabaq, sabqi, manzil, done_sabaq, done_sabqi, done_manzil, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)`,
      planId,
      localDate,
      JSON.stringify(sabaq),
      JSON.stringify(sabqi),
      JSON.stringify(manzil),
      Date.now()
    );
    if (cursorGlobal !== null) {
      await db.runAsync('UPDATE plans SET cursor_global = ? WHERE id = ?', cursorGlobal, planId);
    }
  });
  const row = await getPlanDay(planId, localDate);
  if (!row) throw new Error('Could not create plan day');
  return row;
}

/** Persist the done checkboxes for a day (arrays are immutable after creation). */
export async function savePlanDay(day: PlanDayRow): Promise<void> {
  await ensureDb();
  const db = await getDb();
  await db.runAsync(
    `UPDATE plan_days
        SET done_sabaq = ?, done_sabqi = ?, done_manzil = ?
      WHERE id = ?`,
    day.doneSabaq ? 1 : 0,
    day.doneSabqi ? 1 : 0,
    day.doneManzil ? 1 : 0,
    day.id
  );
}

/** Unfinished SABAQ days in [fromDate, beforeDate), oldest first. */
export async function getUndonePlanDays(
  planId: number,
  fromDate: string,
  beforeDate: string
): Promise<PlanDayRow[]> {
  await ensureDb();
  const db = await getDb();
  const rows = await db.getAllAsync<PlanDayDbRow>(
    `SELECT * FROM plan_days
      WHERE plan_id = ? AND local_date >= ? AND local_date < ? AND done_sabaq = 0
      ORDER BY local_date ASC`,
    planId,
    fromDate,
    beforeDate
  );
  return rows.map(mapPlanDay);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export async function getCard(unitKey: string): Promise<CardRow | null> {
  await ensureDb();
  const db = await getDb();
  const row = await db.getFirstAsync<CardDbRow>('SELECT * FROM cards WHERE unit_key = ?', unitKey);
  return row ? mapCard(row) : null;
}

export async function getCardsByKeys(keys: string[]): Promise<CardRow[]> {
  if (keys.length === 0) return [];
  await ensureDb();
  const db = await getDb();
  const placeholders = keys.map(() => '?').join(',');
  const rows = await db.getAllAsync<CardDbRow>(
    `SELECT * FROM cards WHERE unit_key IN (${placeholders})`,
    keys
  );
  return rows.map(mapCard);
}

export async function getAllCards(): Promise<CardRow[]> {
  await ensureDb();
  const db = await getDb();
  const rows = await db.getAllAsync<CardDbRow>('SELECT * FROM cards');
  return rows.map(mapCard);
}

export async function getCardsForSurah(surah: number): Promise<CardRow[]> {
  await ensureDb();
  const db = await getDb();
  const rows = await db.getAllAsync<CardDbRow>(
    'SELECT * FROM cards WHERE surah = ? ORDER BY start_ayah ASC',
    surah
  );
  return rows.map(mapCard);
}

/** Every card that is due at or before `now` (ms). */
export async function getDueCards(now: number = Date.now()): Promise<CardRow[]> {
  await ensureDb();
  const db = await getDb();
  const rows = await db.getAllAsync<CardDbRow>(
    'SELECT * FROM cards WHERE due <= ? ORDER BY due ASC',
    now
  );
  return rows.map(mapCard);
}

export async function upsertCard(card: CardRow): Promise<void> {
  await ensureDb();
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO cards
      (unit_key, surah, start_ayah, end_ayah, kind, fsrs_state, due, reps, lapses,
       status, created_at, last_review, plan_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(unit_key) DO UPDATE SET
       surah = excluded.surah,
       start_ayah = excluded.start_ayah,
       end_ayah = excluded.end_ayah,
       kind = excluded.kind,
       fsrs_state = excluded.fsrs_state,
       due = excluded.due,
       reps = excluded.reps,
       lapses = excluded.lapses,
       status = excluded.status,
       last_review = excluded.last_review,
       plan_id = COALESCE(excluded.plan_id, cards.plan_id)`,
    card.unitKey,
    card.surah,
    card.startAyah,
    card.endAyah,
    card.kind,
    card.fsrsState,
    card.due,
    card.reps,
    card.lapses,
    card.status,
    card.createdAt,
    card.lastReview,
    card.planId
  );
}

/**
 * Convenience for practice screens: fetch a card by unit key, creating an
 * unscheduled placeholder card when this is the first encounter.
 */
export async function getOrCreateCard(
  unitKey: string,
  planId: number | null = null
): Promise<CardRow> {
  const existing = await getCard(unitKey);
  if (existing) return existing;
  const match = /^s(\d+):(\d+)-(\d+)$/.exec(unitKey);
  if (!match) throw new Error(`Invalid unit key: ${unitKey}`);
  const surah = Number(match[1]);
  const startAyah = Number(match[2]);
  const endAyah = Number(match[3]);
  const now = Date.now();
  const card: CardRow = {
    unitKey,
    surah,
    startAyah,
    endAyah,
    kind: 'sabaq',
    fsrsState: '',
    due: now,
    reps: 0,
    lapses: 0,
    status: 'new',
    createdAt: now,
    lastReview: null,
    planId,
  };
  await upsertCard(card);
  return card;
}

/** Cards belonging to a day's three blocks (SABAQ first). */
export async function getCardsForDay(day: PlanDayRow): Promise<CardRow[]> {
  const keys = [...new Set([...day.sabaq, ...day.sabqi, ...day.manzil])];
  return getCardsByKeys(keys);
}

/**
 * Like getCardsForDay, but materializes placeholder cards for chunks that have
 * never been scheduled. Practice can then grade every unit in a session.
 */
export async function ensureCardsForDay(
  day: PlanDayRow,
  planId: number | null = day.planId
): Promise<CardRow[]> {
  const keys = [...new Set([...day.sabaq, ...day.sabqi, ...day.manzil])];
  const cards: CardRow[] = [];
  for (const key of keys) {
    cards.push(await getOrCreateCard(key, planId));
  }
  return cards;
}

export async function getDueCount(now: number = Date.now()): Promise<number> {
  await ensureDb();
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM cards WHERE due <= ?',
    now
  );
  return row?.count ?? 0;
}

export async function getCardCounts(): Promise<{ total: number; mastered: number }> {
  await ensureDb();
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number; mastered: number }>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status = 'mastered' THEN 1 ELSE 0 END), 0) AS mastered
       FROM cards`
  );
  return { total: row?.total ?? 0, mastered: row?.mastered ?? 0 };
}

/** Ayahs covered by mastered cards (chunks may cover 1..7 ayahs). */
export async function getMasteredAyahCount(): Promise<number> {
  const cards = await getAllCards();
  return cards
    .filter((c) => c.status === 'mastered')
    .reduce((sum, c) => sum + Math.max(0, c.endAyah - c.startAyah + 1), 0);
}

/** Per-surah mastery derived from chunks. */
export async function getProgress(surah: number): Promise<SurahProgress> {
  const index = getIndex();
  const meta = index.surahs[surah - 1];
  const ayahCount = meta?.ayahCount ?? 0;
  const cards = await getCardsForSurah(surah);
  const masteredCards = cards.filter((c) => c.status === 'mastered');
  // De-duplicate overlapping chunks so percent never exceeds 100.
  const covered = new Array<boolean>(ayahCount).fill(false);
  for (const card of masteredCards) {
    const from = Math.max(1, card.startAyah);
    const to = Math.min(ayahCount, card.endAyah);
    for (let ayah = from; ayah <= to; ayah += 1) covered[ayah - 1] = true;
  }
  const masteredAyahs = covered.filter(Boolean).length;
  return {
    surah,
    ayahCount,
    masteredAyahs,
    totalCards: cards.length,
    masteredCards: masteredCards.length,
    percent: ayahCount > 0 ? Math.min(100, Math.round((masteredAyahs / ayahCount) * 100)) : 0,
  };
}

// ---------------------------------------------------------------------------
// Review logs (+ XP ledger + streak)
// ---------------------------------------------------------------------------

/**
 * Append a review. Also mirrors the XP into `xp_events` and touches the
 * streak, so practice screens only need this one call.
 */
export async function addReviewLog(input: ReviewLogInput): Promise<number> {
  await ensureDb();
  const db = await getDb();
  const at = input.at ?? Date.now();
  const xp = input.xp ?? 0;
  const result = await db.runAsync(
    `INSERT INTO review_logs (card_key, rating, mode, error_count, xp, at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    input.cardKey,
    input.rating,
    input.mode ?? 'recite',
    input.errorCount ?? 0,
    xp,
    at
  );
  if (xp !== 0) {
    try {
      await db.runAsync(
        'INSERT INTO xp_events (amount, reason, at) VALUES (?, ?, ?)',
        xp,
        'review',
        at
      );
    } catch {
      // XP mirroring is best-effort; the review log above is the source of truth.
    }
  }
  try {
    await recordActivity(localDateKey(new Date(at)));
  } catch {
    // A streak write must never lose the review.
  }
  return result.lastInsertRowId;
}

export async function logReview(input: ReviewLogInput): Promise<number> {
  return addReviewLog(input);
}

export async function getReviewCount(): Promise<number> {
  await ensureDb();
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM review_logs'
  );
  return row?.count ?? 0;
}

export async function getReviewLogsSince(since: number): Promise<ReviewLogRow[]> {
  await ensureDb();
  const db = await getDb();
  const rows = await db.getAllAsync<ReviewLogDbRow>(
    'SELECT * FROM review_logs WHERE at >= ? ORDER BY at DESC',
    since
  );
  return rows.map(mapReviewLog);
}

export async function getReviewLogs(limit = 500): Promise<ReviewLogRow[]> {
  await ensureDb();
  const db = await getDb();
  const rows = await db.getAllAsync<ReviewLogDbRow>(
    'SELECT * FROM review_logs ORDER BY at DESC LIMIT ?',
    limit
  );
  return rows.map(mapReviewLog);
}

// ---------------------------------------------------------------------------
// XP
// ---------------------------------------------------------------------------

export async function addXp(amount: number, reason: string, at: number = Date.now()): Promise<number> {
  await ensureDb();
  const db = await getDb();
  await db.runAsync('INSERT INTO xp_events (amount, reason, at) VALUES (?, ?, ?)', amount, reason, at);
  return getTotalXp();
}

/** Alias used by some screens that treat XP as an event ledger. */
export const addXpEvent = addXp;

export async function getTotalXp(): Promise<number> {
  await ensureDb();
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM xp_events'
  );
  return row?.total ?? 0;
}

export async function getXpEvents(limit = 100): Promise<XpEventRow[]> {
  await ensureDb();
  const db = await getDb();
  return db.getAllAsync<XpEventRow>(
    'SELECT * FROM xp_events ORDER BY at DESC LIMIT ?',
    limit
  );
}

// ---------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------

export async function getStreak(): Promise<StreakRow> {
  await ensureDb();
  const db = await getDb();
  const row = await db.getFirstAsync<StreakDbRow>('SELECT * FROM streaks WHERE id = 1');
  if (row) return mapStreak(row);
  const fallback: StreakRow = { current: 0, best: 0, freezes: 1, lastActive: null };
  await db.runAsync(
    'INSERT OR IGNORE INTO streaks (id, current, best, freezes, last_active) VALUES (1, 0, 0, 1, NULL)'
  );
  return fallback;
}

export async function updateStreak(patch: Partial<StreakRow>): Promise<StreakRow> {
  const current = await getStreak();
  const next: StreakRow = {
    current: patch.current ?? current.current,
    best: patch.best ?? current.best,
    freezes: patch.freezes ?? current.freezes,
    lastActive: patch.lastActive !== undefined ? patch.lastActive : current.lastActive,
  };
  const db = await getDb();
  await db.runAsync(
    'UPDATE streaks SET current = ?, best = ?, freezes = ?, last_active = ? WHERE id = 1',
    next.current,
    next.best,
    next.freezes,
    next.lastActive
  );
  return next;
}

/**
 * Mark activity for a local day: +1 when the previous activity was yesterday,
 * consumes a freeze when exactly one day was missed, otherwise restarts at 1.
 */
export async function recordActivity(localDate: string = localDateKey()): Promise<StreakRow> {
  const streak = await getStreak();
  if (streak.lastActive === localDate) return streak;
  if (streak.lastActive && streak.lastActive > localDate) return streak; // clock moved backwards

  let current = 1;
  let freezes = streak.freezes;
  if (streak.lastActive) {
    if (addDaysToKey(streak.lastActive, 1) === localDate) {
      current = streak.current + 1;
    } else if (addDaysToKey(streak.lastActive, 2) === localDate && freezes > 0) {
      current = streak.current + 1;
      freezes -= 1;
    }
  }
  return updateStreak({
    current,
    best: Math.max(streak.best, current),
    freezes,
    lastActive: localDate,
  });
}

/** Spend one freeze to keep the streak alive (used by a future reminder flow). */
export async function useStreakFreeze(): Promise<StreakRow> {
  const streak = await getStreak();
  if (streak.freezes <= 0) return streak;
  return updateStreak({ freezes: streak.freezes - 1 });
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export async function createChallenge(input: CreateChallengeInput): Promise<ChallengeRow> {
  await ensureDb();
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO challenges (title, surah_from, surah_to, days, deadline, code, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    input.title,
    input.surahFrom,
    input.surahTo,
    input.days,
    String(input.deadline),
    input.code,
    Date.now()
  );
  const row = await db.getFirstAsync<ChallengeDbRow>(
    'SELECT * FROM challenges WHERE id = ?',
    [result.lastInsertRowId]
  );
  if (!row) throw new Error('Could not create challenge');
  return mapChallenge(row);
}

export async function getChallenges(): Promise<ChallengeRow[]> {
  await ensureDb();
  const db = await getDb();
  const rows = await db.getAllAsync<ChallengeDbRow>(
    'SELECT * FROM challenges ORDER BY created_at DESC'
  );
  return rows.map(mapChallenge);
}

export async function completeChallenge(
  challengeId: number,
  at: number = Date.now()
): Promise<void> {
  await ensureDb();
  const db = await getDb();
  await db.runAsync('UPDATE challenges SET completed_at = ? WHERE id = ?', at, challengeId);
}
