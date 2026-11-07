// Builds the bundled Quran data from the alquran.cloud API (Tanzil texts).
// Produces:
//   assets/data/quran/index.json          — surah metadata, prefix sums, juz starts
//   assets/data/quran/surah-XXX.json      — per-surah ayahs (Uthmani + Imlaei texts)
//   src/data/surah-map.ts                 — generated async lazy loader (code-split per surah)
// Run: node scripts/build-quran-data.mjs
//
// License: Quran text © Tanzil Project (Hafs 'an 'Asim, Uthmani script),
// distributed under CC BY-ND 3.0 — https://tanzil.net/docs/terms_of_service
// Attribution is required: kept in README.md and the in-app licenses screen.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '.cache');
const OUT_DIR = path.join(__dirname, '..', 'assets', 'data', 'quran');
const STAGING_DIR = path.join(__dirname, '.staging-quran');

const UTHMANI_URL = 'https://api.alquran.cloud/v1/quran/quran-uthmani';
const SIMPLE_URL = 'https://api.alquran.cloud/v1/quran/quran-simple';

// Basmala first word, ALL combining marks removed ('بسم' = U+0628 U+0633 U+0645).
// Compared against a diacritic-stripped first word to handle spelling variants
// like surahs 95/97 whose opening basmala carries an extra shadda.
const BASMALA_FIRST_WORD = 'بسم'; // bism
const BASMALA_WORDS = 4;
const COMBINING_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const HAS_ARABIC_LETTER = /[ء-ي٠-٩۰-۹]/;

function cleanText(text) {
  // Remove BOM/zero-width chars present in the source data.
  return text.replace(/[﻿​-‍⁠]/g, '');
}

function stripDiacritics(text) {
  return text.replace(COMBINING_MARKS, '');
}

function stripBasmala(text) {
  // Remove the leading full basmala (4 words) from surah-opening ayahs,
  // diacritic-insensitively. Kept for 1:1 (the basmala IS the ayah).
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > BASMALA_WORDS && stripDiacritics(words[0]) === BASMALA_FIRST_WORD) {
    return words.slice(BASMALA_WORDS).join(' ');
  }
  return text;
}

function countWords(text) {
  // Count lexical words only — standalone waqf/ornament marks (ۖ ۗ ۚ ۞ …)
  // are not words and would skew capacity math.
  return text.split(/\s+/).filter((t) => HAS_ARABIC_LETTER.test(t)).length;
}

