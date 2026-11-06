// Browser smoke check for the deployed Muhafiz web app.
// Run: node scripts/browser-check.mjs
// Verifies: surah list renders, mushaf opens, player bar appears on tap,
// and collects console errors. Screenshots land in scripts/.browser-check/.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '.browser-check');
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.MUHAFIZ_URL ?? 'https://anasmofleh.github.io/muhafiz/';
const errors = [];

const browser = await chromium.launch();
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

// 1. Surah list
console.log('1. navigating to', BASE);
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
try {
  await page.waitForSelector('[data-testid="surah-1"]', { timeout: 30000 });
} catch {
  await fail('surah-list');
}
await page.waitForTimeout(1500); // let fonts settle
await page.screenshot({ path: path.join(OUT, '1-surah-list.png') });
console.log('   surah list rendered');

// 2. Open Al-Faatiha
await page.click('[data-testid="surah-1"]');
try {
  await page.waitForSelector('[data-testid="ayah-1"]', { timeout: 30000 });
} catch {
  await fail('mushaf');
}
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '2-mushaf-fatiha.png') });
console.log('   mushaf opened (Al-Faatiha)');

// 3. Tap ayah 1 -> player bar should appear
await page.click('[data-testid="ayah-1"]');
try {
  await page.waitForSelector('text=Mahmoud Khalil Al-Husary', { timeout: 15000 });
} catch {
  await fail('player-bar');
}
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '3-player-bar.png') });
console.log('   player bar appeared');

// 4. Back to list, open Al-Baqarah (286 ayahs, virtualization)
await page.click('[aria-label="Back"]').catch(async () => {
  await page.goBack();
});
try {
  await page.waitForSelector('[data-testid="surah-2"]', { timeout: 15000 });
  await page.click('[data-testid="surah-2"]');
} catch {
  await fail('back-to-list');
}
try {
  await page.waitForSelector('[data-testid="ayah-2"]', { timeout: 30000 });
} catch {
  await fail('baqarah');
}
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, '4-baqarah.png') });
console.log('   Al-Baqarah opened');

// 5. Settings screen
await page.goBack();
try {
  await page.waitForSelector('[aria-label="Settings"]', { timeout: 15000 });
  await page.click('[aria-label="Settings"]');
  await page.waitForSelector('text=Settings', { timeout: 15000 });
} catch {
  await fail('settings');
}
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, '5-settings.png') });
console.log('   settings opened');

console.log('\nconsole/page errors:', errors.length === 0 ? 'none' : errors.join('\n  '));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
