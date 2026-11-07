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
    n,
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
