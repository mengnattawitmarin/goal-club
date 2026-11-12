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
function done_(M) {
  const n = Math.max(1, M.n), r = (x) => +x.toFixed(4);
  const cal = M.bins.filter((b) => b.n >= 20); const ece = cal.reduce((s, b) => s + b.n * Math.abs(b.p / b.n - b.y / b.n), 0) / Math.max(1, cal.reduce((s, b) => s + b.n, 0));
  return { n: M.n, logloss: r(M.ll / n), brier: r(M.br / n), rps: r(M.rps / n), hit: r(M.hit / n), loglossOU: r(M.llOU / n), draw: [r(M.pD / n), r(M.aD / n)], home: [r(M.pH / n), r(M.aH / n)], goals: [r(M.pG / n), r(M.aG / n)], calibErr: r(ece) };
}

/* item 17 (motivation): a "dead rubber" side late in the season can neither reach the top 4 nor be caught by the
   relegation places. Same rule as deadRubber() in src/logic.js. table: {teams:{id:{pts,pl}}, n} */
export function deadRubber(T, id) {
  const ids = Object.keys(T.teams), N = ids.length; if (N < 10) return false;
  const me = T.teams[id]; if (!me) return false;
  const total = 2 * (N - 1), left = total - me.pl; if (left > 10 || left <= 0) return false;
  const pts = ids.map((k) => T.teams[k].pts).sort((a, b) => b - a), top = pts[3], drop = pts[N - 3];
  return me.pts + 3 * left < top && me.pts > drop + 3 * left;
}
function seasonTables(past, asOf) {
  const out = {}, cup = /uefa|cup|copa|fa\b|league_cup|libertadores|sudamericana|concacaf|afc/;
  const byLg = {}; for (const x of past) if (!cup.test(x.lg)) (byLg[x.lg] = byLg[x.lg] || []).push(x);
  for (const [lg, list] of Object.entries(byLg)) {
    let startI = 0; for (let i = 1; i < list.length; i++) if (Date.parse(list[i].d) - Date.parse(list[i - 1].d) > 35 * DAY) startI = i;
    if (Date.parse(asOf) - Date.parse(list.at(-1).d) > 35 * DAY) continue;   // between seasons
    const T = { teams: {} };
    for (const x of list.slice(startI)) {
      const h = (T.teams[x.hid] = T.teams[x.hid] || { pts: 0, pl: 0 }), a = (T.teams[x.aid] = T.teams[x.aid] || { pts: 0, pl: 0 });
      h.pl++; a.pl++; if (x.hs > x.as) h.pts += 3; else if (x.hs < x.as) a.pts += 3; else { h.pts++; a.pts++; }
    }
    out[lg] = T;
  }
  return out;
}

const MIX_W = [0, 0.3, 0.5, 0.7, 1];
/* likeliest score three ways (see the score rule above) */
function topScores(lh, la, rho) {
  const pm = (l) => { const v = []; let p = Math.exp(-l); for (let k = 0; k <= 8; k++) { v.push(p); p *= l / (k + 1); } return v; };
  const x = pm(lh), y = pm(la), cells = [];
  let H = 0, D = 0, A = 0, O = 0, B = 0;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { const t = i === 0 && j === 0 ? 1 - lh * la * rho : i === 0 && j === 1 ? 1 + lh * rho : i === 1 && j === 0 ? 1 + la * rho : i === 1 && j === 1 ? 1 - rho : 1; const p = Math.max(0, x[i] * y[j] * t); cells.push([i, j, p]); if (i > j) H += p; else if (i === j) D += p; else A += p; if (i + j >= 3) O += p; if (i > 0 && j > 0) B += p; }
  const s = H + D + A; H /= s; D /= s; A /= s; O /= s; B /= s;
  cells.sort((a, b) => b[2] - a[2]);
  const top = Math.max(H, D, A), r = H === top ? "h" : A === top ? "a" : "d", rc = top < 0.4 && r !== "d" ? (H + D >= A + D ? "hd" : "ad") : r;
  const okR = (c) => (rc === "h" ? c[0] > c[1] : rc === "a" ? c[1] > c[0] : rc === "hd" ? c[0] >= c[1] : rc === "ad" ? c[1] >= c[0] : c[0] === c[1]);
  const okF = (c) => okR(c) && (Math.abs(O - 0.5) < 0.08 || (O >= 0.5 ? c[0] + c[1] >= 3 : c[0] + c[1] <= 2)) && (Math.abs(B - 0.5) < 0.08 || (B >= 0.5 ? c[0] > 0 && c[1] > 0 : c[0] === 0 || c[1] === 0));
  return { max: cells[0], res: cells.find(okR) || cells[0], full: cells.find(okF) || cells.find(okR) || cells[0] };
}

