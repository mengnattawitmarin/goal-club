// เมดูซ่า 4.0: Dixon-Coles core, walk-forward backtest, backfill and the model job. Run: node tests/model-test.mjs
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0; const check = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} model: ${n}${d ? "  " + d : ""}`); if (!c) fail++; };

/* the model job end to end against a fake database and a fake ESPN */
const db = new Map();
function redis([c, ...a]) {
  c = String(c).toUpperCase(); const h = () => db.get(a[0]) || {};
  switch (c) {
    case "GET": return db.has(a[0]) ? db.get(a[0]) : null;
    case "SET": db.set(a[0], a[1]); return "OK";
    case "DEL": return db.delete(a[0]) ? 1 : 0;
    case "HSET": { const o = h(); for (let i = 1; i < a.length; i += 2) o[a[i]] = a[i + 1]; db.set(a[0], o); return 1; }
    case "HGET": return h()[a[1]] ?? null;
    case "HMGET": return a.slice(1).map((k) => h()[k] ?? null);
    case "HGETALL": return Object.entries(h()).flat();
  }
  return null;
}
const kvServer = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { const j = JSON.parse(b); res.setHeader("content-type", "application/json"); res.end(JSON.stringify(req.url.endsWith("/pipeline") ? j.map((c) => ({ result: redis(c) })) : { result: redis(j) })); }); });
await new Promise((r) => kvServer.listen(0, r));
process.env.KV_REST_API_URL = `http://localhost:${kvServer.address().port}`; process.env.KV_REST_API_TOKEN = "t";
/* simulated world: 3 leagues of 20 teams whose strengths drift, a European cup tying them together */
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pois = (l) => { let k = 0, p = Math.exp(-l), s = p; const u = rnd(); while (u > s) { k++; p *= l / k; s += p; } return k; };
const LG = { "eng.1": { lvl: 1.0, home: 1.3, mu: 1.4 }, "sco.1": { lvl: 0.7, home: 1.1, mu: 1.35 }, "esp.1": { lvl: 0.95, home: 1.2, mu: 1.25 } };
const teams = []; for (const [lg, c] of Object.entries(LG)) for (let i = 0; i < 20; i++) teams.push({ id: `${lg}-${i}`, lg, att: Math.exp(gauss() * 0.3) * c.lvl, def: Math.exp(gauss() * 0.3) / c.lvl });
const M = []; const start = Date.parse("2024-08-01");
for (let w = 0; w < 90; w++) {
  const d = new Date(start + w * 7 * 864e5).toISOString().slice(0, 10);
  for (const t of teams) { t.att *= Math.exp(gauss() * 0.02); t.def *= Math.exp(gauss() * 0.02); }
  for (const [lg, c] of Object.entries(LG)) { const ts = teams.filter((t) => t.lg === lg).sort(() => rnd() - 0.5);
    for (let i = 0; i < 20; i += 2) { const h = ts[i], a = ts[i + 1]; const lh = c.mu * c.home * h.att * a.def, la = c.mu * a.att * h.def; M.push({ id: `${w}${lg}${i}`, d, lg, hid: h.id, aid: a.id, hs: pois(lh), as: pois(la), xh: lh * (0.8 + rnd() * 0.4), xa: la * (0.8 + rnd() * 0.4) }); } }
  for (let k = 0; k < 6; k++) { const h = teams[Math.floor(rnd() * 60)], a = teams[Math.floor(rnd() * 60)]; if (h === a || h.lg === a.lg) continue; M.push({ id: `${w}u${k}`, d, lg: "uefa.europa", hid: h.id, aid: a.id, hs: pois(1.3 * 1.15 * h.att * a.def), as: pois(1.3 * a.att * h.def), neutral: k === 0 && w === 89 }); }
}
const { fitDC, lambdas, probs } = await import(join(root, "lib/dc.js"));
const { walkForward } = await import(join(root, "lib/backtest.js"));
const f = fitDC(M, { asOf: "2026-06-01", halfLife: 240, prior: 6 });
check("home advantage learned per league (eng > esp > sco)", f.leagues["eng.1"].home > f.leagues["esp.1"].home && f.leagues["esp.1"].home > f.leagues["sco.1"].home, JSON.stringify(Object.fromEntries(Object.entries(f.leagues).map(([k, v]) => [k, v.home]))));
const corr = (xs, ys) => { const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length; let n = 0, a = 0, b = 0; xs.forEach((x, i) => { n += (x - mx) * (ys[i] - my); a += (x - mx) ** 2; b += (ys[i] - my) ** 2; }); return n / Math.sqrt(a * b); };
const eng = teams.filter((t) => t.lg === "eng.1");
const ca = corr(eng.map((t) => Math.log(t.att)), eng.map((t) => Math.log(f.teams[t.id].att)));
check("team attack strengths recovered (correlation > 0.8)", ca > 0.8, ca.toFixed(2));
const sco = teams.filter((t) => t.lg === "sco.1"), engAvg = eng.reduce((s, t) => s + Math.log(f.teams[t.id].att / f.teams[t.id].def), 0) / 20, scoAvg = sco.reduce((s, t) => s + Math.log(f.teams[t.id].att / f.teams[t.id].def), 0) / 20;
const x = lambdas(f, { lg: "uefa.europa", hid: eng[0].id, aid: sco[0].id }), y = lambdas(f, { lg: "uefa.europa", hid: sco[0].id, aid: eng[0].id });
check("cross-league: European games make the weaker league's teams weaker", engAvg > scoAvg + 0.2, `eng avg ${engAvg.toFixed(2)} sco avg ${scoAvg.toFixed(2)} · ${x.lh.toFixed(2)}-${x.la.toFixed(2)} vs ${y.lh.toFixed(2)}-${y.la.toFixed(2)}`);
const ne = lambdas(f, { lg: "eng.1", hid: eng[0].id, aid: eng[1].id, neutral: true }), ho = lambdas(f, { lg: "eng.1", hid: eng[0].id, aid: eng[1].id });
check("neutral ground removes the home edge", ne.lh < ho.lh && Math.abs(ne.la - ho.la) < 1e-9);
const nw = lambdas(f, { lg: "eng.1", hid: "brand-new", aid: eng[1].id });
check("unknown team falls back to league level, flagged unknown", !nw.known && nw.lh > 0.1);
const p = probs(1.5, 1.1, -0.05); check("probabilities sum to 1", Math.abs(p.home + p.draw + p.away - 1) < 1e-9);
const r = walkForward(M, { configs: [{ halfLife: 120, prior: 6 }, { halfLife: 240, prior: 6 }, { halfLife: 240, prior: 6, xgW: 0.5 }] });
check("walk-forward: 4.0 core beats the 3.3 base replica on simulated seasons", r.ok && r.gain > 0, `3.3 ${r.base33.logloss} → 4.0 ${r.best.logloss} (${r.best.halfLife}/${r.best.prior}/${r.best.xgW || 0}) · ${r.best.n} matches`);
check("walk-forward: never looks ahead (first window starts after the warm-up)", r.windows > 10 && r.base33.n < M.length);
check("walk-forward: shot-based expected goals help when they carry signal", r.configs[2].logloss <= r.configs[1].logloss + 0.002, `${r.configs[1].logloss} vs xG ${r.configs[2].logloss}`);
check("walk-forward: too little data is refused", walkForward(M.slice(0, 50)).ok === false);

