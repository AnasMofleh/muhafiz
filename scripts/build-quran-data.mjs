// Builds the bundled Quran data from the alquran.cloud API (Tanzil texts).
// Produces:
//   assets/data/quran/index.json          — surah metadata + global stats
//   assets/data/quran/surah-XXX.json      — per-surah ayahs (Uthmani + Imlaei texts)
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

const UTHMANI_URL = 'https://api.alquran.cloud/v1/quran/quran-uthmani';
const SIMPLE_URL = 'https://api.alquran.cloud/v1/quran/quran-simple';

// 'بِسْمِ' = bismi (first word of the basmala)
const BASMALA_FIRST_WORD = 'بِسْمِ';
const BASMALA_WORDS = 4;

function cleanText(text) {
  // Remove BOM/zero-width chars present in the source data.
  return text.replace(/[﻿​-‍⁠]/g, '');
}

function stripBasmala(text) {
  // Remove the leading full basmala (4 words) from surah-opening ayahs.
  // Kept for 1:1 (the basmala IS the ayah) and 9:1 (no basmala).
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > BASMALA_WORDS && words[0] === BASMALA_FIRST_WORD) {
    return words.slice(BASMALA_WORDS).join(' ');
  }
  return text;
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

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

const uthmani = await fetchJson(UTHMANI_URL, 'quran-uthmani.json');
const simple = await fetchJson(SIMPLE_URL, 'quran-simple.json');

const surahsU = uthmani.data.surahs;
const surahsS = simple.data.surahs;
if (surahsU.length !== 114 || surahsS.length !== 114) {
  throw new Error(`Unexpected surah counts: ${surahsU.length} / ${surahsS.length}`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const index = { surahs: [], ayahCount: 0, wordCount: 0 };
let globalAyahs = 0;

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
    if (a.numberInSurah === 1 && !keepBasmala && textUthmani.startsWith(BASMALA_FIRST_WORD)) {
      textUthmani = stripBasmala(textUthmani);
      textSimple = stripBasmala(textSimple);
      basmalaStripped = true;
    }
    return {
      number: a.numberInSurah,
      text_uthmani: textUthmani,
      text_simple: textSimple,
      juz: a.juz,
      page: a.page,
      hizbQuarter: a.hizbQuarter,
      sajda: a.sajda === true,
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
  globalAyahs += ayahs.length;

  const outFile = path.join(OUT_DIR, `surah-${String(number).padStart(3, '0')}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ ...surahMeta, ayahs }));
  console.log(`surah ${String(number).padStart(3, '0')}: ${su.ayahs.length} ayahs, ${totalWords} words`);
}

if (globalAyahs !== 6236) {
  throw new Error(`Expected 6236 ayahs, got ${globalAyahs}`);
}

fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index));
console.log(`\nDone: ${index.ayahCount} ayahs, ${index.wordCount} words -> ${path.relative(__dirname, OUT_DIR)}`);
