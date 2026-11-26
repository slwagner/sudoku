/* Tests for solver.js. Run: node test.js [puzzles=3000] [maxPuzzles=20000] [seed=12345]
   Exits non-zero if any step is unsound, or a basic check fails.
   Every puzzle here has exactly one solution (checked with search), which unique rectangle relies on. */
'use strict';
const makeSolver = require('./solver.js');
const S = makeSolver();

const N = +(process.argv[2] || 3000), MAXN = +(process.argv[3] || 20000), SEED = +(process.argv[4] || 12345);

/* seeded random so a failure can be reproduced */
let seed = SEED >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/* ---------- copied from sudoku.html (Math.random swapped for rnd) ---------- */
const boxOf = i => ((i / 27 | 0) * 3 + ((i % 9) / 3 | 0));
const bits = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
function search(g, limit, random) {
  const cells = g.slice(), R = new Uint16Array(9), C = new Uint16Array(9), B = new Uint16Array(9);
  for (let i = 0; i < 81; i++) {
    const d = cells[i];
    if (d) {
      const bit = 1 << d, r = i / 9 | 0, c = i % 9, b = boxOf(i);
      if ((R[r] | C[c] | B[b]) & bit) return { count: 0, solution: null };
      R[r] |= bit; C[c] |= bit; B[b] |= bit;
    }
  }
  let count = 0, solution = null;
  (function go() {
    let best = -1, bm = 0, bn = 10;
    for (let i = 0; i < 81; i++) {
      if (cells[i]) continue;
      const m = ~(R[i / 9 | 0] | C[i % 9] | B[boxOf(i)]) & 0x3FE, n = bits(m);
      if (!n) return;
      if (n < bn) { best = i; bm = m; bn = n; if (n === 1) break; }
    }
    if (best < 0) { count++; if (!solution) solution = cells.slice(); return; }
    const r = best / 9 | 0, c = best % 9, b = boxOf(best), ds = [];
    for (let d = 1; d <= 9; d++) if (bm >> d & 1) ds.push(d);
    if (random) shuffle(ds);
    for (const d of ds) {
      const bit = 1 << d;
      cells[best] = d; R[r] |= bit; C[c] |= bit; B[b] |= bit;
      go();
      cells[best] = 0; R[r] &= ~bit; C[c] &= ~bit; B[b] &= ~bit;
      if (count >= limit) return;
    }
  })();
  return { count, solution };
}
/* random full grid, then remove clues in random order while the puzzle stays unique: a minimal puzzle */
function minimalPuzzle() {
  const seedGrid = new Array(81).fill(0);
  shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).forEach((d, i) => { seedGrid[i] = d; });
  const solution = search(seedGrid, 1, true).solution;
  const puzzle = solution.slice();
  for (const i of shuffle(Array.from({ length: 81 }, (_, k) => k))) {
    const keep = puzzle[i];
    puzzle[i] = 0;
    if (search(puzzle, 2).count !== 1) puzzle[i] = keep;
  }
  return { puzzle, solution };
}

/* ---------- bookkeeping ---------- */
let failed = false;
const fail = msg => { failed = true; console.log('FAIL: ' + msg); };
const counts = {}, puzzlesUsing = {}, example = {}, unsound = {};
for (const t of S.TECHS) { counts[t] = 0; puzzlesUsing[t] = 0; }
const tiers = [0, 0, 0, 0, 0, 0, 0, 0];
let total = 0, timeSum = 0, timeMax = 0, slowest = '', shapeErrors = 0, mismatch = 0;

function runPuzzle(puzzle, solution, tally) {
  const str = puzzle.join('');
  const values = puzzle.slice(), cand = S.initCandidates(values);
  const used = {};
  let left = values.filter(x => !x).length, tier = 0, steps = 0, ok = true;
  while (left) {
    const v0 = values.slice(), c0 = cand.slice();
    const st = S.nextStep(values, cand);
    for (let i = 0; i < 81; i++) if (values[i] !== v0[i] || cand[i] !== c0[i]) { fail('nextStep changed its input on ' + str); return; }
    if (!st) break;
    // shape of the step
    if (S.TIER[st.tech] !== st.tier || !Array.isArray(st.eliminate) || !Array.isArray(st.units) || !Array.isArray(st.cells) ||
        !Array.isArray(st.digits) || !(st.place === null || (Array.isArray(st.place) && st.place.length))) { shapeErrors++; fail('bad step shape from ' + st.tech + ' on ' + str); return; }
    if (!st.place && !st.eliminate.length) { fail(st.tech + ' returned a step that changes nothing on ' + str); return; }
    // soundness
    let bad = null;
    if (st.place) for (const p of st.place) {
      if (values[p.cell]) bad = 'places into filled cell ' + p.cell;
      else if (solution[p.cell] !== p.digit) bad = 'places ' + p.digit + ' in cell ' + p.cell + ', solution has ' + solution[p.cell];
    }
    for (const e of st.eliminate) {
      if (!(cand[e.cell] >> e.digit & 1)) bad = 'eliminates a candidate that is not there (cell ' + e.cell + ' digit ' + e.digit + ')';
      else if (solution[e.cell] === e.digit) bad = 'removes solution digit ' + e.digit + ' from cell ' + e.cell;
    }
    if (bad) {
      if (!unsound[st.tech]) unsound[st.tech] = { n: 0, puzzle: str, why: bad };
      unsound[st.tech].n++;
      fail(st.tech + ' ' + bad + ' | puzzle ' + str + ' | state ' + values.join(''));
      ok = false;
      break;
    }
    S.applyStep(values, cand, st);
    used[st.tech] = (used[st.tech] || 0) + 1;
    if (st.tier > tier) tier = st.tier;
    steps++;
    if (st.place) left -= st.place.length;
  }
  if (!ok) return;
  const solved = left === 0;
  if (solved) for (let i = 0; i < 81; i++) if (values[i] !== solution[i]) { fail('finished grid differs from solution on ' + str); return; }
  const myTier = solved ? tier : 7;
  for (const t of Object.keys(used)) { counts[t] += used[t]; puzzlesUsing[t]++; if (!example[t]) example[t] = str; }
  if (!tally) return;
  total++; tiers[myTier]++;
  // grade() must agree with the step-by-step run; time it on its own
  const t0 = process.hrtime.bigint();
  const g = S.grade(puzzle);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  timeSum += ms; if (ms > timeMax) { timeMax = ms; slowest = str; }
  if (g.solved !== solved || g.tier !== myTier || g.steps !== steps || JSON.stringify(g.counts) !== JSON.stringify(used)) { mismatch++; fail('grade() disagrees with the step run on ' + str); }
  const gs = S.grade(str);
  if (gs.tier !== g.tier || gs.steps !== g.steps) fail('grade(string) disagrees with grade(array) on ' + str);
}

