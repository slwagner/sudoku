// A game saved by the earlier version (single 'sudoku.game.v1' key) must open in the new version with nothing lost.
const { chromium, devices } = require('playwright');
(async () => {
  const http = require('http'), fs = require('fs'), path = require('path'), root = path.join(__dirname, 'pwa');
  const server = http.createServer((req, res) => { let f = req.url.split('?')[0]; if (f.endsWith('/')) f += 'index.html'; const p = path.join(root, f);
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); res.end(fs.readFileSync(p)); });
  await new Promise(r => server.listen(0, r));
  const b = await chromium.launch(), url = 'http://localhost:' + server.address().port + '/';
  const c1 = await b.newContext({ ...devices['iPhone 13'] }), p1 = await c1.newPage();
  await p1.goto(url); await p1.waitForSelector('.cell');
  const old = await p1.evaluate(() => {
    const s = JSON.parse(JSON.stringify(window.__sudoku.state())), e = s.puzzle.findIndex(v => !v), f = s.puzzle.findIndex((v, i) => !v && i !== e);
    s.values[e] = s.solution[e]; s.notes[f] = 0b110; s.undo = [[{ i: e, v: 0, n: 0 }]]; s.elapsed = 77; s.hinted = [];
    for (const k of ['id', 'started', 'updated', 'redo', 'excl', 'timed', 'lastHints']) delete s[k];
    return JSON.stringify(s);
  });
  await c1.close();
  const c2 = await b.newContext({ ...devices['iPhone 13'] });
  await c2.addInitScript(o => { if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('sudoku.game.v1', o); } }, old);
  const p2 = await c2.newPage(), errs = []; p2.on('pageerror', e => errs.push(String(e)));
  await p2.goto(url); await p2.waitForSelector('.cell');
  const o = JSON.parse(old), s = await p2.evaluate(() => window.__sudoku.state());
  const ok1 = s.values.join('') === o.values.join('') && s.notes.join() === o.notes.join() && s.elapsed >= 77 && s.undo.length === 1 && s.level === o.level;
  await p2.click('#undoBtn'); const s2 = await p2.evaluate(() => window.__sudoku.state());
  const ok2 = s2.values.join('') === o.puzzle.join('');
  await p2.reload(); await p2.waitForSelector('.cell'); const s3 = await p2.evaluate(() => ({ s: window.__sudoku.state(), n: window.__sudoku.games().length }));
  const ok3 = s3.n === 1 && s3.s.redo.length === 1;
  console.log((ok1 ? 'PASS' : 'FAIL') + ' a game saved by the earlier version opens with digits, notes, time and undo intact');
  console.log((ok2 ? 'PASS' : 'FAIL') + ' undo works on it');
  console.log((ok3 ? 'PASS' : 'FAIL') + ' it is still the only game after closing and reopening', errs.join(' '));
  await b.close(); server.close(); process.exit(ok1 && ok2 && ok3 && !errs.length ? 0 : 1);
})();
