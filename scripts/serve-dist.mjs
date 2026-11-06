// Serves the static web export (dist/) under the GitHub Pages subpath,
// with SPA fallback to index.html — mirrors what GitHub Pages does via
// dist/404.html. Run: node scripts/serve-dist.mjs [port]
//   MUHAFIZ_URL=http://localhost:8123/muhafiz/ node scripts/browser-check.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = Number(process.argv[2] ?? 8123);
const BASE = '/muhafiz';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    // Strict subpath: anything outside BASE 404s, like the real GitHub Pages site.
    if (!p.startsWith(BASE)) {
      res.writeHead(404);
      res.end('outside base path');
      return;
    }
    p = p.slice(BASE.length);
    if (p === '/' || p === '') p = '/index.html';

    const file = path.join(DIST, p);
    fs.readFile(file, (err, data) => {
      if (err) {
        // SPA fallback: any unknown path serves index.html (like dist/404.html on Pages)
        fs.readFile(path.join(DIST, 'index.html'), (err2, html) => {
          if (err2) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`serving dist at http://localhost:${PORT}${BASE}/`));
