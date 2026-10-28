// Shared learning maths for the daily job (server side).
export const HOME_ADV = 1.12;   // home goals multiplier used by the rating model
export const K = 0.07;          // learning rate per match

export function pois(k, l) { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; }
export function outcome(hs, as) { return hs > as ? 0 : hs === as ? 1 : 2; }

/* expected goals from attack/defence ratings and the league average goals per team-game */
export function ratingLambdas(home, away, avg) {
  const mu = avg > 0.4 ? avg : 1.35;
  return { lh: mu * HOME_ADV * home.att * away.def, la: mu / HOME_ADV * away.att * home.def };
}
/* one gradient step on the Poisson log-likelihood, kept in a sane band */
export function updateRatings(home, away, hs, as, avg) {
  const { lh, la } = ratingLambdas(home, away, avg);
  const step = (x, g) => Math.min(2.2, Math.max(0.45, x * Math.exp(K * g)));
  const gh = (hs - lh) / Math.max(lh, 0.6), ga = (as - la) / Math.max(la, 0.6);
  return {
    home: { ...home, att: step(home.att, gh), def: step(home.def, ga), n: (home.n || 0) + 1 },
    away: { ...away, att: step(away.att, ga), def: step(away.def, gh), n: (away.n || 0) + 1 },
  };
}
/* 1X2 probabilities from two Poisson means (no Dixon-Coles: fine for scoring) */
export function probs(lh, la) {
  let h = 0, d = 0, a = 0;
  for (let i = 0; i <= 9; i++) for (let j = 0; j <= 9; j++) { const p = pois(i, lh) * pois(j, la); if (i > j) h += p; else if (i === j) d += p; else a += p; }
  const s = h + d + a; return [h / s, d / s, a / s];
}
export const logLoss = (p, o) => -Math.log(Math.max(1e-6, p[o]));
export const brier = (p, o) => p.reduce((s, x, i) => s + (x - (i === o ? 1 : 0)) ** 2, 0);
/* blend in log space like the app does */
export const blend = (a, b, w) => Math.exp(Math.log(a) * (1 - w) + Math.log(b) * w);

/* ---------- self-tuning ---------- */
/* rebuild a stored prediction with other factor strengths S and market weight W */
export function predictRow(r, S, W) {
  let lh = r.bH, la = r.bA;
  for (const [k, v] of Object.entries(r.fr || {})) { const s = S[k] ?? 1; lh *= Math.exp(s * v[0]); la *= Math.exp(s * v[1]); }
  lh = Math.min(4.2, Math.max(0.15, lh)); la = Math.min(4.2, Math.max(0.15, la));
  if (r.mkH > 0 && r.mkA > 0) { lh = blend(lh, r.mkH, W); la = blend(la, r.mkA, W); }
  return probs(lh, la);
}
export function totalLoss(rows, S, W) { let s = 0; for (const r of rows) s += logLoss(predictRow(r, S, W), outcome(r.hs, r.as)); return s / rows.length; }
export const STRENGTHS = [0, 0.5, 1, 1.5];
export const MARKET_W = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
/* coordinate descent: one factor at a time, then the market weight, three passes */
export function tune(rows, start = {}) {
  const keys = {}; for (const r of rows) for (const k of Object.keys(r.fr || {})) keys[k] = (keys[k] || 0) + 1;
  const S = {}; for (const k of Object.keys(keys)) if (keys[k] >= 30) S[k] = start.factors?.[k] ?? 1;
  let W = start.market ?? 0.35, best = totalLoss(rows, S, W);
  for (let pass = 0; pass < 3; pass++) {
    for (const k of Object.keys(S)) for (const v of STRENGTHS) { const t = { ...S, [k]: v }; const l = totalLoss(rows, t, W); if (l < best - 1e-6) { best = l; S[k] = v; } }
    for (const w of MARKET_W) { const l = totalLoss(rows, S, w); if (l < best - 1e-6) { best = l; W = w; } }
  }
  return { factors: S, market: W, loss: best, counts: keys };
}
export const PICK_VALUE = { win: 1, half: 0.75, halflose: 0.25, lose: 0 };
