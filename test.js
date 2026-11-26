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
    const { generate, search, grade, LEVELS, TECHS } = window.__sudoku, out = {};
    for (const level of Object.keys(LEVELS)) {
      const o = out[level] = { n: 15, unique: 0, fits: 0, tiers: {}, clues: [], ms: [], hardest: {} };
      for (let k = 0; k < o.n; k++) {
        const t = performance.now(), g = generate(level); o.ms.push(Math.round(performance.now() - t));
        const s = search(g.puzzle, 2);
        if (s.count === 1 && s.solution.join('') === g.solution.join('')) o.unique++;
        if (g.fits) o.fits++;
        const gr = grade(g.puzzle); o.tiers[gr.tier] = (o.tiers[gr.tier] || 0) + 1;
        let top = ''; for (const tech of TECHS) if (gr.counts[tech]) top = tech;
        o.hardest[top] = (o.hardest[top] || 0) + 1;
        o.clues.push(g.puzzle.filter(Boolean).length);
      }
    }
    return out;
  });
  const wantTier = { easy: 1, medium: 3, hard: 3, harder: 4, hardest: 5, extreme: 6 };
  for (const [level, o] of Object.entries(gen)) {
    const cl = `${Math.min(...o.clues)}-${Math.max(...o.clues)} starting digits, slowest ${Math.max(...o.ms)}ms, hardest step ${JSON.stringify(o.hardest)}`;
    check(`${level}: 15 of 15 puzzles have exactly one solution`, o.unique === 15, cl);
    check(`${level}: all 15 need exactly the kind of step the level promises`, o.fits === 15 && o.tiers[wantTier[level]] === 15);
    check(`${level}: a puzzle is made in under 8 seconds`, Math.max(...o.ms) < 8000);
  }
  const m = gen.medium.hardest, h = gen.hard.hardest;
  check('medium never needs more than pointing; hard always needs claiming or a pair', Object.keys(m).join() === 'locked candidates pointing' && !h['locked candidates pointing']);

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
  { // redo, coming back to a game, and showing what's possible
    const s0 = await st(), y = empties.find(i => !s0.values[i] && i !== rowMate);
    await cell(y).click(); await key(s0.solution[y]).click(); await page.click('#undoBtn');
    const u = await st(); await page.click('#redoBtn'); const r = await st();
    check('redo puts back what undo took away', u.values[y] === 0 && r.values[y] === s0.solution[y] && await page.isDisabled('#redoBtn'));
    await page.click('#undoBtn');
    await page.click('#menuBtn');
    const focusOk = await page.evaluate(() => !document.activeElement.classList.contains('level'));
    check('opening the menu does not light up a level button', focusOk);
    await page.click('.level[data-level="easy"]'); await page.waitForFunction(() => window.__sudoku.state().level === 'easy');
    await page.click('#menuBtn');
    const rows = await page.locator('.gameOpen').count();
    await page.locator('.gameOpen:not(.here)').first().click();
    const back = await st();
    check('starting a new puzzle keeps the old game, and it can be reopened as it was', rows === 2 && back.level === 'medium' && back.values.join('') === u.values.join('') && back.notes.join() === u.notes.join() && back.undo.length === u.undo.length);
    await page.click('#menuBtn'); const rows2 = await page.locator('.gameOpen').count(); await page.click('#closeBtn');
    check('an untouched puzzle is not kept in the list', rows2 === 1);
    const before = await st();
    await page.click('#menuBtn'); await page.check('#autoToggle'); await page.click('#closeBtn');
    const shownOn = await page.locator('.notes i.on').count(), mid = await st();
    await page.click('#menuBtn'); await page.uncheck('#autoToggle'); await page.click('#closeBtn');
    const shownOff = await page.locator('.notes i.on').count(), after = await st();
    check("showing what's possible fills every empty cell, turns off again, and is not an undo step", shownOn > 100 && shownOff === 1 && mid.undo.length === before.undo.length && after.undo.length === before.undo.length && after.notes.join() === before.notes.join());
  }
  { // nudges: off the main screen, staged, and never write a digit
    const before = await st();
    const offMain = (await page.locator('#tools #hintBtn').count()) === 0 && !(await page.isVisible('#hintBtn'));
    await page.click('#menuBtn'); await page.click('#hintBtn');
    const texts = [await page.textContent('#nudgeText')];
    let marked1 = await page.locator('.cell.nu, .cell.np, .cell.nt').count(), taps = 0;
    while (await page.isVisible('#nudgeMore') && taps < 5) { await page.click('#nudgeMore'); texts.push(await page.textContent('#nudgeText')); taps++; }
    const after = await st(), targets = await page.locator('.cell.nt').count();
    check('help is not on the main screen: it is inside the menu', offMain);
    check('a nudge first says only what kind of step to look for, with nothing marked', marked1 === 0 && /^Look for /.test(texts[0]), texts[0]);
    check('asking for more marks cells on the grid, and never writes a digit or a note', targets >= 1 && taps >= 1 && after.values.join('') === before.values.join('') && after.notes.join() === before.notes.join(), texts[texts.length - 1]);
    check('with a nudge open, the grid and digit keys still fit on the screen', await page.evaluate(() => document.querySelector('#pad').getBoundingClientRect().bottom <= window.innerHeight));
    await page.click('#nudgeClose');
    // a wrong digit: the nudge says so instead of building on it
    const x = empties.find(i => !before.values[i] && i !== rowMate), wrongD = before.solution[x] % 9 + 1;
    await cell(x).click(); await key(wrongD).click(); await page.click('#menuBtn'); await page.click('#hintBtn');
    check('with a wrong digit on the board, the nudge says a digit is wrong', /wrong/.test(await page.textContent('#nudgeText')));
    await cell(x).click(); await page.click('#eraseBtn');
    check('making a move closes the nudge', !(await page.isVisible('#nudge')));
    const other2 = other; await page.click('#menuBtn'); await page.click('#restartBtn'); const one = await st();
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
  check('a solve after nudges says so', /with 2 nudges/.test(await page.textContent('#resultLine')));
  const pace = await page.evaluate(() => JSON.parse(localStorage.getItem('sudoku.pace.v1') || '{}'));
  check('pace is recorded per kind of step, on the device only', Object.values(pace).reduce((s, a) => s + a.length, 0) > 20, Object.entries(pace).map(([k, a]) => k + ' ' + a.length).join(', '));
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
