// Word-level alignment for the recitation checker.
//
// Target words come from the Hafs ayah text; heard words come from the
// speech-to-text transcript. We use a global Needleman-Wunsch alignment so a
// skipped or inserted word does not shift everything after it. When the
// reciter clearly recited only a subset of the ayah (for example they stopped
// early), Smith-Waterman finds the best local overlap and the unaligned target
// words are reported as missing.
//
// The output is intentionally presentation-agnostic: the screen decides how
// to color each verdict.

import { normalizeWord, wordSimilarity } from '@/lib/normalize-arabic';

export type WordVerdict = 'correct' | 'uncertain' | 'wrong' | 'missing' | 'extra';

export interface AlignedWord {
  /** Normalized Arabic token that was compared. */
  text: string;
  verdict: WordVerdict;
  similarity: number;
}

export interface AlignResult {
  words: AlignedWord[];
  /** correct / (target words + extra words), in [0, 1]. */
  score: number;
  /** target words that had any counterpart in the transcript, in [0, 1]. */
  coverage: number;
}

const CORRECT_THRESHOLD = 0.85;
const UNCERTAIN_THRESHOLD = 0.6;

/** A gap is cheaper than a completely unrelated substitution (score -1). */
const GAP_SCORE = -0.45;

type Step =
  | { kind: 'pair'; target: string; heard: string; similarity: number }
  | { kind: 'missing'; target: string }
  | { kind: 'extra'; heard: string };

type Op = 'diag' | 'up' | 'left' | 'zero';

function tokenize(input: string[]): string[] {
  const tokens: string[] = [];

  for (const part of input) {
    for (const token of normalizeWord(part).split(' ')) {
      if (token) tokens.push(token);
    }
  }

  return tokens;
}

/** Substitution reward in [-1, 1]: similar words are positive, unrelated negative. */
function substitutionScore(similarity: number): number {
  return similarity * 2 - 1;
}

function verdictFor(similarity: number): WordVerdict {
  if (similarity >= CORRECT_THRESHOLD) return 'correct';
  if (similarity >= UNCERTAIN_THRESHOLD) return 'uncertain';
  return 'wrong';
}

/** Standard global alignment. */
function needlemanWunsch(target: string[], heard: string[]): Step[] {
  const n = target.length;
  const m = heard.length;

  const scores: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  const ops: Op[][] = Array.from({ length: n + 1 }, () =>
    new Array<Op>(m + 1).fill('zero')
  );

  for (let i = 1; i <= n; i += 1) {
    scores[i][0] = scores[i - 1][0] + GAP_SCORE;
    ops[i][0] = 'up';
  }
  for (let j = 1; j <= m; j += 1) {
    scores[0][j] = scores[0][j - 1] + GAP_SCORE;
    ops[0][j] = 'left';
  }

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const similarity = wordSimilarity(target[i - 1], heard[j - 1]);
      const diagonal = scores[i - 1][j - 1] + substitutionScore(similarity);
      const up = scores[i - 1][j] + GAP_SCORE; // target word missing
      const left = scores[i][j - 1] + GAP_SCORE; // heard word extra

      if (diagonal >= up && diagonal >= left) {
        scores[i][j] = diagonal;
        ops[i][j] = 'diag';
      } else if (up >= left) {
        scores[i][j] = up;
        ops[i][j] = 'up';
      } else {
        scores[i][j] = left;
        ops[i][j] = 'left';
      }
    }
  }

  return traceback(target, heard, ops, n, m);
}

