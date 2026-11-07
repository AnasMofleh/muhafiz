// Browser smoke check for the deployed Muhafiz web app.
// Run: node scripts/browser-check.mjs
// Verifies: Today + onboarding + plan creation, mushaf + real audio playback,
// practice/recite/social/profile/settings screens, deep links, not-found
// state, and collects console errors. Screenshots in scripts/.browser-check/.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '.browser-check');
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.MUHAFIZ_URL ?? 'https://anasmofleh.github.io/muhafiz/';
const errors = [];

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // phone viewport
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

async function fail(label) {
  await page.screenshot({ path: path.join(OUT, `FAIL-${label}.png`) });
  const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log(`   FAIL at ${label}; body text:`, JSON.stringify(body));
  console.log('\nconsole/page errors:', errors.length === 0 ? 'none' : errors.join('\n  '));
  await browser.close();
  process.exit(1);
}

// 1. Today screen (home) — fresh profile shows the welcome card
console.log('1. Today welcome card');
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
try {
  await page.waitForSelector('[data-testid="today-create-plan"]', { timeout: 30000 });
} catch {
  await fail('today-welcome');
}
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(OUT, '1-today-welcome.png') });
console.log('   Today welcome card rendered');

// 2. Onboarding wizard -> plan creation
console.log('2. onboarding + plan creation');
await page.click('[data-testid="today-create-plan"]');
try {
  await page.waitForSelector('[data-testid="onboarding-next"]', { timeout: 30000 });
  // Step 1: pick the whole Quran, confirm on the goal-details page.
  await page.click('[data-testid="goal-quran"]');
  await page.waitForTimeout(500);
  await page.click('text=Continue');
  await page.waitForTimeout(500);
  for (let step = 0; step < 3; step++) {
    const next = page.locator('[data-testid="onboarding-next"]');
    if (await next.isVisible()) await next.click();
    await page.waitForTimeout(400);
  }
  const finish = page.locator('[data-testid="onboarding-finish"]');
  if (await finish.isVisible()) await finish.click();
  await page.waitForSelector('[data-testid="today-start"]', { timeout: 30000 });
} catch {
  await fail('onboarding');
}
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, '2-today.png') });
console.log('   plan created, Today blocks rendered');

// 3. Mushaf: surah list -> Al-Faatiha -> tap ayah -> REAL audio playback
console.log('3. mushaf + audio playback');
await page.goto(`${BASE}mushaf`, { waitUntil: 'networkidle', timeout: 60000 });
try {
  await page.waitForSelector('[data-testid="surah-1"]', { timeout: 30000 });
} catch {
  await fail('mushaf-list');
}
await page.click('[data-testid="surah-1"]');
try {
  await page.waitForSelector('[data-testid="ayah-1"]', { timeout: 30000 });
} catch {
  await fail('mushaf');
}
await page.evaluate(() => {
  window.__muhafizAudios = [];
  const Orig = window.Audio;
  window.Audio = function (...args) {
    const el = new Orig(...args);
    window.__muhafizAudios.push(el);
    return el;
  };
  window.Audio.prototype = Orig.prototype;
});
await page.click('[data-testid="ayah-1"]');
try {
  await page.waitForSelector('text=Mahmoud Khalil Al-Husary', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const a = (window.__muhafizAudios ?? []).find((x) => x.src.includes('001001'));
      return a && !a.paused && a.currentTime > 0;
    },
    { timeout: 25000 }
  );
  const t0 = await page.evaluate(
    () => (window.__muhafizAudios.find((x) => x.src.includes('001001')) ?? {}).currentTime ?? 0
  );
  await page.waitForTimeout(1200);
  const t1 = await page.evaluate(
    () => (window.__muhafizAudios.find((x) => x.src.includes('001001')) ?? {}).currentTime ?? 0
  );
  if (!(t1 > t0)) throw new Error(`audio not advancing: ${t0} -> ${t1}`);
  console.log(`   mushaf rendered, audio playing (${t0.toFixed(2)}s -> ${t1.toFixed(2)}s)`);
} catch (e) {
  errors.push('AUDIO ASSERT: ' + e.message);
  await fail('audio-playback');
}
await page.screenshot({ path: path.join(OUT, '3-mushaf-audio.png') });

// 4. Deep link: full page reload at a surah route
console.log('4. deep-link reload at /surah/2');
await page.goto(`${BASE}surah/2`, { waitUntil: 'networkidle', timeout: 60000 });
try {
  await page.waitForSelector('[data-testid="ayah-1"]', { timeout: 30000 });
} catch {
  await fail('deep-link');
}
console.log('   deep link rendered (Al-Baqarah)');

// 5. Invalid surah -> not-found state
console.log('5. invalid surah deep link');
await page.goto(`${BASE}surah/999`, { waitUntil: 'networkidle', timeout: 60000 });
try {
  await page.waitForSelector('text=Surah not found', { timeout: 30000 });
} catch {
  await fail('invalid-surah');
}
console.log('   not-found state rendered');

// 6. Practice mode picker
await page.goto(`${BASE}practice`, { waitUntil: 'networkidle', timeout: 60000 });
try {
  await page.waitForSelector('[data-testid="practice-start-today"]', { timeout: 30000 });
} catch {
  await fail('practice');
}
console.log('   practice picker rendered');

// 7. Recite screen — record button AND self-grade render without any ASR
await page.goto(`${BASE}recite`, { waitUntil: 'networkidle', timeout: 60000 });
try {
  await page.waitForSelector('[data-testid="recite-record"]', { timeout: 30000 });
  await page.waitForSelector('[data-testid="recite-grade-good"]', { timeout: 15000 });
} catch {
  await fail('recite');
}
console.log('   recite + self-grade rendered (no ASR needed)');

// 8. Social screen
await page.goto(`${BASE}social`, { waitUntil: 'networkidle', timeout: 60000 });
try {
  await page.waitForSelector('[data-testid="social-title-input"]', { timeout: 30000 });
} catch {
  await fail('social');
}
console.log('   social screen rendered');

// 9. Profile with badge catalog
await page.goto(`${BASE}profile`, { waitUntil: 'networkidle', timeout: 60000 });
try {
  await page.waitForSelector('text=Seven-Day Flame', { timeout: 30000 });
} catch {
  await fail('profile-badges');
}
console.log('   profile badges rendered');

// 10. Settings with reminders section
await page.goto(`${BASE}settings`, { waitUntil: 'networkidle', timeout: 60000 });
try {
  await page.waitForSelector('[data-testid="remind-enable"]', { timeout: 30000 });
} catch {
  await fail('settings-reminders');
}
console.log('   settings reminders rendered');

console.log('\nconsole/page errors:', errors.length === 0 ? 'none' : errors.join('\n  '));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
