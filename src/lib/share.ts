/**
 * Sharing helpers for the social screen (M6).
 *
 * Everything is local-first: no accounts and no server round-trips. WhatsApp
 * sharing goes through the public wa.me deep link, other targets use the
 * platform share sheet, and web falls back to the clipboard (then a prompt)
 * when the Web Share API is unavailable.
 */

import { Platform, Share } from 'react-native';

import { getIndex } from '@/data/quran';

export const APP_URL = 'https://anasmofleh.github.io/muhafiz/';

export type ShareMethod = 'shared' | 'copied' | 'prompt' | 'dismissed' | 'error';

export interface ShareResult {
  /** Which mechanism actually handled the text. */
  method: ShareMethod;
  /** Short, user-facing confirmation (e.g. "Copied!"); empty when dismissed. */
  message: string;
}

/** Invite copy for the app itself. */
export function appShareText(): string {
  return "I'm memorizing Quran with Muhafiz — plan, reminders and practice modes: " + APP_URL;
}

function surahRangeLabel(surahFrom: number, surahTo: number): string {
  const surahs = getIndex().surahs;
  const from = surahs[Math.min(114, Math.max(1, surahFrom)) - 1];
  const to = surahs[Math.min(114, Math.max(1, surahTo)) - 1];
  const fromName = from?.englishName ?? `Surah ${surahFrom}`;
  const toName = to?.englishName ?? `Surah ${surahTo}`;
  return surahFrom === surahTo ? fromName : `${fromName} – ${toName}`;
}

/** Short invite that carries the challenge code AND its full scope, e.g. for
 *  WhatsApp. The machine-readable `CH:` payload lets the joiner reconstruct the
 *  same title/range/duration instead of defaulting to the whole Quran. */
export function challengeShareText(c: {
  title: string;
  surahFrom: number;
  surahTo: number;
  days: number;
  code: string;
}): string {
  const range = surahRangeLabel(c.surahFrom, c.surahTo);
  const payload = `CH:${c.code}:${c.surahFrom}-${c.surahTo}:${c.days}:${encodeURIComponent(c.title)}`;
  return `Quran challenge: ${c.title} (${range}) in ${c.days} days — code ${c.code}. ${payload} Join me on Muhafiz: ${APP_URL}`;
}

/** Multiline "share card" summarizing the user's own progress. */
export function progressCardText(streak: number, xp: number, mastered: number): string {
  const safeStreak = Math.max(0, Math.round(streak));
  const safeXp = Math.max(0, Math.round(xp));
  const safeMastered = Math.max(0, Math.round(mastered));
  return [
    `🔥 ${safeStreak}-day streak`,
    `⭐ ${safeXp} XP`,
    `📖 ${safeMastered} ayahs mastered`,
    '',
    `I'm memorizing Quran with Muhafiz — ${APP_URL}`,
  ].join('\n');
}

/** Deep link that opens WhatsApp with the message prefilled. */
export function waLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

interface WebShareNavigator {
  share?: (data: { text?: string; title?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

async function shareOnWeb(text: string): Promise<ShareResult> {
  const nav =
    typeof navigator !== 'undefined' ? (navigator as unknown as WebShareNavigator) : null;

  if (nav?.share) {
    try {
      await nav.share({ text });
      return { method: 'shared', message: 'Shared!' };
    } catch (error) {
      // The user cancelling the native share sheet is not a failure and must
      // not fall through to a clipboard write.
      if (error instanceof Error && error.name === 'AbortError') {
        return { method: 'dismissed', message: '' };
      }
    }
  }

  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(text);
      return { method: 'copied', message: 'Copied!' };
    } catch {
      // Clipboard permissions can be denied on insecure origins; use the prompt.
    }
  }

  if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
    window.prompt('Copy this message:', text);
    return { method: 'prompt', message: 'Message ready to copy' };
  }

  return { method: 'error', message: 'Sharing is not available on this device.' };
}

/**
 * Share plain text through the best mechanism the device offers.
 * The returned `message` is safe to show directly as UI feedback.
 */
export async function shareText(text: string): Promise<ShareResult> {
  if (Platform.OS === 'web') {
    return shareOnWeb(text);
  }

  try {
    const result = await Share.share({ message: text });
    if (result.action === Share.dismissedAction) {
      return { method: 'dismissed', message: '' };
    }
    return { method: 'shared', message: 'Shared!' };
  } catch {
    return { method: 'error', message: 'Could not open the share sheet.' };
  }
}
