// เมดูซ่า: where past predictions went wrong, from the settled history rows (hist).
// Pure function so it can be tested; used by GET /api/store as `audit`.
const RHO = -0.08, MAXG = 8;
const pmf = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
function grid(lh, la) {
  const g = []; let s = 0;
  for (let h = 0; h <= MAXG; h++) { g[h] = []; for (let a = 0; a <= MAXG; a++) {
    let p = pmf(h, lh) * pmf(a, la);
    if (h === 0 && a === 0) p *= 1 - lh * la * RHO; else if (h === 0 && a === 1) p *= 1 + lh * RHO; else if (h === 1 && a === 0) p *= 1 + la * RHO; else if (h === 1 && a === 1) p *= 1 - RHO;
    g[h][a] = Math.max(0, p); s += g[h][a]; } }
  const cells = []; g.forEach((r, h) => r.forEach((p, a) => cells.push({ h, a, p: p / s })));
  return cells.sort((x, y) => y.p - x.p);
}
function coherent(cells) {
  let H = 0, D = 0, A = 0, O = 0, B = 0;
  for (const c of cells) { if (c.h > c.a) H += c.p; else if (c.h === c.a) D += c.p; else A += c.p; if (c.h + c.a >= 3) O += c.p; if (c.h && c.a) B += c.p; }
  let r = H >= A && H >= D ? "h" : A >= D ? "a" : "d";
  if (Math.max(H, D, A) < 0.4 && r !== "d") r = H + D >= A + D ? "hd" : "ad"; /* เมดูซ่า 3.3: close game -> "does not lose" */
  const ps = [(h, a) => (r === "h" ? h > a : r === "a" ? a > h : r === "hd" ? h >= a : r === "ad" ? a >= h : h === a), O >= 0.5 ? (h, a) => h + a >= 3 : (h, a) => h + a <= 2];
  if (Math.abs(B - 0.5) >= 0.06) ps.push(B >= 0.5 ? (h, a) => h > 0 && a > 0 : (h, a) => h === 0 || a === 0);
  for (let k = ps.length; k >= 0; k--) { const ok = cells.find((c) => ps.slice(0, k).every((f) => f(c.h, c.a))); if (ok) return ok; }
  return cells[0];
}
const share = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, +(v / n).toFixed(3)]);

export function audit(rows) {
  const R = (rows || []).filter((r) => r && r.lh0 > 0 && r.la0 > 0 && Number.isFinite(r.hs) && Number.isFinite(r.as));
  const n = R.length; if (n < 10) return { n };
  let pT = 0, aT = 0, pD = 0, aD = 0, pH = 0, aH = 0, resOk = 0, mkN = 0, mkOk = 0, modOk = 0, cohOk = 0, pO = 0, aO = 0;
  const actual = {}, modal = {}, coh = {}, lg = {};
  for (const r of R) {
    const res = r.hs > r.as ? "h" : r.hs === r.as ? "d" : "a";
    const ph = r.ph ?? null, pa = r.pa ?? null, pd = ph != null && pa != null ? 1 - ph - pa : null;
    pT += r.lh0 + r.la0; aT += r.hs + r.as;
    if (pd != null) { pD += pd; pH += ph; const call = ph >= pa && ph >= pd ? "h" : pa >= pd ? "a" : "d"; if (call === res) resOk++;
      const L = (lg[r.lg] = lg[r.lg] || { n: 0, ok: 0, goals: 0, pred: 0 }); L.n++; if (call === res) L.ok++; L.goals += r.hs + r.as; L.pred += r.lh0 + r.la0; }
    aD += res === "d"; aH += res === "h"; aO += r.hs + r.as >= 3;
    if (r.mh && r.md && r.ma) { mkN++; const k = r.mh >= r.ma && r.mh >= r.md ? "h" : r.ma >= r.md ? "a" : "d"; if (k === res) mkOk++; }
    const cells = grid(r.lh0, r.la0), m = cells[0], c = coherent(cells);
    pO += cells.filter((x) => x.h + x.a >= 3).reduce((s, x) => s + x.p, 0);
    const sc = `${r.hs}-${r.as}`; actual[sc] = (actual[sc] || 0) + 1;
    modal[`${m.h}-${m.a}`] = (modal[`${m.h}-${m.a}`] || 0) + 1; coh[`${c.h}-${c.a}`] = (coh[`${c.h}-${c.a}`] || 0) + 1;
    if (m.h === r.hs && m.a === r.as) modOk++; if (c.h === r.hs && c.a === r.as) cohOk++;
  }
  const leagues = Object.entries(lg).filter(([, v]) => v.n >= 15).map(([k, v]) => ({ lg: k, n: v.n, acc: +(v.ok / v.n).toFixed(3), goals: +(v.goals / v.n).toFixed(2), pred: +(v.pred / v.n).toFixed(2) })).sort((a, b) => a.acc - b.acc);
  return {
    n, core: coreCheck(R),
    goals: { pred: +(pT / n).toFixed(2), actual: +(aT / n).toFixed(2) },
    over25: { pred: +(pO / n).toFixed(3), actual: +(aO / n).toFixed(3) },
    draw: { pred: +(pD / n).toFixed(3), actual: +(aD / n).toFixed(3) },
    home: { pred: +(pH / n).toFixed(3), actual: +(aH / n).toFixed(3) },
    result: { model: +(resOk / n).toFixed(3), market: mkN ? +(mkOk / mkN).toFixed(3) : null, mkN },
    exact: { modal: +(modOk / n).toFixed(3), coherent: +(cohOk / n).toFixed(3) },
    scores: { actual: share(actual, n), modal: share(modal, n), coherent: share(coh, n) },
    leagues: leagues.slice(0, 4),
  };
}

