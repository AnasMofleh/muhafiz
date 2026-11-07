/**
 * XP + level curves for Muhafiz.
 *
 * XP is intentionally simple and deterministic so the same review always
 * earns the same amount across devices.
 */

export type Rating = 1 | 2 | 3 | 4;

/**
 * XP for a review: Again 0, Hard 5, Good 10, Easy 15, minus one point per
 * error (never below zero).
 */
export function xpForRating(rating: Rating | number, errorCount = 0): number {
  const base = rating === 1 ? 0 : rating === 2 ? 5 : rating === 3 ? 10 : rating === 4 ? 15 : 0;
  const errors = Math.max(0, Math.round(errorCount));
  return Math.max(0, base - errors);
}

export interface LevelInfo {
  level: number;
  /** Progress towards the next level, 0..1. */
  progress: number;
}

/** Level = floor(sqrt(xp / 50)) + 1. */
export function levelForXp(xp: number): LevelInfo {
  const safeXp = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  const level = Math.floor(Math.sqrt(safeXp / 50)) + 1;
  const currentFloor = (level - 1) * (level - 1) * 50;
  const nextFloor = level * level * 50;
  const span = nextFloor - currentFloor;
  const progress = span > 0 ? Math.min(1, Math.max(0, (safeXp - currentFloor) / span)) : 0;
  return { level, progress };
}

/** XP still needed to reach the next level. */
export function xpToNextLevel(xp: number): number {
  const { level } = levelForXp(xp);
  const nextFloor = level * level * 50;
  return Math.max(0, Math.ceil(nextFloor - Math.max(0, xp)));
}
