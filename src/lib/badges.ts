/**
 * Badges for Muhafiz practice.
 *
 * The catalog is intentionally small and based on state that is already in
 * SQLite (review logs, streaks, XP and card status). Earned keys are cached in
 * AsyncStorage so each badge is celebrated exactly once.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { getIndex } from '@/data/quran';
import * as db from '@/lib/db';
import { localDateKey, type CardRow } from '@/lib/db';

const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'muhafiz-earned-badges';

export interface BadgeProgress {
  mastered: number;
  learning: number;
  reviewing: number;
}

export interface BadgeStreak {
  current: number;
  best: number;
}

export interface BadgeContext {
  reviewCount: number;
  /** Distinct local dates ("YYYY-MM-DD") with at least one review. */
  sessionDates: string[];
  /** True when at least one review happened before 09:00 local time. */
  earlySession: boolean;
  /** True when every ayah of at least one surah is covered by mastered cards. */
  surahMastered: boolean;
}

export type BadgeCheck = (
  progress: BadgeProgress,
  streak: BadgeStreak,
  xp: number,
  context: BadgeContext
) => boolean;

export interface Badge {
  key: string;
  name: string;
  emoji: string;
  description: string;
  check: BadgeCheck;
}

export interface BadgeState {
  progress: BadgeProgress;
  streak: BadgeStreak;
  xp: number;
  /** Review timestamps, used for early-bird and consistent-week. */
  reviews: { at: number }[];
  /** Optional: enables the "whole surah mastered" badge. */
  cards?: CardRow[];
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function hasConsistentWeek(sessionDates: string[]): boolean {
  const days = [...new Set(sessionDates)]
    .map((key) => {
      const [y, m, d] = key.split('-').map(Number);
      if (!y || !m || !d) return Number.NaN;
      return Date.UTC(y, m - 1, d) / DAY_MS;
    })
    .filter((day) => Number.isFinite(day))
    .sort((a, b) => a - b);

  // Seven distinct practice days inside any seven-day window.
  for (let i = 0; i + 6 < days.length; i += 1) {
    if (days[i + 6] - days[i] <= 6) return true;
  }
  return false;
}

export const BADGES: Badge[] = [
  {
    key: 'first-lesson',
    name: 'First Lesson',
    emoji: '\u{1F331}',
    description: 'Finish your first practice review.',
    check: (_progress, _streak, _xp, context) => context.reviewCount > 0,
  },
  {
    key: 'streak-7',
    name: 'Seven-Day Flame',
    emoji: '\u{1F525}',
    description: 'Keep a seven-day practice streak.',
    check: (_progress, streak) => streak.best >= 7,
  },
  {
    key: 'streak-30',
    name: 'Thirty-Day Flame',
    emoji: '\u{1F3C6}',
    description: 'Keep a thirty-day practice streak.',
    check: (_progress, streak) => streak.best >= 30,
  },
  {
    key: 'juz-1-mastered',
    name: 'Hundred Ayahs',
    emoji: '\u{1F4D6}',
    description: 'Master 100 ayahs.',
    check: (progress) => progress.mastered >= 100,
  },
  {
    key: 'surah-mastered',
    name: 'Surah Complete',
    emoji: '⭐',
    description: 'Master every ayah of one surah.',
    check: (_progress, _streak, _xp, context) => context.surahMastered,
  },
  {
    key: 'early-bird',
    name: 'Early Bird',
    emoji: '\u{1F305}',
    description: 'Practice before 9am.',
    check: (_progress, _streak, _xp, context) => context.earlySession,
  },
  {
    key: 'consistent-week',
    name: 'Consistent Week',
    emoji: '\u{1F4C5}',
    description: 'Practice on seven days within one week.',
    check: (_progress, _streak, _xp, context) => hasConsistentWeek(context.sessionDates),
  },
];

// ---------------------------------------------------------------------------
// State collection
// ---------------------------------------------------------------------------

function summarize(cards: CardRow[]): BadgeProgress {
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

function hasMasteredSurah(cards: CardRow[]): boolean {
  const index = getIndex();
  const coverage = new Map<number, boolean[]>();

  for (const card of cards) {
    if (card.status !== 'mastered') continue;
    const meta = index.surahs[card.surah - 1];
    if (!meta) continue;
    let covered = coverage.get(card.surah);
    if (!covered) {
      covered = new Array<boolean>(meta.ayahCount).fill(false);
      coverage.set(card.surah, covered);
    }
    const from = Math.max(1, card.startAyah);
    const to = Math.min(meta.ayahCount, card.endAyah);
    for (let ayah = from; ayah <= to; ayah += 1) covered[ayah - 1] = true;
  }

  for (const covered of coverage.values()) {
    if (covered.length > 0 && covered.every(Boolean)) return true;
  }
  return false;
}

function buildContext(state: BadgeState): BadgeContext {
  const sessionDates = [...new Set(state.reviews.map((review) => localDateKey(new Date(review.at))))];
  const earlySession = state.reviews.some((review) => new Date(review.at).getHours() < 9);
  return {
    reviewCount: state.reviews.length,
    sessionDates,
    earlySession,
    surahMastered: hasMasteredSurah(state.cards ?? []),
  };
}

/** Snapshot everything badges need, in one round of DB reads. */
export async function getBadgeState(): Promise<BadgeState> {
  await db.ensureDb();
  const [cards, streak, xp, reviews] = await Promise.all([
    db.getAllCards(),
    db.getStreak(),
    db.getTotalXp(),
    db.getReviewLogsSince(0),
  ]);

  return {
    progress: summarize(cards),
    streak: { current: streak.current, best: streak.best },
    xp,
    reviews: reviews.map((review) => ({ at: review.at })),
    cards,
  };
}

// ---------------------------------------------------------------------------
// Persistence + awarding
// ---------------------------------------------------------------------------

async function readEarned(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

async function writeEarned(keys: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Badge persistence is a convenience, never a reason to fail a session.
  }
}

/** All badge keys this device has already earned. */
export async function getEarnedBadges(): Promise<string[]> {
  const earned = await readEarned();
  return BADGES.filter((badge) => earned.has(badge.key)).map((badge) => badge.key);
}

/**
 * Compare current state against the catalog and return newly earned keys
 * (also persisting them so they are never awarded twice).
 */
export async function checkBadges(state: BadgeState): Promise<string[]> {
  const earned = await readEarned();
  const context = buildContext(state);

  const newlyEarned = BADGES.filter(
    (badge) =>
      !earned.has(badge.key) && badge.check(state.progress, state.streak, state.xp, context)
  ).map((badge) => badge.key);

  if (newlyEarned.length > 0) {
    for (const key of newlyEarned) earned.add(key);
    await writeEarned(earned);
  }

  return newlyEarned;
}

/** Example: "🌱 First Lesson · 🔥 Seven-Day Flame". */
export function describeBadges(keys: string[]): string {
  return keys
    .map((key) => BADGES.find((badge) => badge.key === key))
    .filter((badge): badge is Badge => Boolean(badge))
    .map((badge) => `${badge.emoji} ${badge.name}`)
    .join(' · ');
}
