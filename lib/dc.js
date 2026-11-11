// เมดูซ่า 4.0 core: one Dixon-Coles team-strength model fitted on every match at once.
// Replaces the table + 5-game form + home/away form + h2h + rating layers of 3.3 (plan items 4-10, 22, 23).
//
//   home goals ~ Poisson(mu_L * home_L * att_home * def_away)     (home_L = 1 at a neutral ground)
//   away goals ~ Poisson(mu_L * att_away * def_home)
//   low scores corrected by rho_L (Dixon-Coles)
//
// - recent matches weigh more: weight = 0.5 ^ (age / halfLife)
// - opponents' strength is in the fit itself (a 3-0 against the bottom side counts for less)
// - one strength per team across all competitions: European and cup games tie the leagues together,
//   so a Scottish side and a Spanish side can be compared (items 5, 23)
// - shrinkage: every team starts from `prior` pseudo-games at the league level; a team with almost no
//   matches in its league (usually just promoted) starts below average instead (item 6)
// - home advantage and the draw correction are learned per competition (items 9, 22)

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const DAY = 864e5;

/* m: {d:'YYYY-MM-DD', lg, hid, aid, hs, as, neutral?, xh?, xa?}  (xh/xa: expected goals from shots, optional) */
export function fitDC(matches, opt = {}) {
  const asOf = Date.parse(opt.asOf || new Date().toISOString().slice(0, 10));
  const halfLife = opt.halfLife ?? 180, prior = opt.prior ?? 6, iters = opt.iters ?? 30, xgW = opt.xgW ?? 0;
  const rows = [];
  for (const m of matches) {
    const t = Date.parse(m.d); if (!(t < asOf) || !Number.isFinite(m.hs) || !Number.isFinite(m.as)) continue;
    const w = Math.pow(0.5, (asOf - t) / DAY / halfLife); if (w < 0.02) continue;
    /* item 12: blend goals with shot-based expected goals when the feed has them */
    const gh = xgW && Number.isFinite(m.xh) ? (1 - xgW) * m.hs + xgW * m.xh : m.hs;
    const ga = xgW && Number.isFinite(m.xa) ? (1 - xgW) * m.as + xgW * m.xa : m.as;
    rows.push({ ...m, w, gh, ga });
  }
  const T = {}, L = {};
  const team = (id, lg) => (T[id] = T[id] || { att: 1, def: 1, n: 0, home: {}, lg: null, lgs: {} });
  for (const r of rows) {
    const lg = (L[r.lg] = L[r.lg] || { mu: 1.35, home: 1.15, rho: -0.05, n: 0, g: 0 });
    lg.n += r.w; lg.g += r.w * (r.gh + r.ga);
    for (const id of [r.hid, r.aid]) { const x = team(id); x.n += r.w; x.lgs[r.lg] = (x.lgs[r.lg] || 0) + r.w; }
  }
  for (const k in L) L[k].mu = L[k].n ? L[k].g / L[k].n / 2 : 1.35;
  /* each team's "home" league = where most of its weighted games are (domestic leagues before cups) */
  const cup = (lg) => /uefa|cup|copa|fa\b|league_cup|libertadores|sudamericana|concacaf|afc/.test(lg);
  for (const id in T) { const e = Object.entries(T[id].lgs).sort((a, b) => (cup(a[0]) - cup(b[0])) || b[1] - a[1]); T[id].lg = e[0]?.[0] || null; }
  /* new to the league (little weight) -> start below average, like a promoted side */
  for (const id in T) { const x = T[id]; x.a0 = x.n < 3 ? 0.88 : 1; x.d0 = x.n < 3 ? 1.12 : 1; x.att = x.a0; x.def = x.d0; }

  const mean = (lg) => L[lg]?.mu || 1.35;
  for (let it = 0; it < iters; it++) {
    /* attack */
    const num = {}, den = {};
    for (const r of rows) {
      const lg = L[r.lg], hm = r.neutral ? 1 : lg.home, H = T[r.hid], A = T[r.aid];
      const eh = lg.mu * hm * A.def, ea = lg.mu * H.def;   // expected / att
      num[r.hid] = (num[r.hid] || 0) + r.w * r.gh; den[r.hid] = (den[r.hid] || 0) + r.w * eh;
      num[r.aid] = (num[r.aid] || 0) + r.w * r.ga; den[r.aid] = (den[r.aid] || 0) + r.w * ea;
    }
    for (const id in T) { const x = T[id], m = mean(x.lg); x.att = clamp((( num[id] || 0) + prior * x.a0 * m) / ((den[id] || 0) + prior * m), 0.2, 4); }
    /* defence */
    const nd = {}, dd = {};
    for (const r of rows) {
      const lg = L[r.lg], hm = r.neutral ? 1 : lg.home, H = T[r.hid], A = T[r.aid];
      nd[r.aid] = (nd[r.aid] || 0) + r.w * r.gh; dd[r.aid] = (dd[r.aid] || 0) + r.w * lg.mu * hm * H.att;
      nd[r.hid] = (nd[r.hid] || 0) + r.w * r.ga; dd[r.hid] = (dd[r.hid] || 0) + r.w * lg.mu * A.att;
    }
    for (const id in T) { const x = T[id], m = mean(x.lg); x.def = clamp(((nd[id] || 0) + prior * x.d0 * m) / ((dd[id] || 0) + prior * m), 0.2, 4); }
    /* league level and home advantage (home with a mild prior at 1.15, 30 pseudo-games) */
    const lg_ = {};
    for (const r of rows) {
      const lg = L[r.lg], H = T[r.hid], A = T[r.aid], hm = r.neutral ? 1 : lg.home;
      const o = (lg_[r.lg] = lg_[r.lg] || { g: 0, e: 0, hg: 0, he: 0 });
      o.g += r.w * (r.gh + r.ga); o.e += r.w * (hm * H.att * A.def + A.att * H.def);
      if (!r.neutral) { o.hg += r.w * r.gh; o.he += r.w * lg.mu * H.att * A.def; }
    }
    for (const k in lg_) { const o = lg_[k], lg = L[k]; lg.mu = clamp(o.g / Math.max(1e-9, o.e), 0.5, 2.5); lg.home = clamp((o.hg + 30 * 1.15 * 1.3) / (o.he + 30 * 1.3), 0.85, 1.6); }
    /* keep the average team at 1 across ALL teams (not per league): a league whose teams lose their European games
       keeps lower ratings, which is what makes cross-league matches comparable; mu_L absorbs the domestic level */
    if (it % 5 === 4) {
      const ids = Object.keys(T); const ga = Math.exp(ids.reduce((s, id) => s + Math.log(T[id].att), 0) / ids.length), gd = Math.exp(ids.reduce((s, id) => s + Math.log(T[id].def), 0) / ids.length);
      for (const id of ids) { T[id].att /= ga; T[id].def /= gd; }
      for (const k in L) L[k].mu *= ga * gd;
    }
  }
  /* draw / low-score correction per competition, shrunk toward -0.05 */
  for (const k in L) {
    const rs = rows.filter((r) => r.lg === k && r.hs <= 1 && r.as <= 1); let best = -0.05, bestV = -Infinity;
    for (let rho = -0.25; rho <= 0.15001; rho += 0.01) {
      let v = -150 * (rho + 0.05) ** 2;
      for (const r of rs) { const { lh, la } = lambdas({ T, L }, r); v += r.w * Math.log(Math.max(1e-6, tau(r.hs, r.as, lh, la, rho))); }
      if (v > bestV) { bestV = v; best = rho; }
    }
    L[k].rho = +best.toFixed(2);
  }
  const teams = {}; for (const id in T) teams[id] = { att: +T[id].att.toFixed(4), def: +T[id].def.toFixed(4), n: +T[id].n.toFixed(1), lg: T[id].lg };
  const leagues = {}; for (const k in L) leagues[k] = { mu: +L[k].mu.toFixed(4), home: +L[k].home.toFixed(4), rho: L[k].rho, n: +L[k].n.toFixed(1) };
  return { teams, leagues, asOf: new Date(asOf).toISOString().slice(0, 10), halfLife, prior, xgW, rows: rows.length };
}

