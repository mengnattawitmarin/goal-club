// เมดูซ่า: error audit on simulated seasons. Run: node tests/audit-test.mjs
import { audit } from "../lib/audit.js";
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pois = (l) => { let k = 0, p = Math.exp(-l), s = p; const u = rnd(); while (u > s) { k++; p *= l / k; s += p; } return k; };
const f = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
const rows = [];
for (let i = 0; i < 1500; i++) {
  const th = 0.7 + rnd() * 1.6, ta = 0.5 + rnd() * 1.4, lh = th * (0.85 + rnd() * 0.3), la = ta * (0.85 + rnd() * 0.3);
  let ph = 0, pa = 0; for (let h = 0; h < 9; h++) for (let a = 0; a < 9; a++) { const p = Math.exp(-lh) * lh ** h / f[h] * Math.exp(-la) * la ** a / f[a]; if (h > a) ph += p; else if (a > h) pa += p; }
  rows.push({ lg: i % 2 ? "eng.1" : "esp.1", lh0: lh, la0: la, ph, pa, mh: 0.4, md: 0.3, ma: 0.3, hs: pois(th), as: pois(ta) });
}
const A = audit(rows); let fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); if (!c) fail++; };
const share = (list, k) => (list.find((x) => x[0] === k) || [0, 0])[1];
ok("audit counts rows", A.n === 1500);
ok("goals and draws close to truth on unbiased data", Math.abs(A.goals.pred - A.goals.actual) < 0.15 && Math.abs(A.draw.pred - A.draw.actual) < 0.03, JSON.stringify(A.draw));
ok("old modal scores pile on 1-1, far above how often 1-1 really happens", share(A.scores.modal, "1-1") > 2 * share(A.scores.actual, "1-1"), `${share(A.scores.modal, "1-1")} vs ${share(A.scores.actual, "1-1")}`);
ok("coherent scores spread out (no single score above 40%)", A.scores.coherent[0][1] < 0.4, JSON.stringify(A.scores.coherent.slice(0, 3)));
ok("exact-score hit rate costs at most 2 points", A.exact.modal - A.exact.coherent < 0.02, JSON.stringify(A.exact));
ok("leagues listed", A.leagues.length === 2);
ok("too few rows returns only n", JSON.stringify(audit(rows.slice(0, 5))) === '{"n":5}');
process.exit(fail ? 1 : 0);