const { parseBoard, backfillPlan } = await import(join(root, "lib/backfill.js"));
const rows = parseBoard({ events: [{ id: "1", date: "2025-03-01T15:00Z", competitions: [{ neutralSite: true, status: { type: { state: "post" } }, competitors: [{ homeAway: "home", score: "2", team: { id: "10" }, statistics: [{ name: "shotsOnTarget", displayValue: "6" }, { name: "totalShots", displayValue: "14" }] }, { homeAway: "away", score: "1", team: { id: "11" } }] }] }, { id: "2", competitions: [{ status: { type: { state: "pre" } } }] }] }, "eng.1");
check("backfill parses finished games with neutral ground and shots", rows.length === 1 && rows[0][4] === 2 && rows[0][6] === 1 && rows[0][7] === 6 && rows[0][9] === 14, JSON.stringify(rows));
const plan = backfillPlan(Date.parse("2026-11-11"));
check("backfill plan covers two seasons for every league in month chunks", plan.length >= 24 * 23 && plan.every((x) => /^[a-z.\d_]+\|\d{8}-\d{8}$/.test(x)), String(plan.length));

const { evalsFromHist, finalCalib, picksAudit } = await import(join(root, "lib/audit.js"));
const hist = M.slice(0, 400).map((m, i) => ({ d: m.d, ph: 0.45, pa: 0.3, mh: 0.46, md: 0.26, ma: 0.28, hs: m.hs, as: m.as, lhF: 1.5, laF: 1.2 }));
const ev = evalsFromHist(hist); const evN = Object.values(ev).reduce((s, e) => s + e.n, 0);
check("item 19: daily evaluation counts every settled match (not only the daily job's)", evN === 400 && Object.values(ev).every((e) => e.nK === e.n), String(evN));
const fc = finalCalib(hist); check("final calibration: goal level and 1X2 temperature learned", fc.n === 400 && fc.goals > 0.5 && fc.temp >= 0.8 && fc.temp <= 1.25, JSON.stringify(fc));
const pa = picksAudit([{ res: "win", prob: 0.66, fair: 0.6, kind: "dog" }, { res: "lose", prob: 0.64, fair: 0.62, kind: "dog" }, { res: "win", prob: 0.7, kind: "under" }]);
check("picks judged against the market and split by kind", pa.all.n === 3 && pa.dog.n === 2 && pa.dog.hit === 0.5 && pa.dog.fair === 0.61 && pa.under.fair === null, JSON.stringify(pa));

