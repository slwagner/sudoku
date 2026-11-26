/* Human-style Sudoku step solver.
   Plain ES2019, no imports, no DOM. Everything lives under makeSolver().

   Conventions (same as sudoku.html):
     values : array of 81 ints, 0 = empty
     cand   : array of 81 candidate masks, bit d set = digit d possible (full mask 0x3FE)
     units  : 0-8 rows, 9-17 columns, 18-26 boxes

   A step is
     { tech, tier, place: [{cell, digit}] | null, eliminate: [{cell, digit}],
       units: [unit indexes], cells: [pattern cells], digits: [digits involved] }
   For a placement step `eliminate` is empty; applyStep clears the digit from the peers itself.
   The techniques assume `cand` is honest: no candidate is missing that the givens still allow
   for the true solution. */
function makeSolver() {
  'use strict';

  /* ---------- geometry ---------- */
  const ALL = 0x3FE;
  const UNITS = [], PEERS = [], SEES = [];
  const rowOf = i => (i / 9 | 0), colOf = i => i % 9;
  const boxOf = i => ((i / 27 | 0) * 3 + ((i % 9) / 3 | 0));
  for (let r = 0; r < 9; r++) { const u = []; for (let c = 0; c < 9; c++) u.push(r * 9 + c); UNITS.push(u); }
  for (let c = 0; c < 9; c++) { const u = []; for (let r = 0; r < 9; r++) u.push(r * 9 + c); UNITS.push(u); }
  for (let b = 0; b < 9; b++) {
    const r0 = (b / 3 | 0) * 3, c0 = (b % 3) * 3, u = [];
    for (let k = 0; k < 9; k++) u.push((r0 + (k / 3 | 0)) * 9 + c0 + (k % 3));
    UNITS.push(u);
  }
  for (let i = 0; i < 81; i++) {
    const s = new Uint8Array(81), p = [];
    for (const ui of [rowOf(i), 9 + colOf(i), 18 + boxOf(i)]) for (const j of UNITS[ui]) if (j !== i) s[j] = 1;
    for (let j = 0; j < 81; j++) if (s[j]) p.push(j);
    SEES.push(s); PEERS.push(p);
  }
  const bits = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
  const digitsOf = m => { const a = []; for (let d = 1; d <= 9; d++) if (m >> d & 1) a.push(d); return a; };
  const lowDigit = m => 31 - Math.clz32(m & -m);

  /* ---------- technique order and tiers ---------- */
  const ORDER = [
    ['full house', 1], ['hidden single (box)', 1],
    ['hidden single (line)', 2], ['naked single', 2],
    ['locked candidates pointing', 3], ['locked candidates claiming', 3], ['naked pair', 3], ['hidden pair', 3],
    ['naked triple', 4], ['hidden triple', 4], ['naked quad', 4], ['hidden quad', 4], ['x-wing', 4],
    ['swordfish', 5], ['skyscraper', 5], ['2-string kite', 5], ['xy-wing', 5], ['xyz-wing', 5], ['w-wing', 5],
    ['unique rectangle type 1', 5],
    ['simple colouring', 6], ['x-chain', 6], ['xy-chain', 6]
  ];
  const TIER = {}, TECHS = ORDER.map(o => o[0]);
  for (const o of ORDER) TIER[o[0]] = o[1];

  /* ---------- helpers ---------- */
  function initCandidates(values) {
    const cand = new Array(81);
    for (let i = 0; i < 81; i++) {
      if (values[i]) { cand[i] = 0; continue; }
      let m = ALL;
      for (const p of PEERS[i]) if (values[p]) m &= ~(1 << values[p]);
      cand[i] = m;
    }
    return cand;
  }

  // Builds a step; drops eliminations that are not present (or repeated). Returns null if nothing changes.
  function mk(tech, cand, o) {
    const el = [], seen = {};
    for (const e of (o.eliminate || [])) {
      const key = e.cell * 10 + e.digit;
      if (seen[key] || !(cand[e.cell] >> e.digit & 1)) continue;
      seen[key] = 1; el.push({ cell: e.cell, digit: e.digit });
    }
    if (!o.place && !el.length) return null;
    return { tech: tech, tier: TIER[tech], place: o.place || null, eliminate: el,
      units: o.units || [], cells: o.cells || [], digits: o.digits || [] };
  }

  function spots(cand, ui, d) {
    const a = [], u = UNITS[ui];
    for (let k = 0; k < 9; k++) if (cand[u[k]] >> d & 1) a.push(u[k]);
    return a;
  }

  // every cell that still has d and sees all of `list` (and is not in `list`)
  function seeAll(cand, d, list) {
    const out = [];
    for (let i = 0; i < 81; i++) {
      if (!(cand[i] >> d & 1)) continue;
      let ok = true;
      for (const c of list) if (c === i || !SEES[c][i]) { ok = false; break; }
      if (ok) out.push({ cell: i, digit: d });
    }
    return out;
  }

  // calls fn(idx) for every k-subset of 0..n-1; stops at and returns the first truthy result
  function combos(n, k, fn) {
    const idx = [];
    const rec = start => {
      if (idx.length === k) return fn(idx);
      for (let i = start; i <= n - (k - idx.length); i++) {
        idx.push(i); const r = rec(i + 1); idx.pop();
        if (r) return r;
      }
      return null;
    };
    return rec(0);
  }

  // conjugate pairs for digit d: list of { ui, a, b }
  function strongLinks(cand, d) {
    const out = [];
    for (let ui = 0; ui < 27; ui++) {
      const s = spots(cand, ui, d);
      if (s.length === 2) out.push({ ui: ui, a: s[0], b: s[1] });
    }
    return out;
  }

  /* ---------- tier 1 and 2: singles ---------- */
  function fullHouse(v, cand) {
    for (let ui = 0; ui < 27; ui++) {
      let empty = -1, n = 0, used = 0;
      for (const i of UNITS[ui]) { if (v[i]) used |= 1 << v[i]; else { n++; empty = i; } }
      if (n !== 1) continue;
      const m = ALL & ~used;
      if (bits(m) !== 1) continue;
      const d = lowDigit(m);
      return mk('full house', cand, { place: [{ cell: empty, digit: d }], units: [ui], cells: [empty], digits: [d] });
    }
    return null;
  }
  function hiddenSingle(tech, from, to) {
    return (v, cand) => {
      for (let ui = from; ui < to; ui++) for (let d = 1; d <= 9; d++) {
        const s = spots(cand, ui, d);
        if (s.length === 1 && !v[s[0]])
          return mk(tech, cand, { place: [{ cell: s[0], digit: d }], units: [ui], cells: [s[0]], digits: [d] });
      }
      return null;
    };
  }
  function nakedSingle(v, cand) {
    for (let i = 0; i < 81; i++) {
      if (v[i] || bits(cand[i]) !== 1) continue;
      const d = lowDigit(cand[i]);
      return mk('naked single', cand, { place: [{ cell: i, digit: d }], units: [], cells: [i], digits: [d] });
    }
    return null;
  }

  /* ---------- tier 3 ---------- */
  function pointing(v, cand) {
    for (let b = 18; b < 27; b++) for (let d = 1; d <= 9; d++) {
      const s = spots(cand, b, d);
      if (s.length < 2) continue;
      const lines = [];
      if (s.every(i => rowOf(i) === rowOf(s[0]))) lines.push(rowOf(s[0]));
      if (s.every(i => colOf(i) === colOf(s[0]))) lines.push(9 + colOf(s[0]));
      for (const li of lines) {
        const el = [];
        for (const j of UNITS[li]) if (boxOf(j) !== b - 18) el.push({ cell: j, digit: d });
        const st = mk('locked candidates pointing', cand, { eliminate: el, units: [b, li], cells: s, digits: [d] });
        if (st) return st;
      }
    }
    return null;
  }
  function claiming(v, cand) {
    for (let li = 0; li < 18; li++) for (let d = 1; d <= 9; d++) {
      const s = spots(cand, li, d);
      if (s.length < 2 || !s.every(i => boxOf(i) === boxOf(s[0]))) continue;
      const b = 18 + boxOf(s[0]), el = [];
      for (const j of UNITS[b]) if (s.indexOf(j) < 0) el.push({ cell: j, digit: d });
      const st = mk('locked candidates claiming', cand, { eliminate: el, units: [li, b], cells: s, digits: [d] });
      if (st) return st;
    }
    return null;
  }
  function nakedSubset(tech, n) {
    return (v, cand) => {
      for (let ui = 0; ui < 27; ui++) {
        const u = UNITS[ui], pool = [];
        let empties = 0;
        for (const i of u) if (!v[i]) { empties++; const c = bits(cand[i]); if (c >= 1 && c <= n) pool.push(i); }
        if (empties <= n || pool.length < n) continue;
        const st = combos(pool.length, n, idx => {
          let m = 0;
          for (const k of idx) m |= cand[pool[k]];
          if (bits(m) !== n) return null;
          const cells = idx.map(k => pool[k]), el = [];
          for (const j of u) if (!v[j] && cells.indexOf(j) < 0) for (const d of digitsOf(cand[j] & m)) el.push({ cell: j, digit: d });
          return mk(tech, cand, { eliminate: el, units: [ui], cells: cells, digits: digitsOf(m) });
        });
        if (st) return st;
      }
      return null;
    };
  }
  function hiddenSubset(tech, n) {
    return (v, cand) => {
      for (let ui = 0; ui < 27; ui++) {
        const u = UNITS[ui], pool = [];
        for (let d = 1; d <= 9; d++) {
          let pm = 0;
          for (let k = 0; k < 9; k++) if (cand[u[k]] >> d & 1) pm |= 1 << k;
          const c = bits(pm);
          if (c >= 1 && c <= n) pool.push({ d: d, pm: pm });
        }
        if (pool.length < n) continue;
        const st = combos(pool.length, n, idx => {
          let pm = 0, dm = 0;
          for (const k of idx) { pm |= pool[k].pm; dm |= 1 << pool[k].d; }
          if (bits(pm) !== n) return null;
          const cells = [], el = [];
          for (let k = 0; k < 9; k++) if (pm >> k & 1) {
            cells.push(u[k]);
            for (const d of digitsOf(cand[u[k]] & ~dm)) el.push({ cell: u[k], digit: d });
          }
          return mk(tech, cand, { eliminate: el, units: [ui], cells: cells, digits: digitsOf(dm) });
        });
        if (st) return st;
      }
      return null;
    };
  }

  /* ---------- fish (x-wing n=2, swordfish n=3) ---------- */
  // base lines at offset o (0 rows, 9 columns), cover lines at offset 9 - o.
  // UNITS[o + j][k] is the cell of base line j at cross position k; UNITS[9 - o + k][j] is the same cell.
  function lineMasks(cand, d, o) {
    const out = [];
    for (let j = 0; j < 9; j++) {
      let m = 0;
      for (let k = 0; k < 9; k++) if (cand[UNITS[o + j][k]] >> d & 1) m |= 1 << k;
      out.push(m);
    }
    return out;
  }
  function fish(tech, n) {
    return (v, cand) => {
      for (let d = 1; d <= 9; d++) for (const o of [0, 9]) {
        const masks = lineMasks(cand, d, o), lines = [];
        for (let j = 0; j < 9; j++) { const c = bits(masks[j]); if (c >= 2 && c <= n) lines.push(j); }
        if (lines.length < n) continue;
        const st = combos(lines.length, n, idx => {
          let m = 0, base = 0;
          for (const k of idx) { m |= masks[lines[k]]; base |= 1 << lines[k]; }
          if (bits(m) !== n) return null;
          const el = [], cells = [], units = [];
          for (let j = 0; j < 9; j++) if (base >> j & 1) units.push(o + j);
          for (let k = 0; k < 9; k++) if (m >> k & 1) {
            units.push(9 - o + k);
            for (let j = 0; j < 9; j++) {
              const cell = UNITS[9 - o + k][j];
              if (base >> j & 1) { if (cand[cell] >> d & 1) cells.push(cell); } else el.push({ cell: cell, digit: d });
            }
          }
          return mk(tech, cand, { eliminate: el, units: units, cells: cells, digits: [d] });
        });
        if (st) return st;
      }
      return null;
    };
  }

  /* ---------- tier 5: single-digit patterns ---------- */
  // Two parallel lines each holding d exactly twice, one end of each in the same cross line.
  // One of the two other ends must be d.
  function skyscraper(v, cand) {
    for (let d = 1; d <= 9; d++) for (const o of [0, 9]) {
      const masks = lineMasks(cand, d, o);
      for (let j1 = 0; j1 < 9; j1++) {
        if (bits(masks[j1]) !== 2) continue;
        for (let j2 = j1 + 1; j2 < 9; j2++) {
          if (bits(masks[j2]) !== 2) continue;
          const shared = masks[j1] & masks[j2];
          if (bits(shared) !== 1) continue;
          const ks = lowDigit(shared), k1 = lowDigit(masks[j1] & ~shared), k2 = lowDigit(masks[j2] & ~shared);
          const a = UNITS[o + j1][k1], b = UNITS[o + j2][k2];
          const st = mk('skyscraper', cand, { eliminate: seeAll(cand, d, [a, b]), units: [o + j1, o + j2, 9 - o + ks],
            cells: [a, UNITS[o + j1][ks], UNITS[o + j2][ks], b], digits: [d] });
          if (st) return st;
        }
      }
    }
    return null;
  }
  // A row and a column each holding d exactly twice, with one end of each in the same box.
  function kite(v, cand) {
    for (let d = 1; d <= 9; d++) {
      for (let r = 0; r < 9; r++) {
        const rs = spots(cand, r, d);
        if (rs.length !== 2) continue;
        for (let c = 9; c < 18; c++) {
          const cs = spots(cand, c, d);
          if (cs.length !== 2) continue;
          if (rs.indexOf(cs[0]) >= 0 || rs.indexOf(cs[1]) >= 0) continue;
          for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) {
            if (boxOf(rs[x]) !== boxOf(cs[y])) continue;
            const a = rs[1 - x], b = cs[1 - y];
            const st = mk('2-string kite', cand, { eliminate: seeAll(cand, d, [a, b]), units: [r, c, 18 + boxOf(rs[x])],
              cells: [a, rs[x], cs[y], b], digits: [d] });
            if (st) return st;
          }
        }
      }
    }
    return null;
  }

  /* ---------- tier 5: wings ---------- */
  function xyWing(v, cand) {
    for (let p = 0; p < 81; p++) {
      const pm = cand[p];
      if (bits(pm) !== 2) continue;
      const wings = PEERS[p].filter(i => bits(cand[i]) === 2 && bits(cand[i] & pm) === 1);
      for (let a = 0; a < wings.length; a++) for (let b = a + 1; b < wings.length; b++) {
        const ma = cand[wings[a]], mb = cand[wings[b]], zm = ma & mb;
        if ((ma & pm) === (mb & pm) || bits(zm) !== 1 || (zm & pm)) continue;
        const z = lowDigit(zm);
        const st = mk('xy-wing', cand, { eliminate: seeAll(cand, z, [wings[a], wings[b]]), units: [],
          cells: [p, wings[a], wings[b]], digits: digitsOf(pm | zm) });
        if (st) return st;
      }
    }
    return null;
  }
  function xyzWing(v, cand) {
    for (let p = 0; p < 81; p++) {
      const pm = cand[p];
      if (bits(pm) !== 3) continue;
      const wings = PEERS[p].filter(i => bits(cand[i]) === 2 && (cand[i] & ~pm) === 0);
      for (let a = 0; a < wings.length; a++) for (let b = a + 1; b < wings.length; b++) {
        const ma = cand[wings[a]], mb = cand[wings[b]];
        if (ma === mb) continue;
        const z = lowDigit(ma & mb);
        const st = mk('xyz-wing', cand, { eliminate: seeAll(cand, z, [p, wings[a], wings[b]]), units: [],
          cells: [p, wings[a], wings[b]], digits: digitsOf(pm) });
        if (st) return st;
      }
    }
    return null;
  }
  // Two cells with the same pair {a,b} that do not see each other, joined by a conjugate pair on a:
  // if both were a, both ends of the conjugate pair would lose a. So one of the two cells is b.
  function wWing(v, cand) {
    const bi = [];
    for (let i = 0; i < 81; i++) if (bits(cand[i]) === 2) bi.push(i);
    const links = [];
    for (let i = 0; i < bi.length; i++) for (let j = i + 1; j < bi.length; j++) {
      const c1 = bi[i], c2 = bi[j];
      if (cand[c1] !== cand[c2] || SEES[c1][c2]) continue;
      const ds = digitsOf(cand[c1]);
      for (let t = 0; t < 2; t++) {
        const a = ds[t], b = ds[1 - t];
        if (!links[a]) links[a] = strongLinks(cand, a);
        const el = seeAll(cand, b, [c1, c2]);
        if (!el.length) continue;
        for (const L of links[a]) {
          if (L.a === c1 || L.a === c2 || L.b === c1 || L.b === c2) continue;
          if ((SEES[L.a][c1] && SEES[L.b][c2]) || (SEES[L.a][c2] && SEES[L.b][c1])) {
            const st = mk('w-wing', cand, { eliminate: el, units: [L.ui], cells: [c1, c2, L.a, L.b], digits: [a, b] });
            if (st) return st;
          }
        }
      }
    }
    return null;
  }

  /* ---------- tier 5: unique rectangle type 1 ----------
     ONLY VALID FOR PUZZLES WITH EXACTLY ONE SOLUTION. Four empty cells in two rows, two columns and two
     boxes; three hold exactly {a,b}. If the fourth were a or b the four cells could be swapped to give a
     second solution, so a and b come out of the fourth. The generator in sudoku.html guarantees
     uniqueness; do not run this on a puzzle that might have several solutions. */
  function uniqueRect1(v, cand) {
    for (let r1 = 0; r1 < 9; r1++) for (let r2 = r1 + 1; r2 < 9; r2++) {
      const sameBand = (r1 / 3 | 0) === (r2 / 3 | 0);
      for (let c1 = 0; c1 < 9; c1++) for (let c2 = c1 + 1; c2 < 9; c2++) {
        const sameStack = (c1 / 3 | 0) === (c2 / 3 | 0);
        if (sameBand === sameStack) continue; // needs exactly two boxes
        const q = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
        if (v[q[0]] || v[q[1]] || v[q[2]] || v[q[3]]) continue;
        for (let k = 0; k < 4; k++) {
          const o = q.filter((x, i) => i !== k), m = cand[o[0]];
          if (bits(m) !== 2 || cand[o[1]] !== m || cand[o[2]] !== m) continue;
          if ((cand[q[k]] & m) !== m || cand[q[k]] === m) continue;
          const ds = digitsOf(m);
          const st = mk('unique rectangle type 1', cand, { eliminate: [{ cell: q[k], digit: ds[0] }, { cell: q[k], digit: ds[1] }],
            units: [r1, r2, 9 + c1, 9 + c2], cells: q, digits: ds });
          if (st) return st;
        }
      }
    }
    return null;
  }

  /* ---------- tier 6 ---------- */
  // Single-digit colouring of conjugate pairs. Rule "wrap": two cells of one colour see each other, so that
  // colour is false everywhere. Rule "trap": a cell outside sees both colours, so it cannot hold the digit.
  function simpleColouring(v, cand) {
    for (let d = 1; d <= 9; d++) {
      const links = strongLinks(cand, d);
      if (links.length < 2) continue;
      const adj = {};
      for (const L of links) { (adj[L.a] = adj[L.a] || []).push(L.b); (adj[L.b] = adj[L.b] || []).push(L.a); }
      const colour = new Int8Array(81).fill(-1);
      for (const key of Object.keys(adj)) {
        const start = +key;
        if (colour[start] >= 0) continue;
        const group = [[], []], queue = [start];
        colour[start] = 0;
        while (queue.length) {
          const x = queue.shift();
          group[colour[x]].push(x);
          for (const y of adj[x]) if (colour[y] < 0) { colour[y] = 1 - colour[x]; queue.push(y); }
        }
        const all = group[0].concat(group[1]);
        for (let c = 0; c < 2; c++) {
          const g = group[c];
          let clash = false;
          for (let a = 0; a < g.length && !clash; a++) for (let b = a + 1; b < g.length; b++) if (SEES[g[a]][g[b]]) { clash = true; break; }
          if (!clash) continue;
          const st = mk('simple colouring', cand, { eliminate: g.map(cell => ({ cell: cell, digit: d })), units: [], cells: all, digits: [d] });
          if (st) return st;
        }
        const el = [];
        for (let i = 0; i < 81; i++) {
          if (!(cand[i] >> d & 1) || all.indexOf(i) >= 0) continue;
          if (group[0].some(x => SEES[x][i]) && group[1].some(x => SEES[x][i])) el.push({ cell: i, digit: d });
        }
        const st = mk('simple colouring', cand, { eliminate: el, units: [], cells: all, digits: [d] });
        if (st) return st;
      }
    }
    return null;
  }

  // Single-digit chain of alternating strong and weak links that starts and ends on a strong link.
  // Worked as an implication search: suppose the start cell is not d; every cell then forced to be d is an
  // end, and (start or end) is d, so any cell seeing both loses d. Returns the shortest chain found.
  function xChain(v, cand) {
    let best = null, bestLen = 99;
    for (let d = 1; d <= 9; d++) {
      const links = strongLinks(cand, d);
      if (links.length < 2) continue;
      const adj = {};
      for (const L of links) { (adj[L.a] = adj[L.a] || []).push(L.b); (adj[L.b] = adj[L.b] || []).push(L.a); }
      for (const key of Object.keys(adj)) {
        const start = +key;
        const onPar = new Int16Array(81).fill(-1), offPar = new Int16Array(81).fill(-1);
        const depth = new Int16Array(162);
        const queue = [start]; // entries: cell = off, cell + 81 = on
        offPar[start] = start;
        for (let qi = 0; qi < queue.length; qi++) {
          const e = queue[qi], dep = depth[e];
          if (dep + 1 >= bestLen) break;
          if (e < 81) {
            for (const y of (adj[e] || [])) {
              if (onPar[y] >= 0 || y === start) continue;
              onPar[y] = e; depth[y + 81] = dep + 1; queue.push(y + 81);
              const el = seeAll(cand, d, [start, y]);
              if (!el.length) continue;
              const cells = [y];
              let cur = y, on = true;
              while (cur !== start || on) { cur = on ? onPar[cur] : offPar[cur]; on = !on; cells.push(cur); }
              const st = mk('x-chain', cand, { eliminate: el, units: [], cells: cells.reverse(), digits: [d] });
              if (st && dep + 1 < bestLen) { best = st; bestLen = dep + 1; }
            }
          } else {
            const x = e - 81;
            for (const z of PEERS[x]) {
              if (!(cand[z] >> d & 1) || offPar[z] >= 0) continue;
              offPar[z] = x; depth[z] = dep + 1; queue.push(z);
            }
          }
        }
      }
    }
    return best;
  }

  // Chain of two-candidate cells. Suppose the start cell {x,y} is not x: it is y, a peer {y,z} becomes z, and
  // so on. Any cell forced to x is an end; (start or end) is x, so any cell seeing both loses x.
  function xyChain(v, cand) {
    let best = null, bestLen = 99;
    for (let start = 0; start < 81; start++) {
      if (bits(cand[start]) !== 2) continue;
      const ds = digitsOf(cand[start]);
      for (let t = 0; t < 2; t++) {
        const x = ds[t], y = ds[1 - t];
        const par = new Int16Array(810).fill(-1), depth = new Int16Array(810); // state = cell * 10 + forced digit
        const s0 = start * 10 + y, queue = [s0];
        par[s0] = s0;
        for (let qi = 0; qi < queue.length; qi++) {
          const e = queue[qi], cell = e / 10 | 0, val = e % 10, dep = depth[e];
          if (dep + 1 >= bestLen) break;
          for (const p of PEERS[cell]) {
            if (p === start || bits(cand[p]) !== 2 || !(cand[p] >> val & 1)) continue;
            const w = lowDigit(cand[p] & ~(1 << val)), ns = p * 10 + w;
            if (par[ns] >= 0) continue;
            par[ns] = e; depth[ns] = dep + 1; queue.push(ns);
            if (w !== x) continue;
            const el = seeAll(cand, x, [start, p]);
            if (!el.length) continue;
            const cells = [];
            let cur = ns, dm = 0;
            for (;;) { cells.push(cur / 10 | 0); dm |= cand[cur / 10 | 0]; if (cur === s0) break; cur = par[cur]; }
            const st = mk('xy-chain', cand, { eliminate: el, units: [], cells: cells.reverse(), digits: digitsOf(dm) });
            if (st && dep + 1 < bestLen) { best = st; bestLen = dep + 1; }
          }
        }
      }
    }
    return best;
  }

  /* ---------- technique table ---------- */
  const FN = {
    'full house': fullHouse,
    'hidden single (box)': hiddenSingle('hidden single (box)', 18, 27),
    'hidden single (line)': hiddenSingle('hidden single (line)', 0, 18),
    'naked single': nakedSingle,
    'locked candidates pointing': pointing,
    'locked candidates claiming': claiming,
    'naked pair': nakedSubset('naked pair', 2),
    'hidden pair': hiddenSubset('hidden pair', 2),
    'naked triple': nakedSubset('naked triple', 3),
    'hidden triple': hiddenSubset('hidden triple', 3),
    'naked quad': nakedSubset('naked quad', 4),
    'hidden quad': hiddenSubset('hidden quad', 4),
    'x-wing': fish('x-wing', 2),
    'swordfish': fish('swordfish', 3),
    'skyscraper': skyscraper,
    '2-string kite': kite,
    'xy-wing': xyWing,
    'xyz-wing': xyzWing,
    'w-wing': wWing,
    'unique rectangle type 1': uniqueRect1,
    'simple colouring': simpleColouring,
    'x-chain': xChain,
    'xy-chain': xyChain
  };

  /* ---------- public API ---------- */
  // Easiest available step, or null. maxTier (optional) stops the search above that tier.
  function nextStep(values, cand, maxTier) {
    for (const o of ORDER) {
      if (maxTier && o[1] > maxTier) break;
      const st = FN[o[0]](values, cand);
      if (st) return st;
    }
    return null;
  }
  // Runs one named technique only (for tests and for hints that want a specific pattern).
  function findStep(tech, values, cand) { return FN[tech] ? FN[tech](values, cand) : null; }

  function applyStep(values, cand, step) {
    if (step.place) for (const p of step.place) {
      values[p.cell] = p.digit; cand[p.cell] = 0;
      for (const q of PEERS[p.cell]) cand[q] &= ~(1 << p.digit);
    }
    for (const e of step.eliminate) cand[e.cell] &= ~(1 << e.digit);
  }

  function parse(puzzle) {
    if (typeof puzzle !== 'string') return Array.prototype.slice.call(puzzle);
    const out = [];
    for (let i = 0; i < 81; i++) { const ch = puzzle.charCodeAt(i) - 48; out.push(ch >= 1 && ch <= 9 ? ch : 0); }
    return out;
  }

  // puzzle: array of 81 ints or an 81-character string ('0' or '.' for empty)
  function grade(puzzle) {
    const values = parse(puzzle), cand = initCandidates(values), counts = {};
    let left = 0, tier = 0, steps = 0;
    for (let i = 0; i < 81; i++) if (!values[i]) left++;
    while (left) {
      const st = nextStep(values, cand);
      if (!st) break;
      applyStep(values, cand, st);
      counts[st.tech] = (counts[st.tech] || 0) + 1;
      if (st.tier > tier) tier = st.tier;
      steps++;
      if (st.place) left -= st.place.length;
    }
    const solved = left === 0;
    return { solved: solved, tier: solved ? Math.max(tier, 1) : 7, counts: counts, steps: steps, values: values };
  }

  return { nextStep: nextStep, findStep: findStep, applyStep: applyStep, initCandidates: initCandidates, grade: grade,
    TECHS: TECHS, TIER: TIER, UNITS: UNITS, PEERS: PEERS };
}
if (typeof module !== 'undefined') module.exports = makeSolver;
