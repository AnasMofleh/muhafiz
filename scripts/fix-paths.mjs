// Rewrites root-absolute asset references in the static web export to the
// GitHub Pages base path (app.json `expo.extra.webBasePath`, env-overridable
// via EXPO_BASE_URL).
//
// Why: Expo SDK 58's CLI never wires EXPO_BASE_URL into the bundle (a
// regression), so the export contains `/_expo/...` and `/favicon.ico`
// references that 404 under the project-page subpath. Rewriting them to
// ABSOLUTE `/<base>/...` paths works at any URL depth (relative `./` paths
// would break on deep links like /muhafiz/surah/2).
//
// Run after `expo export --platform web`: node scripts/fix-paths.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
const base = (process.env.EXPO_BASE_URL || appJson?.expo?.extra?.webBasePath || '').replace(/\/+$/, '');

const JS_DIR = path.join(DIST, '_expo', 'static', 'js', 'web');
const CSS_DIR = path.join(DIST, '_expo', 'static', 'css');
const INDEX = path.join(DIST, 'index.html');

const rewrite = (text) =>
  text
    .replaceAll('"/_expo', `"${base}/_expo`)
    .replaceAll("'/_expo", `'${base}/_expo`)
    .replaceAll('"/assets/', `"${base}/assets/`)
    .replaceAll("'/assets/", `'${base}/assets/`)
    .replaceAll('"/favicon.ico"', `"${base}/favicon.ico"`)
    .replaceAll("'/favicon.ico'", `'${base}/favicon.ico'`);

let files = 0;
let replacements = 0;

const rewriteFile = (file) => {
  const before = fs.readFileSync(file, 'utf8');
  const after = rewrite(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    files += 1;
    replacements += (before.match(/\/_expo|\/favicon\.ico/g) ?? []).length;
  }
};

for (const dir of [JS_DIR, CSS_DIR]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.js') || f.endsWith('.css')) rewriteFile(path.join(dir, f));
  }
}
rewriteFile(INDEX);

// SPA fallback for GitHub Pages deep links.
fs.copyFileSync(INDEX, path.join(DIST, '404.html'));

console.log(`fix-paths: base="${base}" — ${files} files rewritten, ~${replacements} references, 404.html copied`);
