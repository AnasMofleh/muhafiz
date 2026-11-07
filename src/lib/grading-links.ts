/**
 * Local-first grading links: a student shares a grading REQUEST (which
 * ayahs to listen to), a sheikh/friend opens it, marks each ayah, and gets a
 * RESULT payload to send back. The student pastes the result and the grades
 * land in their FSRS schedule. No server involved.
 *
 * Payloads are compact and URL-safe so they survive WhatsApp pasting:
 *   Request: GR:{surah}:{from}-{to}:{seed}
 *   Result:  GRR:{surah}:{from}-{to}:{rating},{rating},... (one per ayah)
 */

import { ensureDb, getCardsForSurah, getOrCreateCard } from '@/lib/db';
import { gradeCardReview } from '@/lib/modes';
import { unitKeyFor, type Rating } from '@/lib/scheduler';

export interface GradingRequest {
  surah: number;
  fromAyah: number;
  toAyah: number;
  /** Random seed identifying this request (kept short). */
  seed: string;
}

export interface GradingResult {
  surah: number;
  fromAyah: number;
  toAyah: number;
  /** ayah number -> FSRS rating. */
  ratings: Record<number, Rating>;
}

const REQUEST_RE = /GR:(\d{1,3}):(\d{1,3})-(\d{1,3}):([A-Z2-9]{6})/;
const RESULT_RE = /GRR:(\d{1,3}):(\d{1,3})-(\d{1,3}):([1-4](?:,[1-4])*)/;

function clampAyah(surah: number, ayah: number): number {
  return Math.min(286, Math.max(1, ayah));
}

/** Human-readable request text + payload, e.g. for a WhatsApp message. */
export function buildGradingRequest(req: GradingRequest, appUrl: string): string {
  const payload = `GR:${req.surah}:${req.fromAyah}-${req.toAyah}:${req.seed}`;
  return `Quran grading request: Surah ${req.surah}, ayahs ${req.fromAyah}-${req.toAyah}. ${payload} Open in Muhafiz to grade: ${appUrl}`;
}

export function parseGradingRequest(text: string): GradingRequest | null {
  const match = REQUEST_RE.exec(text);
  if (!match) return null;
  const surah = Number(match[1]);
  const fromAyah = clampAyah(surah, Number(match[2]));
  const toAyah = Math.max(fromAyah, clampAyah(surah, Number(match[3])));
  return { surah, fromAyah, toAyah, seed: match[4] };
}

/** Human-readable result text + payload, shared back to the student. */
export function buildGradingResult(req: GradingRequest, ratings: Record<number, Rating>): string {
  const list: string[] = [];
  for (let ayah = req.fromAyah; ayah <= req.toAyah; ayah += 1) {
    list.push(String(ratings[ayah] ?? 3));
  }
  const payload = `GRR:${req.surah}:${req.fromAyah}-${req.toAyah}:${list.join(',')}`;
  return `Grading result: Surah ${req.surah}, ayahs ${req.fromAyah}-${req.toAyah} (1=Again, 2=Hard, 3=Good, 4=Easy): ${list.join(', ')}. ${payload}`;
}

export function parseGradingResult(text: string): GradingResult | null {
  const match = RESULT_RE.exec(text);
  if (!match) return null;
  const surah = Number(match[1]);
  const fromAyah = clampAyah(surah, Number(match[2]));
  const toAyah = Math.max(fromAyah, clampAyah(surah, Number(match[3])));
  const values = match[4].split(',').map(Number) as Rating[];
  const ratings: Record<number, Rating> = {};
  let ayah = fromAyah;
  for (const value of values) {
    if (ayah > toAyah) break;
    if (value === 1 || value === 2 || value === 3 || value === 4) {
      ratings[ayah] = value;
    }
    ayah += 1;
  }
  return { surah, fromAyah, toAyah, ratings };
}

/**
 * Apply a shared grading result to the student's FSRS schedule — the same
 * canonical path the practice modes use.
 */
export async function applyGradingResult(
  result: GradingResult
): Promise<{ count: number; xp: number }> {
  await ensureDb();
  const cards = await getCardsForSurah(result.surah);
  let count = 0;
  let xp = 0;
  for (let ayah = result.fromAyah; ayah <= result.toAyah; ayah += 1) {
    const rating = result.ratings[ayah];
    if (!rating) continue;
    let card = cards.find((c) => c.startAyah <= ayah && c.endAyah >= ayah);
    if (!card) {
      card = await getOrCreateCard(unitKeyFor(result.surah, ayah, ayah));
    }
    const graded = await gradeCardReview({ card, rating, mode: 'recite-shared', errorCount: 0 });
    xp += graded.xp;
    count += 1;
  }
  return { count, xp };
}