/* national teams (4.1) have no season table: the plain baseline is each competition's average home/away goals over the
   last 3 years (both sides at the average on a neutral ground) — the model must beat knowing nothing about the teams */
function avgTables(past, asOf) {
  const out = {}, lim = Date.parse(asOf) - 3 * 365 * DAY;
  for (const x of past) { if (Date.parse(x.d) < lim) continue; const L = (out[x.lg] = out[x.lg] || { h: 0, a: 0, n: 0 }); L.h += x.hs; L.a += x.as; L.n++; }
  return out;
}
function avgModel(T, m) {
  const L = T[m.lg]; if (!L || L.n < 20) return null;
  const h = L.h / L.n, a = L.a / L.n, mid = (h + a) / 2;
  return m.neutral ? { lh: mid, la: mid, rho: -0.05 } : { lh: Math.max(0.15, h), la: Math.max(0.15, a), rho: -0.05 };
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

/* matches: [{d, lg, hid, aid, hs, as, neutral?, xh?, xa?}] sorted or not; returns metrics for 3.3 and each 4.0 setting.
   Resumable: a Vercel run has under a minute, so pass back the returned `state` and it carries on from the next window;
   `done` is true once every window is tested (the gate is only decided on a complete run).
   A config may carry `blend: w` = expected goals mixed as dc^w x table^(1-w) (an ensemble of the 4.0 core and the 3.3 base). */
export function walkForward(matches, { configs = [{ halfLife: 180, prior: 6 }], stepDays = 14, warmDays = 120, budgetMs = 40000, state = null, base: baseKind = "table", minGain = 0.005 } = {}) {
  const all = matches.filter((m) => m && m.d && Number.isFinite(m.hs) && Number.isFinite(m.as)).sort((a, b) => a.d.localeCompare(b.d));
  if (all.length < 200) return { ok: false, done: true, reason: `ผลย้อนหลังยังน้อย (${all.length} นัด)` };
  const t0 = Date.now(), start = Date.parse(all[0].d) + warmDays * DAY, end = Date.parse(all.at(-1).d) + DAY;
  const S = state && state.v === 3 && state.n0 === all.length && state.cfgKey === JSON.stringify(configs) ? state : {
    v: 3, n0: all.length, cfgKey: JSON.stringify(configs), t: start, windows: 0, startedAt: new Date().toISOString(),
    base: metrics(), byCfg: configs.map(() => metrics()), byLg: {}, byLgW: {}, score: { n: 0, max: 0, res: 0, full: 0 },
    ctx: { short: { g: 0, x: 0, n: 0 }, normal: { g: 0, x: 0, n: 0 }, deadFor: { g: 0, x: 0, n: 0 }, deadAg: { g: 0, x: 0, n: 0 } },
  };
  const { base, byCfg, byLg, byLgW, score, ctx } = S;
  /* 4.2: the two cores merged per league — each league is scored at dc^w x table^(1-w) for these w, on the reference fit */
  const ref = Math.max(0, configs.findIndex((c) => c.halfLife === 240 && c.prior === 6 && !c.xgW && c.blend == null && !c.lgW));
  /* item 17: does a short rest (3 days or fewer since the team's last game in any competition) change scoring?
     measured as actual goals / expected goals of the 4.0 core, so the app can use the measured effect */
  const dates = {}; for (const m of all) for (const id of [m.hid, m.aid]) (dates[id] = dates[id] || []).push(Date.parse(m.d));
  const restOf = (id, d) => { const t = Date.parse(d), arr = dates[id] || []; let prev = null; for (const x of arr) { if (x < t) prev = x; else break; } return prev == null ? null : (t - prev) / DAY; };
  const keyOf = (c) => `${c.halfLife}|${c.prior}|${c.xgW || 0}`;
  const mix = (a, b, w) => Math.exp(w * Math.log(a) + (1 - w) * Math.log(b));
  while (S.t < end) {
    if (Date.now() - t0 > budgetMs) break;
    const t = S.t, asOf = day(t), until = day(t + stepDays * DAY);
    S.t = t + stepDays * DAY;
    const past = all.filter((m) => m.d < asOf), test = all.filter((m) => m.d >= asOf && m.d < until);
    if (!test.length) continue;
    const fits = {}; for (const c of configs) { const k = keyOf(c); if (!fits[k]) fits[k] = fitDC(past, { ...c, asOf, iters: 20 }); }
    const models = configs.map((c) => fits[keyOf(c)]), TB = baseKind === "avg" ? avgTables(past, asOf) : tables(past, asOf), ST = baseKind === "avg" ? {} : seasonTables(past, asOf);
    for (const m of test) {
      const tb = baseKind === "avg" ? avgModel(TB, m) : tableModel(TB, m); if (!tb) continue;   // compare on the same matches only
      const pb = probs(tb.lh, tb.la, tb.rho); add(base, pb, m, tb.lh + tb.la);
      configs.forEach((c, i) => {
        const l = lambdas(models[i], m), w = c.blend;
        const lh = w != null ? mix(l.lh, tb.lh, w) : l.lh, la = w != null ? mix(l.la, tb.la, w) : l.la;
        add(byCfg[i], probs(lh, la, l.rho), m, lh + la);
      });
      { const l = lambdas(models[0], m); for (const [id, g, x] of [[m.hid, m.hs, l.lh], [m.aid, m.as, l.la]]) { const r = restOf(id, m.d); if (r == null || r > 30) continue; const c = r <= 3 ? ctx.short : r >= 5 ? ctx.normal : null; if (c) { c.g += g; c.x += x; c.n++; } } }
      if (ST[m.lg]) { const l = lambdas(models[0], m); for (const [id, g, x, ga, xa] of [[m.hid, m.hs, l.lh, m.as, l.la], [m.aid, m.as, l.la, m.hs, l.lh]]) if (deadRubber(ST[m.lg], id)) { ctx.deadFor.g += g; ctx.deadFor.x += x; ctx.deadFor.n++; ctx.deadAg.g += ga; ctx.deadAg.x += xa; ctx.deadAg.n++; } }
      { const l = lambdas(models[ref], m), W = (byLgW[m.lg] = byLgW[m.lg] || Object.fromEntries(MIX_W.map((w) => [w, metrics()])));
        for (const w of MIX_W) { const lh = mix(l.lh, tb.lh, w), la = mix(l.la, tb.la, w); add(W[w], probs(lh, la, w === 0 ? tb.rho : l.rho), m, lh + la); }
        /* which way of naming one score hits most often: the single likeliest score, the likeliest with the predicted result,
           or also agreeing with confident over/under and both-score calls (what the app did) */
        const t = topScores(l.lh, l.la, l.rho); score.n++; if (t.max[0] === m.hs && t.max[1] === m.as) score.max++; if (t.res[0] === m.hs && t.res[1] === m.as) score.res++; if (t.full[0] === m.hs && t.full[1] === m.as) score.full++; }
      const L = (byLg[m.lg] = byLg[m.lg] || { base: metrics(), best: metrics() });
      add(L.base, pb, m, tb.lh + tb.la); const l0 = lambdas(models[0], m); add(L.best, probs(l0.lh, l0.la, l0.rho), m, l0.lh + l0.la);
    }
    S.windows++;
  }
  const done = S.t >= end;
  const out = configs.map((c, i) => ({ ...c, ...done_(byCfg[i]) }));
  const best = out.slice().sort((a, b) => a.logloss - b.logloss)[0];
  const b = done_(base);
  const progress = Math.min(1, (S.t - start) / Math.max(1, end - start));
  /* per-league choice: needs 300+ matches and must beat the overall choice by 0.003, else the overall choice stands */
  const gW = best.blend != null ? best.blend : 1, leagueChoice = {}, goalsCal = {}; let mergedLL = 0, mergedN = 0, gG = 0, gX = 0;
  for (const [lg, W] of Object.entries(byLgW)) {
    const sc = MIX_W.map((w) => ({ w, M: W[w] })).filter((x) => x.M.n > 0); if (!sc.length) continue;
    const n = sc[0].M.n, ll = (w) => W[w].ll / Math.max(1, W[w].n), top = sc.slice().sort((a, b) => ll(a.w) - ll(b.w))[0];
    const gw = MIX_W.includes(gW) ? gW : 1, w = n >= 300 && ll(top.w) < ll(gw) - 0.003 ? top.w : gw;
    leagueChoice[lg] = { w, n, ll: +ll(w).toFixed(4), ll33: +ll(0).toFixed(4), llDc: +ll(1).toFixed(4) };
    mergedLL += W[w].ll; mergedN += W[w].n;
    /* goals: actual / expected of the chosen mix, shrunk toward 1 with 500 pseudo-matches */
    const g = W[w].aG, x = W[w].pG; gG += g; gX += x; if (x > 0) goalsCal[lg] = +Math.pow(g / x, W[w].n / (W[w].n + 500)).toFixed(3);
  }
  if (gX > 0) goalsCal.all = +(gG / gX).toFixed(3);
  const merged = mergedN ? { n: mergedN, logloss: +(mergedLL / mergedN).toFixed(4) } : null;
  const rule = score.n ? ["full", "res", "max"].sort((a, b) => score[b] - score[a])[0] : null;
  const scoreRules = score.n ? { n: score.n, max: +(score.max / score.n).toFixed(4), res: +(score.res / score.n).toFixed(4), full: +(score.full / score.n).toFixed(4), rule } : null;
  return {
    ok: true, done, state: done ? null : S, progress: +progress.toFixed(3),
    at: new Date().toISOString(), startedAt: S.startedAt, matches: all.length, windows: S.windows, partial: !done,
    base33: b, configs: out, best,
    gain: +(b.logloss - best.logloss).toFixed(4),
    pass: done && best.n >= 300 && b.logloss - Math.min(best.logloss, merged?.logloss ?? 9) >= minGain, minGain, base: baseKind,
    merged, leagueChoice, goalsCal, scoreRules,
    context: { shortRest: { n: ctx.short.n, ratio: ctx.short.x ? +(ctx.short.g / ctx.short.x).toFixed(3) : null }, normalRest: { n: ctx.normal.n, ratio: ctx.normal.x ? +(ctx.normal.g / ctx.normal.x).toFixed(3) : null },
      deadFor: { n: ctx.deadFor.n, ratio: ctx.deadFor.x ? +(ctx.deadFor.g / ctx.deadFor.x).toFixed(3) : null }, deadAgainst: { n: ctx.deadAg.n, ratio: ctx.deadAg.x ? +(ctx.deadAg.g / ctx.deadAg.x).toFixed(3) : null } },
    leagues: Object.fromEntries(Object.entries(byLg).filter(([, v]) => v.base.n >= 40).map(([k, v]) => [k, { base33: done_(v.base), v40: done_(v.best) }])),
  };
}