/* เมดูซ่า 4.0 (ข้อ 19): daily model-vs-market evaluation straight from the settled history.
   The old "evals" were written only for matches the daily job settled; most matches are settled
   by the apps (store POST results) first, so the accuracy page counted ~20 of 449. */
export function evalsFromHist(rows) {
  const out = {};
  const ll = (p, o) => -Math.log(Math.max(1e-6, p[o]));
  const br = (p, o) => p.reduce((s, x, i) => s + (x - (i === o ? 1 : 0)) ** 2, 0);
  for (const r of rows || []) {
    if (!r || !r.d || r.ph == null || r.pa == null || !Number.isFinite(r.hs) || !Number.isFinite(r.as)) continue;
    const o = r.hs > r.as ? 0 : r.hs === r.as ? 1 : 2, pm = [r.ph, Math.max(0, 1 - r.ph - r.pa), r.pa];
    const e = (out[r.d] = out[r.d] || { n: 0, llM: 0, llK: 0, nK: 0, brM: 0, brK: 0, hitM: 0, hitK: 0 });
    e.n++; e.llM += ll(pm, o); e.brM += br(pm, o); if (pm.indexOf(Math.max(...pm)) === o) e.hitM++;
    if (r.mh && r.md && r.ma) { const s = r.mh + r.md + r.ma, pk = [r.mh / s, r.md / s, r.ma / s]; e.nK++; e.llK += ll(pk, o); e.brK += br(pk, o); if (pk.indexOf(Math.max(...pk)) === o) e.hitK++; }
  }
  return out;
}

/* เมดูซ่า 4.0 (items 11, 13): calibration taken from the FINAL numbers the app showed.
   goals: actual goals / expected (rows that carry the final λ) · temp: 1X2 temperature that minimises log loss */
export function finalCalib(rows) {
  const R = (rows || []).filter((r) => r && Number.isFinite(r.hs) && Number.isFinite(r.as));
  const G = R.filter((r) => r.lhF > 0 && r.laF > 0);
  const out = { n: G.length, goals: G.length ? +(G.reduce((s, r) => s + r.hs + r.as, 0) / G.reduce((s, r) => s + r.lhF + r.laF, 0)).toFixed(4) : null };
  const P = R.filter((r) => r.ph > 0 && r.pa > 0 && r.ph + r.pa < 1);
  let best = 1, bestL = Infinity;
  for (let t = 0.8; t <= 1.2501; t += 0.01) {
    let L = 0;
    for (const r of P) { const q = [r.ph, 1 - r.ph - r.pa, r.pa].map((x) => Math.max(1e-6, x) ** (1 / t)), z = q[0] + q[1] + q[2], o = r.hs > r.as ? 0 : r.hs === r.as ? 1 : 2; L -= Math.log(q[o] / z); }
    if (L < bestL) { bestL = L; best = t; }
  }
  out.temp = +best.toFixed(2); out.nT = P.length;
  return out;
}