export function tau(h, a, lh, la, rho) {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

/* expected goals for one match from a fitted model; unknown teams sit at the league level */
export function lambdas(model, m) {
  const T = model.T || model.teams, L = model.L || model.leagues;
  const lg = L[m.lg] || { mu: 1.35, home: 1.15, rho: -0.05 };
  const H = T[m.hid] || { att: 1, def: 1, n: 0 }, A = T[m.aid] || { att: 1, def: 1, n: 0 };
  const hm = m.neutral ? 1 : lg.home;
  return { lh: clamp(lg.mu * hm * H.att * A.def, 0.1, 5), la: clamp(lg.mu * A.att * H.def, 0.1, 5), rho: lg.rho ?? -0.05, known: (H.n || 0) >= 3 && (A.n || 0) >= 3 };
}

/* 1X2 / over 2.5 / exact-score grid from expected goals */
export function probs(lh, la, rho = -0.05, maxg = 10) {
  const pm = (l) => { const v = []; let p = Math.exp(-l); for (let k = 0; k <= maxg; k++) { v.push(p); p *= l / (k + 1); } return v; };
  const x = pm(lh), y = pm(la); let H = 0, D = 0, A = 0, O = 0, s = 0; const g = [];
  for (let i = 0; i <= maxg; i++) { g[i] = []; for (let j = 0; j <= maxg; j++) { const p = Math.max(0, x[i] * y[j] * tau(i, j, lh, la, rho)); g[i][j] = p; s += p; } }
  for (let i = 0; i <= maxg; i++) for (let j = 0; j <= maxg; j++) { const p = g[i][j] / s; if (i > j) H += p; else if (i === j) D += p; else A += p; if (i + j >= 3) O += p; }
  return { home: H, draw: D, away: A, over25: O };
}
