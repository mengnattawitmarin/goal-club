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
