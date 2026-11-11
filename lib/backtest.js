// เมดูซ่า 4.0 (plan items 1-2): walk-forward backtest. Every prediction uses only matches played
// before its own day, the way the app would have seen them. Compares the 4.0 Dixon-Coles core with a
// replica of the 3.3 base (season table, home x1.18 / away x0.9), per league, and picks the settings.
import { fitDC, lambdas, probs } from "./dc.js";

const DAY = 864e5;
const day = (t) => new Date(t).toISOString().slice(0, 10);
const res = (m) => (m.hs > m.as ? 0 : m.hs === m.as ? 1 : 2);

function metrics() { return { n: 0, ll: 0, br: 0, rps: 0, hit: 0, llOU: 0, pD: 0, aD: 0, pH: 0, aH: 0, pG: 0, aG: 0, bins: Array.from({ length: 10 }, () => ({ p: 0, y: 0, n: 0 })) }; }
function add(M, p, m, total) {
  const o = res(m), P = [p.home, p.draw, p.away];
  M.n++; M.ll += -Math.log(Math.max(1e-6, P[o])); M.br += P.reduce((s, x, i) => s + (x - (i === o ? 1 : 0)) ** 2, 0);
  const c1 = P[0] - (o === 0), c2 = P[0] + P[1] - (o <= 1); M.rps += (c1 * c1 + c2 * c2) / 2;
  if (P.indexOf(Math.max(...P)) === o) M.hit++;
  const ov = m.hs + m.as >= 3; M.llOU += -Math.log(Math.max(1e-6, ov ? p.over25 : 1 - p.over25));
  M.pD += p.draw; M.aD += o === 1; M.pH += p.home; M.aH += o === 0; M.pG += total; M.aG += m.hs + m.as;
  for (const [q, y] of [[p.home, o === 0], [p.draw, o === 1], [p.away, o === 2]]) { const b = M.bins[Math.min(9, Math.floor(q * 10))]; b.p += q; b.y += y; b.n++; }
}
function done(M) {
  const n = Math.max(1, M.n), r = (x) => +x.toFixed(4);
  const cal = M.bins.filter((b) => b.n >= 20); const ece = cal.reduce((s, b) => s + b.n * Math.abs(b.p / b.n - b.y / b.n), 0) / Math.max(1, cal.reduce((s, b) => s + b.n, 0));
  return { n: M.n, logloss: r(M.ll / n), brier: r(M.br / n), rps: r(M.rps / n), hit: r(M.hit / n), loglossOU: r(M.llOU / n), draw: [r(M.pD / n), r(M.aD / n)], home: [r(M.pH / n), r(M.aH / n)], goals: [r(M.pG / n), r(M.aG / n)], calibErr: r(ece) };
}

/* 3.3 base replica: season-to-date table per league (last 300 days) with shrinkage toward the league average */
function tables(past, asOf) {
  const out = {}, lim = Date.parse(asOf) - 300 * DAY;
  for (const x of past) {
    if (Date.parse(x.d) < lim) continue;
    const L = (out[x.lg] = out[x.lg] || { g: 0, n: 0, t: {} });
    L.g += x.hs + x.as; L.n++;
    const h = (L.t[x.hid] = L.t[x.hid] || { gf: 0, ga: 0, n: 0 }), a = (L.t[x.aid] = L.t[x.aid] || { gf: 0, ga: 0, n: 0 });
    h.gf += x.hs; h.ga += x.as; h.n++; a.gf += x.as; a.ga += x.hs; a.n++;
  }
  return out;
}
function tableModel(T, m) {
  const L = T[m.lg]; if (!L || L.n < 20) return null;
  const avg = L.g / L.n / 2, z = { gf: 0, ga: 0, n: 0 }, H = L.t[m.hid] || z, A = L.t[m.aid] || z;
  const sh = (g, n) => (g + 6 * avg) / (n + 6);
  const lh = (sh(H.gf, H.n) / avg) * (sh(A.ga, A.n) / avg) * avg * 1.18, la = (sh(A.gf, A.n) / avg) * (sh(H.ga, H.n) / avg) * avg * 0.9;
  return { lh: Math.min(4.2, Math.max(0.15, lh)), la: Math.min(4.2, Math.max(0.15, la)), rho: -0.08 };
}

/* matches: [{d, lg, hid, aid, hs, as, neutral?, xh?, xa?}] sorted or not; returns metrics for 3.3 and each 4.0 setting */
export function walkForward(matches, { configs = [{ halfLife: 180, prior: 6 }], stepDays = 14, warmDays = 120, budgetMs = 40000 } = {}) {
  const all = matches.filter((m) => m && m.d && Number.isFinite(m.hs) && Number.isFinite(m.as)).sort((a, b) => a.d.localeCompare(b.d));
  if (all.length < 200) return { ok: false, reason: `ผลย้อนหลังยังน้อย (${all.length} นัด)` };
  const t0 = Date.now(), start = Date.parse(all[0].d) + warmDays * DAY, end = Date.parse(all.at(-1).d) + DAY;
  const base = metrics(), byCfg = configs.map(() => metrics()), byLg = {};
  let windows = 0;
  for (let t = start; t < end; t += stepDays * DAY) {
    if (Date.now() - t0 > budgetMs) break;
    const asOf = day(t), until = day(t + stepDays * DAY);
    const past = all.filter((m) => m.d < asOf), test = all.filter((m) => m.d >= asOf && m.d < until);
    if (!test.length) continue;
    const models = configs.map((c) => fitDC(past, { ...c, asOf, iters: 20 })), TB = tables(past, asOf);
    for (const m of test) {
      const tb = tableModel(TB, m); if (!tb) continue;   // compare on the same matches only
      const pb = probs(tb.lh, tb.la, tb.rho); add(base, pb, m, tb.lh + tb.la);
      models.forEach((md, i) => { const l = lambdas(md, m); add(byCfg[i], probs(l.lh, l.la, l.rho), m, l.lh + l.la); });
      const L = (byLg[m.lg] = byLg[m.lg] || { base: metrics(), best: metrics() });
      add(L.base, pb, m, tb.lh + tb.la); const l0 = lambdas(models[0], m); add(L.best, probs(l0.lh, l0.la, l0.rho), m, l0.lh + l0.la);
    }
    windows++;
  }
  const out = configs.map((c, i) => ({ ...c, ...done(byCfg[i]) }));
  const best = out.slice().sort((a, b) => a.logloss - b.logloss)[0];
  const b = done(base);
  return {
    ok: true, at: new Date().toISOString(), matches: all.length, windows, partial: Date.now() - t0 > budgetMs,
    base33: b, configs: out, best,
    gain: +(b.logloss - best.logloss).toFixed(4),
    pass: best.n >= 300 && b.logloss - best.logloss >= 0.005,
    leagues: Object.fromEntries(Object.entries(byLg).filter(([, v]) => v.base.n >= 40).map(([k, v]) => [k, { base33: done(v.base), v40: done(v.best) }])),
  };
}