/* เมดูซ่า 4.0 (items 3, 24): picks judged against the market's fair price and split by kind */
export function picksAudit(rows) {
  const val = { win: 1, half: 0.75, push: 0.5, halflose: 0.25, lose: 0 };
  const out = { all: { n: 0, prob: 0, fair: 0, nF: 0, hit: 0 } };
  for (const r of rows || []) {
    if (!r || !(r.res in val)) continue;
    for (const k of ["all", r.kind || "?"]) {
      const o = (out[k] = out[k] || { n: 0, prob: 0, fair: 0, nF: 0, hit: 0 });
      o.n++; o.prob += +r.prob || 0; o.hit += val[r.res]; if (r.fair > 0) { o.fair += r.fair; o.nF++; }
    }
  }
  for (const k in out) { const o = out[k]; out[k] = { n: o.n, prob: o.n ? +(o.prob / o.n).toFixed(3) : null, hit: o.n ? +(o.hit / o.n).toFixed(3) : null, fair: o.nF ? +(o.fair / o.nF).toFixed(3) : null, nF: o.nF }; }
  return out;
}

/* เมดูซ่า 4.0 (item 18): how good the in-play numbers were around the hour mark */
export function liveAudit(rows) {
  const R = (rows || []).filter((r) => r && Number.isFinite(r.hs) && Number.isFinite(r.as) && r.ph >= 0);
  if (!R.length) return { n: 0 };
  let ll = 0, hit = 0, exact = 0, ou = 0, nOU = 0;
  for (const r of R) {
    const o = r.hs > r.as ? 0 : r.hs === r.as ? 1 : 2, p = [r.ph, r.pd, r.pa];
    ll -= Math.log(Math.max(1e-6, p[o])); if (p.indexOf(Math.max(...p)) === o) hit++; if (r.fh === r.hs && r.fa === r.as) exact++;
    if (r.o25 != null) { nOU++; ou -= Math.log(Math.max(1e-6, r.hs + r.as >= 3 ? r.o25 : 1 - r.o25)); }
  }
  return { n: R.length, logloss: +(ll / R.length).toFixed(4), hit: +(hit / R.length).toFixed(3), exact: +(exact / R.length).toFixed(3), loglossOU: nOU ? +(ou / nOU).toFixed(4) : null };
}

/* เมดูซ่า 4.0 (item 14): opening vs closing price vs the model on the same matches.
   If the close beats the open, the market learns something between them (team news), and the model should listen to the close */
export function lineMove(rows) {
  const R = (rows || []).filter((r) => r && Number.isFinite(r.hs) && Number.isFinite(r.as) && r.oh > 0 && r.od > 0 && r.oa > 0 && r.mh > 0 && r.md > 0 && r.ma > 0 && r.ph >= 0 && r.pa >= 0);
  if (!R.length) return { n: 0 };
  let lO = 0, lC = 0, lM = 0, toward = 0, moved = 0;
  for (const r of R) {
    const o = r.hs > r.as ? 0 : r.hs === r.as ? 1 : 2, O = [r.oh, r.od, r.oa], C = [r.mh, r.md, r.ma], M = [r.ph, Math.max(0, 1 - r.ph - r.pa), r.pa];
    lO -= Math.log(Math.max(1e-6, O[o])); lC -= Math.log(Math.max(1e-6, C[o])); lM -= Math.log(Math.max(1e-6, M[o]));
    const d = C[o] - O[o]; if (Math.abs(r.mh - r.oh) >= 0.03) { moved++; if (d > 0) toward++; }
  }
  const n = R.length, f = (x) => +(x / n).toFixed(4);
  return { n, open: f(lO), close: f(lC), model: f(lM), moved, toward: moved ? +(toward / moved).toFixed(3) : null };
}

/* 4.2: real results, new core vs the 3.3 path, both after the market blend (only matches where the app sent both) */
export function coreCheck(rows) {
  let n = 0, ll = 0, ll33 = 0;
  for (const r of rows || []) {
    if (!(r && r.ph33 > 0 && r.pa33 > 0 && r.ph >= 0 && r.pa >= 0 && Number.isFinite(r.hs) && Number.isFinite(r.as))) continue;
    const o = r.hs > r.as ? 0 : r.hs === r.as ? 1 : 2, P = [r.ph, 1 - r.ph - r.pa, r.pa], Q = [r.ph33, 1 - r.ph33 - r.pa33, r.pa33];
    ll -= Math.log(Math.max(1e-6, P[o])); ll33 -= Math.log(Math.max(1e-6, Q[o])); n++;
  }
  return { n, ll: n ? +(ll / n).toFixed(4) : null, ll33: n ? +(ll33 / n).toFixed(4) : null };
}
