// Builds sudoku.html (one file, game.html with solver/solver.js inlined) and the installable copy (pwa/): a full HTML document plus manifest, service worker and icons.
const fs = require('fs'), path = require('path');
const dir = __dirname, out = path.join(dir, 'pwa');
const solver = fs.readFileSync(path.join(dir, 'solver', 'solver.js'), 'utf8').replace(/\nif \(typeof module[^\n]*\n?$/, '\n');
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const src = fs.readFileSync(path.join(dir, 'game.html'), 'utf8').replace('/*SOLVER*/', () => solver).replace('__BUILD__', stamp);
fs.writeFileSync(path.join(dir, 'sudoku.html'), src);
const cut = src.indexOf('<div class="app">');
const head = src.slice(0, cut).replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '');
const body = src.slice(cut);
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Sudoku">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="#edf0f5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#10141b" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" href="icon-180.png">
<style>:root{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>
${head}</head>
<body>
${body}</body>
</html>
`;
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
  name: 'Sudoku', short_name: 'Sudoku', start_url: './', scope: './', display: 'standalone',
  background_color: '#edf0f5', theme_color: '#edf0f5',
  icons: [{ src: 'icon-180.png', sizes: '180x180', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
}, null, 2));
const h = require('crypto').createHash('sha1').update(html);
for (const f of ['manifest.webmanifest', 'icon-180.png', 'icon-512.png']) h.update(fs.readFileSync(path.join(out, f)));
const version = h.digest('hex').slice(0, 8);
fs.writeFileSync(path.join(out, 'sw.js'), `// Keeps the game's files on the device so it opens with no connection. Version changes whenever the game changes.
const CACHE = 'sudoku-${version}';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
`);
console.log('built', version, stamp);
