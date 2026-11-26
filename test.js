// Acceptance checks for the Sudoku. Run: node test.js
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'pwa');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : '')); };

(async () => {
  const server = http.createServer((req, res) => {
    let f = decodeURIComponent(req.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html';
    const p = path.join(root, f);
    if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'text/plain' }); res.end(fs.readFileSync(p));
  });
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const requests = [], errors = [];
  page.on('request', r => requests.push(r.url()));
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForSelector('.cell');

  // 1. generator
  const gen = await page.evaluate(() => {
    const { generate, search, logicSolve } = window.__sudoku, out = {};
    const validGrid = s => { for (let u = 0; u < 9; u++) { const r = new Set(), c = new Set(), b = new Set();
      for (let k = 0; k < 9; k++) { r.add(s[u*9+k]); c.add(s[k*9+u]); b.add(s[((u/3|0)*3+(k/3|0))*9+(u%3)*3+k%3]); }
      if (r.size !== 9 || c.size !== 9 || b.size !== 9 || r.has(0)) return false; } return true; };
    for (const level of ['easy', 'medium', 'hard', 'expert']) {
      const o = out[level] = { n: 20, unique: 0, valid: 0, grades: {}, clues: [], ms: [], matches: 0 };
      for (let k = 0; k < o.n; k++) {
        const t = performance.now(), g = generate(level); o.ms.push(Math.round(performance.now() - t));
        const s = search(g.puzzle, 2);
        if (s.count === 1) o.unique++;
        if (validGrid(g.solution) && s.solution && s.solution.join('') === g.solution.join('')) o.valid++;
        if (g.puzzle.every((v, i) => !v || v === g.solution[i])) o.matches++;
        const grade = logicSolve(g.puzzle, 2) || 3; o.grades[grade] = (o.grades[grade] || 0) + 1;
        o.clues.push(g.puzzle.filter(Boolean).length);
      }
    }
    return out;
  });
  const want = { easy: 1, medium: 1, hard: 2, expert: 3 };
  for (const [level, o] of Object.entries(gen)) {
    const cl = `${Math.min(...o.clues)}-${Math.max(...o.clues)} clues, slowest ${Math.max(...o.ms)}ms, grades ${JSON.stringify(o.grades)}`;
    check(`${level}: 20 of 20 puzzles have exactly one solution`, o.unique === 20 && o.valid === 20 && o.matches === 20, cl);
    check(`${level}: all 20 are the right difficulty grade`, o.grades[want[level]] === 20);
    check(`${level}: a puzzle is made in under 2 seconds`, Math.max(...o.ms) < 2000);
  }

  // 2. play: notes, auto-clearing notes, conflict, erase, undo, save and reload, solve
  await page.reload(); await page.waitForSelector('.cell');
  const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__sudoku.state())));
  let s = await st();
  const empties = s.puzzle.map((v, i) => v ? -1 : i).filter(i => i >= 0);
  const cell = i => page.locator(`.cell[data-i="${i}"]`), key = d => page.locator(`.key[data-d="${d}"]`);
  const a = empties[0], da = s.solution[a];
  const rowMate = empties.find(i => i !== a && (i / 9 | 0) === (a / 9 | 0));
  await page.click('#notesBtn'); await cell(rowMate).click(); await key(da).click();
  s = await st(); check('notes mode writes a small note, not a digit', s.values[rowMate] === 0 && (s.notes[rowMate] >> da & 1) === 1);
  await page.click('#notesBtn'); await cell(a).click(); await key(da).click();
  s = await st(); check('placing a digit clears that note from its row', s.values[a] === da && s.notes[rowMate] === 0);
  await page.click('#undoBtn'); s = await st(); check('undo brings back the cell and the cleared note', s.values[a] === 0 && (s.notes[rowMate] >> da & 1) === 1);
  const givenInRow = s.puzzle.findIndex((v, i) => v && (i / 9 | 0) === (a / 9 | 0));
  await cell(a).click(); // undo left it selected, this deselects
  await cell(a).click(); await key(s.puzzle[givenInRow]).click();
  check('a digit that repeats in its row is marked red', await cell(a).evaluate(e => e.classList.contains('bad')) && await cell(givenInRow).evaluate(e => e.classList.contains('bad')));
  await page.click('#eraseBtn'); s = await st(); check('erase empties the cell', s.values[a] === 0);
  await cell(givenInRow).click(); await key(9).click(); s = await st();
  check('a starting digit cannot be changed', s.values[givenInRow] === s.puzzle[givenInRow]);
  const other = empties.find(i => i !== a && i !== rowMate && s.solution[i] !== da);
  await cell(other).click(); await key(s.solution[other]).click();
  await page.reload(); await page.waitForSelector('.cell'); s = await st();
  check('the game in progress is still there after closing and reopening', s.values[other] === s.solution[other] && (s.notes[rowMate] >> da & 1) === 1);
  { // hint, then undo: the hint stays and nothing else is lost
    const before = await st(); const x = empties.find(i => !before.values[i] && i !== rowMate);
    await cell(x).click(); const noHint = (await page.locator('#tools #hintBtn').count()) === 0;
    await page.click('#menuBtn'); await page.click('#hintBtn'); const tap1 = await st(); await page.click('#hintBtn'); const mid = await st();
    check('revealing a digit is not on the main screen and takes three taps', noHint && tap1.values[x] === 0 && mid.values[x] === mid.solution[x]);
    const dis = await page.isDisabled('#undoBtn');
    check('after a hint, Undo is off and earlier digits are kept', dis && mid.values[x] === mid.solution[x] && mid.values[other] === mid.solution[other]);
    await page.click('#menuBtn'); await page.click('#restartBtn'); const one = await st();
    check('Restart needs a second tap when a game is in progress', one.values[other] === one.solution[other] && (await page.textContent('#restartBtn')) === 'Tap again to restart');
    await page.click('#closeBtn');
    await page.click('#timerBtn'); await page.reload(); await page.waitForSelector('.cell');
    check('a paused game is still paused after reopening', await page.isVisible('#pauseCover'));
    await page.click('#resumeBtn');
  }
  await page.screenshot({ path: path.join(__dirname, 'shots', 'phone-light-midgame.png') });
  for (const i of empties) { if ((await st()).values[i] === s.solution[i]) continue; await cell(i).click(); await key(s.solution[i]).click(); }
  check('filling in the last digit shows Solved', await page.isVisible('#result') && !(await page.isVisible('#pad')), await page.textContent('#resultLine'));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'phone-light-solved.png') });
  check('a solve with a hint says so', /with 1 hint/.test(await page.textContent('#resultLine')));
  await page.click('#againBtn'); await page.screenshot({ path: path.join(__dirname, 'shots', 'phone-light-sheet.png') });
  await page.click('.level[data-level="hard"]'); await page.waitForFunction(() => window.__sudoku.state().level === 'hard' && !window.__sudoku.state().done);
  check('choosing Hard starts a new Hard puzzle', await page.textContent('#levelName') === 'Hard');
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('nothing runs off the side of an iPhone screen', !over);
  const fits = await page.evaluate(() => document.querySelector('#pad').getBoundingClientRect().bottom <= window.innerHeight);
  check('grid, tools and digits all fit on one iPhone screen without scrolling', fits);

  // 3. no ads, nothing from anywhere else
  const outside = requests.filter(u => !u.startsWith(base));
  check('no ads or trackers: the page loads nothing from any other site', outside.length === 0, [...new Set(requests.map(u => u.replace(base, '/')))].join(' '));

  // 4. offline
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await ctx.setOffline(true); await new Promise(r => server.close(r)); server.closeAllConnections && server.closeAllConnections();
  await page.reload(); await page.waitForSelector('.cell', { timeout: 5000 }).catch(() => {});
  s = await st().catch(() => null);
  check('with the network off and the server gone, the game reopens where it was', !!s && s.level === 'hard' && (await page.locator('.cell').count()) === 81);
  await page.click('#menuBtn'); await page.click('.level[data-level="easy"]'); await page.waitForFunction(() => window.__sudoku.state().level === 'easy');
  check('with the network off, a new puzzle can be started', true);
  await page.emulateMedia({ colorScheme: 'dark' }); await cell(40).click();
  await page.screenshot({ path: path.join(__dirname, 'shots', 'phone-dark.png') });
  check('no script errors during the whole run', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