/* ---------- 0. basic checks ---------- */
{
  const easy = '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
  const g = S.grade(easy);
  if (!g.solved || g.values.join('') !== '534678912672195348198342567859761423426853791713924856961537284287419635345286179') fail('known easy puzzle not solved correctly');
  if (g.tier < 1 || g.tier > 2) fail('known easy puzzle graded tier ' + g.tier + ', expected 1 or 2');
  const done = S.grade(g.values);
  if (!done.solved || done.steps !== 0) fail('solved grid should grade as solved in 0 steps');
  if (S.nextStep(g.values, S.initCandidates(g.values)) !== null) fail('nextStep on a solved grid should be null');
  // hidden quad needs a completely empty unit to be the easiest step, so check the detector on a built state:
  // row 0 empty, digits 1-4 only possible in its first four cells.
  const v = new Array(81).fill(0), c = new Array(81).fill(0x3FE);
  for (let k = 4; k < 9; k++) c[k] = 0x3E0; // 5..9
  const hq = S.findStep('hidden quad', v, c);
  const want = []; for (let k = 0; k < 4; k++) for (let d = 5; d <= 9; d++) want.push(k * 10 + d);
  if (!hq || hq.units[0] !== 0 || hq.digits.join('') !== '1234' || hq.eliminate.map(e => e.cell * 10 + e.digit).sort((a, b) => a - b).join() !== want.join()) fail('hidden quad detector wrong on the built state');
  else console.log('built-state check: hidden quad detector finds digits 1234 in row 0 and removes 5-9 from those four cells');
}

/* ---------- 1-3. random minimal puzzles ---------- */
const tStart = Date.now();
let generated = 0;
for (; generated < N; generated++) { const p = minimalPuzzle(); runPuzzle(p.puzzle, p.solution, true); }
const missingAfterN = S.TECHS.filter(t => !counts[t]);
const snapshot = { counts: Object.assign({}, counts), using: Object.assign({}, puzzlesUsing) };

console.log('\n=== ' + N + ' random minimal puzzles, seed ' + SEED + ' ===');
console.log('technique'.padEnd(30) + 'tier  steps     puzzles using it');
for (const t of S.TECHS) console.log(t.padEnd(30) + String(S.TIER[t]).padEnd(6) + String(counts[t]).padEnd(10) + puzzlesUsing[t]);
console.log('\ntier distribution (hardest tier needed; 7 = solver got stuck):');
for (let t = 1; t <= 7; t++) console.log('  tier ' + t + ': ' + String(tiers[t]).padStart(5) + '  ' + (100 * tiers[t] / total).toFixed(1) + '%');
console.log('\ngrade() time per puzzle: average ' + (timeSum / total).toFixed(3) + ' ms, slowest ' + timeMax.toFixed(3) + ' ms (' + slowest + ')');

/* ---------- 2. keep looking for techniques that have not fired, up to MAXN puzzles ---------- */
if (missingAfterN.length) {
  console.log('\nnot seen in the first ' + N + ': ' + missingAfterN.join(', ') + '. searching more puzzles (soundness still checked)...');
  while (generated < MAXN && S.TECHS.some(t => !counts[t])) { const p = minimalPuzzle(); runPuzzle(p.puzzle, p.solution, false); generated++; }
  for (const t of missingAfterN) {
    if (counts[t]) console.log('  ' + t + ': first seen within ' + generated + ' puzzles, e.g. ' + example[t]);
    else console.log('  ' + t + ': NEVER FIRED in ' + generated + ' puzzles');
  }
}
console.log('\nexample puzzle per technique:');
for (const t of S.TECHS) console.log('  ' + t.padEnd(28) + (example[t] || '(none found)'));

console.log('\npuzzles checked for soundness: ' + generated + ', wall time ' + ((Date.now() - tStart) / 1000).toFixed(1) + ' s');
const bad = Object.keys(unsound);
if (bad.length) { console.log('UNSOUND TECHNIQUES:'); for (const t of bad) console.log('  ' + t + ': ' + unsound[t].n + ' failures, first on ' + unsound[t].puzzle + ' (' + unsound[t].why + ')'); }
else console.log('no unsound step found');
const never = S.TECHS.filter(t => !counts[t]);
if (never.length) console.log('techniques that never fired on a real puzzle: ' + never.join(', '));
console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: PASSED');
process.exit(failed ? 1 : 0);
