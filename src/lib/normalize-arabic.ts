// Arabic text normalization used by the recitation checker.
//
// The speech-to-text transcript and the Hafs ayah text are written with
// different orthography (diacritics, hamza forms, ta-marbuta, etc.). We reduce
// both sides to a comparable skeleton before running word-level alignment.
//
// This module is deliberately dependency-free so it can be unit-tested and
// used anywhere (native, web, or a script).

/** Arabic combining marks, Quranic annotation marks and superscript alef. */
const COMBINING_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

/** Tatweel (kashida) is decorative and never phonemic. */
const TATWEEL = /\u0640/g;

/** Alef variants -> bare alef. */
const ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/g;
const ALEF_MAKSURA = /\u0649/g;
const TA_MARBUTA = /\u0629/g;
const WAW_HAMZA = /\u0624/g;
const YA_HAMZA = /\u0626/g;
const STANDALONE_HAMZA = /\u0621/g;

/**
 * Punctuation, Arabic-Indic digits, Latin digits, symbols and any other
 * character that is not an Arabic letter or whitespace. Everything outside
 * the letter blocks is replaced with a space so glued words are split.
 */
const NON_ARABIC_LETTERS =
  /[^\u0621-\u064A\u066E-\u066F\u0671-\u06D3\u06FA-\u06FF\s]/g;

const BASMALA_FIRST_WORD = '\u0628\u0633\u0645';
const TAWWUDH_STARTS = [
  '\u0627\u0639\u0648\u0630',
  '\u0627\u0633\u062A\u0639\u064A\u0630',
];
const RAHEEM_ACCURSED = '\u0627\u0644\u0631\u062C\u064A\u0645';

/** Character-level normalization (no phrase stripping). */
function normalizeChars(input: string): string {
  let text = input.normalize('NFC');

  // Strip harakat, Quranic marks, superscript alef and tatweel.
  text = text.replace(COMBINING_MARKS, '').replace(TATWEEL, '');

  // Fold letter variants.
  text = text
    .replace(ALEF_VARIANTS, '\u0627')
    .replace(ALEF_MAKSURA, '\u064A')
    .replace(TA_MARBUTA, '\u0647')
    .replace(WAW_HAMZA, '\u0648')
    .replace(YA_HAMZA, '\u064A')
    .replace(STANDALONE_HAMZA, '');

  // Remove punctuation/glyphs and collapse whitespace.
  text = text.replace(NON_ARABIC_LETTERS, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes a single word. Useful when callers already have tokenized text
 * (a one-word phrase must not trigger the basmala/ta'awwudh stripping).
 */
export function normalizeWord(word: string): string {
  return normalizeChars(word);
}

function startsWithTawwudh(word: string): boolean {
  return TAWWUDH_STARTS.some((start) => word.startsWith(start));
}

/**
 * Strips a leading ta'awwudh ("A'udhu billahi min ash-shaytan ir-rajim").
 * The full phrase is five words; if only part of it was transcribed we fall
 * back to removing the first three words, as specified by the checker.
 */
function tawwudhCutLength(words: string[]): number {
  const rajeemIndex = words.slice(0, 6).indexOf(RAHEEM_ACCURSED);
  return rajeemIndex >= 3 ? rajeemIndex + 1 : 3;
}

/**
 * Normalizes Arabic text for word-by-word comparison.
 *
 * - NFC, strips diacritics/Quranic marks/tatweel
 * - folds alef/hamza/ya/ta-marbuta variants
 * - removes punctuation and ayah glyphs
 * - strips a leading basmala and ta'awwudh so reciters who start with them
 *   are not penalized
 */
export function normalizeArabic(text: string): string {
  let words = normalizeChars(text).split(' ').filter(Boolean);

  // Loop because a reciter may say ta'awwudh followed by basmala.
  let changed = true;
  while (changed && words.length > 0) {
    changed = false;

    if (words.length >= 3 && startsWithTawwudh(words[0])) {
      words = words.slice(tawwudhCutLength(words));
      changed = true;
      continue;
    }

    if (words[0] === BASMALA_FIRST_WORD) {
      // "Bismillahi ar-rahmani ar-rahim" is four words.
      words = words.slice(4);
      changed = true;
    }
  }

  return words.join(' ');
}

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const aCode = a.charCodeAt(i - 1);

    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = aCode === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1, // deletion
        current[j - 1] + 1, // insertion
        previous[j - 1] + substitutionCost // substitution
      );
    }

    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length];
}

/**
 * Similarity of two words in [0, 1]: 1 - levenshtein/maxLength.
 * Both words are normalized first, so diacritics do not affect the result.
 */
export function wordSimilarity(a: string, b: string): number {
  const left = normalizeWord(a);
  const right = normalizeWord(b);

  if (left === right) return 1;

  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;

  const distance = levenshtein(left, right);
  return Math.max(0, 1 - distance / maxLength);
}