/** Local alignment; used when the transcript covers only part of the ayah. */
function smithWaterman(target: string[], heard: string[]): Step[] {
  const n = target.length;
  const m = heard.length;

  const scores: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  const ops: Op[][] = Array.from({ length: n + 1 }, () =>
    new Array<Op>(m + 1).fill('zero')
  );

  let bestScore = 0;
  let bestI = 0;
  let bestJ = 0;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const similarity = wordSimilarity(target[i - 1], heard[j - 1]);
      const diagonal = scores[i - 1][j - 1] + substitutionScore(similarity);
      const up = scores[i - 1][j] + GAP_SCORE;
      const left = scores[i][j - 1] + GAP_SCORE;
      const value = Math.max(0, diagonal, up, left);

      scores[i][j] = value;

      if (value === 0) {
        ops[i][j] = 'zero';
      } else if (value === diagonal) {
        ops[i][j] = 'diag';
      } else if (value === up) {
        ops[i][j] = 'up';
      } else {
        ops[i][j] = 'left';
      }

      if (value > bestScore) {
        bestScore = value;
        bestI = i;
        bestJ = j;
      }
    }
  }

  // Trace the best local segment back to a zero cell.
  const middle: Step[] = [];
  let i = bestI;
  let j = bestJ;

  while (i > 0 && j > 0 && scores[i][j] > 0 && ops[i][j] !== 'zero') {
    const op = ops[i][j];

    if (op === 'diag') {
      middle.push({
        kind: 'pair',
        target: target[i - 1],
        heard: heard[j - 1],
        similarity: wordSimilarity(target[i - 1], heard[j - 1]),
      });
      i -= 1;
      j -= 1;
    } else if (op === 'up') {
      middle.push({ kind: 'missing', target: target[i - 1] });
      i -= 1;
    } else {
      middle.push({ kind: 'extra', heard: heard[j - 1] });
      j -= 1;
    }
  }

  // `i`/`j` now point at the start of the local segment; `bestI`/`bestJ`
  // point at its end.
  const startI = i;
  const startJ = j;

  const before: Step[] = [];
  for (let k = 0; k < startI; k += 1) {
    before.push({ kind: 'missing', target: target[k] });
  }
  for (let k = 0; k < startJ; k += 1) {
    before.push({ kind: 'extra', heard: heard[k] });
  }

  const after: Step[] = [];
  for (let k = bestI; k < n; k += 1) {
    after.push({ kind: 'missing', target: target[k] });
  }
  for (let k = bestJ; k < m; k += 1) {
    after.push({ kind: 'extra', heard: heard[k] });
  }

  return [...before, ...middle.reverse(), ...after];
}

function traceback(
  target: string[],
  heard: string[],
  ops: Op[][],
  startI: number,
  startJ: number
): Step[] {
  const steps: Step[] = [];
  let i = startI;
  let j = startJ;

  while (i > 0 || j > 0) {
    const op = ops[i][j];

    if (op === 'diag') {
      steps.push({
        kind: 'pair',
        target: target[i - 1],
        heard: heard[j - 1],
        similarity: wordSimilarity(target[i - 1], heard[j - 1]),
      });
      i -= 1;
      j -= 1;
    } else if (op === 'up') {
      steps.push({ kind: 'missing', target: target[i - 1] });
      i -= 1;
    } else {
      steps.push({ kind: 'extra', heard: heard[j - 1] });
      j -= 1;
    }
  }

  return steps.reverse();
}

/**
 * True when every heard word can be found, in order, among the target words
 * with at least "uncertain" similarity. That means the reciter recited a
 * subset (typically stopped early), so local alignment is a better fit.
 */
function heardIsTargetSubset(target: string[], heard: string[]): boolean {
  if (heard.length === 0 || heard.length >= target.length) return false;

  let targetIndex = 0;

  for (const heardWord of heard) {
    let matched = false;

    while (targetIndex < target.length) {
      const candidate = target[targetIndex];
      targetIndex += 1;

      if (wordSimilarity(candidate, heardWord) >= UNCERTAIN_THRESHOLD) {
        matched = true;
        break;
      }
    }

    if (!matched) return false;
  }

  return true;
}

function toAlignedWord(step: Step): AlignedWord {
  if (step.kind === 'missing') {
    return { text: step.target, verdict: 'missing', similarity: 0 };
  }
  if (step.kind === 'extra') {
    return { text: step.heard, verdict: 'extra', similarity: 0 };
  }

  return {
    text: step.target,
    verdict: verdictFor(step.similarity),
    similarity: step.similarity,
  };
}

/**
 * Aligns the target ayah words against the words heard in a recording.
 *
 * `target` and `heard` may already be normalized or may be raw words; each
 * token is normalized again here, so both usages are safe.
 */
export function alignWords(target: string[], heard: string[]): AlignResult {
  const targetWords = tokenize(target);
  const heardWords = tokenize(heard);

  if (targetWords.length === 0 && heardWords.length === 0) {
    return { words: [], score: 0, coverage: 0 };
  }

  const steps = heardIsTargetSubset(targetWords, heardWords)
    ? smithWaterman(targetWords, heardWords)
    : needlemanWunsch(targetWords, heardWords);

  const words = steps.map(toAlignedWord);

  let correct = 0;
  let matchedTarget = 0;
  let extras = 0;

  for (const word of words) {
    if (word.verdict === 'extra') {
      extras += 1;
    } else if (word.verdict !== 'missing') {
      matchedTarget += 1;
    }

    if (word.verdict === 'correct') correct += 1;
  }

  const scoreDenominator = targetWords.length + extras;
  const score = scoreDenominator > 0 ? correct / scoreDenominator : 0;
  const coverage = targetWords.length > 0 ? matchedTarget / targetWords.length : 0;

  return { words, score, coverage };
}