const realFetch = globalThis.fetch;
const byMonth = {}; for (const m of M.filter((m) => m.lg !== "uefa.europa")) { const k = `${m.lg}|${m.d.slice(0, 7).replace("-", "")}`; (byMonth[k] = byMonth[k] || []).push(m); }
globalThis.fetch = async (url, opts) => {
  const u = String(url); if (u.startsWith("http://localhost")) return realFetch(url, opts);
  const mm = u.match(/soccer\/([^/]+)\/scoreboard\?dates=(\d{6})\d\d-/);
  if (mm) { const list = byMonth[`${mm[1]}|${mm[2]}`] || []; return new Response(JSON.stringify({ events: list.map((m) => ({ id: m.id, date: m.d + "T15:00Z", competitions: [{ status: { type: { state: "post" } }, competitors: [{ homeAway: "home", score: String(m.hs), team: { id: m.hid } }, { homeAway: "away", score: String(m.as), team: { id: m.aid } }] }] })) }), { status: 200 }); }
  return new Response("{}", { status: 404 });
};
const { backfillPlan: bp } = await import(join(root, "lib/backfill.js"));
db.set("bf:todo", JSON.stringify(bp(Date.parse("2026-05-01"), 650).filter((x) => /^(eng\.1|sco\.1|esp\.1)\|/.test(x))));
process.env.CRON_SECRET = "s3";
const job = (await import(join(root, "api/model.js"))).default;
const call = async (q, h = {}) => { let out, code = 200; await job({ query: q, headers: h }, { setHeader() {}, status(c) { code = c; return this; }, json(o) { out = { ...o, _code: code }; } }); return out; };
check("model job refuses without the secret", (await call({}))._code === 401);
let rep; for (let i = 0; i < 6; i++) { rep = await call({ secret: "s3" }); if (!rep.backfill?.left) break; }
check("backfill fills the history over several runs", rep.backfill.left === 0 && rep.matches > 2000, JSON.stringify(rep.backfill) + " " + rep.matches);
const bt = JSON.parse(db.get("backtest") || "null");
check("model job stores a backtest with a pass/fail gate", bt && typeof bt.pass === "boolean" && bt.best && bt.base33, bt ? `gain ${bt.gain} pass ${bt.pass}` : "none");
check("model job stores team strengths and league levels for the app", Object.keys(db.get("dct") || {}).length >= 60 && JSON.parse(db.get("dcl")).leagues["eng.1"].home > 1);
kvServer.close();
process.exit(fail ? 1 : 0);