async function fetchJson(url, cacheFile) {
  const cachePath = path.join(CACHE_DIR, cacheFile);
  if (fs.existsSync(cachePath)) {
    console.log(`  using cache: ${cacheFile}`);
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }
  console.log(`  downloading: ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'muhafiz-data-builder/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  if (json.code !== 200 || !json.data) throw new Error(`Bad API response for ${url}`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(json));
  return json;
}

const uthmani = await fetchJson(UTHMANI_URL, 'quran-uthmani.json');
const simple = await fetchJson(SIMPLE_URL, 'quran-simple.json');

const surahsU = uthmani.data.surahs;
const surahsS = simple.data.surahs;
if (surahsU.length !== 114 || surahsS.length !== 114) {
  throw new Error(`Unexpected surah counts: ${surahsU.length} / ${surahsS.length}`);
}

// ---- Build into a staging directory; only publish after validation ----
fs.rmSync(STAGING_DIR, { recursive: true, force: true });
fs.mkdirSync(STAGING_DIR, { recursive: true });

const index = { surahs: [], ayahCount: 0, wordCount: 0, surahPrefix: [0], juzStarts: [] };
let globalAyahs = 0;
let globalWords = 0;
let sajdaCount = 0;

for (let i = 0; i < 114; i++) {
  const su = surahsU[i];
  const ss = surahsS[i];
  const number = su.number;
  if (number !== ss.number || su.ayahs.length !== ss.ayahs.length) {
    throw new Error(`Mismatch in surah ${number}`);
  }

  const keepBasmala = number === 1; // 1:1 is the basmala itself; surah 9 has none
  const ayahs = su.ayahs.map((a, idx) => {
    const sa = ss.ayahs[idx];
    let textUthmani = cleanText(a.text);
    let textSimple = cleanText(sa.text);
    let basmalaStripped = false;
    if (a.numberInSurah === 1 && !keepBasmala && stripDiacritics(textUthmani.split(/\s+/)[0] ?? '') === BASMALA_FIRST_WORD) {
      textUthmani = stripBasmala(textUthmani);
      textSimple = stripBasmala(textSimple);
      basmalaStripped = true;
    }
    const isSajda = a.sajda !== false; // API returns an object for sajda ayahs, false otherwise
    if (isSajda) sajdaCount++;
    return {
      number: a.numberInSurah,
      text_uthmani: textUthmani,
      text_simple: textSimple,
      juz: a.juz,
      page: a.page,
      hizbQuarter: a.hizbQuarter,
      sajda: isSajda,
      wordCount: countWords(textSimple),
      basmalaStripped,
    };
  });

  const totalWords = ayahs.reduce((n, a) => n + a.wordCount, 0);
  const surahMeta = {
    number,
    name: su.name,
    englishName: su.englishName,
    englishNameTranslation: su.englishNameTranslation,
    revelationType: su.revelationType,
    ayahCount: su.ayahs.length,
    wordCount: totalWords,
  };
  index.surahs.push(surahMeta);
  index.ayahCount += ayahs.length;
  index.wordCount += totalWords;
  index.surahPrefix.push(index.ayahCount); // ayahs before surah (number+1)
  globalAyahs += ayahs.length;
  globalWords += totalWords;

  // Record juz boundaries: first ayah (by global number) of each juz.
  for (const a of ayahs) {
    const juz = a.juz;
    if (!index.juzStarts[juz - 1]) {
      index.juzStarts[juz - 1] = globalAyahNumber(index, number, a.number);
    }
  }

  const outFile = path.join(STAGING_DIR, `surah-${String(number).padStart(3, '0')}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ ...surahMeta, ayahs }));
  console.log(`surah ${String(number).padStart(3, '0')}: ${su.ayahs.length} ayahs, ${totalWords} words`);
}

// ---- Validation before publishing ----
if (globalAyahs !== 6236) throw new Error(`Expected 6236 ayahs, got ${globalAyahs}`);
if (index.juzStarts.length !== 30 || index.juzStarts.some((n) => !n)) {
  throw new Error(`Bad juz boundaries: ${index.juzStarts.length} found`);
}
if (sajdaCount !== 15) throw new Error(`Expected 15 sajda ayahs, got ${sajdaCount}`);
for (let n = 1; n <= 114; n++) {
  const file = path.join(STAGING_DIR, `surah-${String(n).padStart(3, '0')}.json`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.number !== n || data.ayahs.length !== data.ayahCount || data.ayahs.some((a, i) => a.number !== i + 1)) {
    throw new Error(`Structure validation failed for surah ${n}`);
  }
}

// ---- Publish atomically ----
fs.writeFileSync(path.join(STAGING_DIR, 'index.json'), JSON.stringify(index));
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.renameSync(STAGING_DIR, OUT_DIR);
console.log(`\nPublished: ${index.ayahCount} ayahs, ${index.wordCount} words, ${sajdaCount} sajda, 30 juz -> ${path.relative(__dirname, OUT_DIR)}`);

// ---- Generate the async lazy loader (per-surah code splitting) ----
const mapLines = [
  '// GENERATED by scripts/build-quran-data.mjs — do not edit by hand.',
  "import type { SurahData } from './types';",
  '',
  '/** Loads one surah on demand (Metro code-splits each JSON into its own chunk).',
  ' *  Returns undefined for invalid numbers. */',
  'export async function getSurah(number: number): Promise<SurahData | undefined> {',
  '  if (!Number.isInteger(number) || number < 1 || number > 114) return undefined;',
  '  switch (number) {',
];
for (let n = 1; n <= 114; n++) {
  const padded = String(n).padStart(3, '0');
  mapLines.push(`    case ${n}: return ((await import('../../assets/data/quran/surah-${padded}.json')) as { default: SurahData }).default;`);
}
mapLines.push('    default: return undefined;', '  }', '}', '');
fs.writeFileSync(path.join(__dirname, '..', 'src', 'data', 'surah-map.ts'), mapLines.join('\n'));
console.log('generated src/data/surah-map.ts');

function globalAyahNumber(idx, surah, ayah) {
  return (idx.surahPrefix[surah - 1] ?? 0) + ayah;
}
