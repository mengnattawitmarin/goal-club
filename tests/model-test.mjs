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
    case "SET": if (a.includes("NX") && db.has(a[0])) return null; db.set(a[0], a[1]); return "OK";
    case "DEL": return db.delete(a[0]) ? 1 : 0;
    case "HSET": { const o = h(); for (let i = 1; i < a.length; i += 2) o[a[i]] = a[i + 1]; db.set(a[0], o); return 1; }
    case "HGET": return h()[a[1]] ?? null;
    case "HMGET": return a.slice(1).map((k) => h()[k] ?? null);
    case "HGETALL": return Object.entries(h()).flat();
    case "RPUSH": { const l = db.get(a[0]) || []; l.push(...a.slice(1)); db.set(a[0], l); return l.length; }
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
const { walkForward, deadRubber } = await import(join(root, "lib/backtest.js"));
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

{ const T = { teams: {} }; for (let i = 0; i < 20; i++) T.teams["t" + i] = { pts: 80 - i * 3, pl: 32 };
  check("item 17: dead rubber = cannot reach 4th, cannot be caught by the drop zone, 10 or fewer games left", deadRubber(T, "t10") && !deadRubber(T, "t4") && !deadRubber(T, "t16") && !deadRubber({ teams: Object.fromEntries(Object.entries(T.teams).map(([k, v]) => [k, { ...v, pl: 20 }])) }, "t10")); }
{ /* resumable backtest: many short runs = one long run, and blend configs are scored */
  const cfg = [{ halfLife: 180, prior: 6 }, { halfLife: 180, prior: 6, blend: 0.5 }];
  const one = walkForward(M, { configs: cfg, budgetMs: 1e9 });
  let st = null, r, runs = 0; do { r = walkForward(M, { configs: cfg, budgetMs: 1, state: st }); st = r.state; runs++; } while (!r.done && runs < 500);
  check("backtest resumes across runs and ends with the same numbers as one long run", r.done && runs > 3 && r.best.logloss === one.best.logloss && r.base33.n === one.base33.n && !one.partial, `${runs} runs`);
  check("4.2: every league scored at 5 mixes of the two cores; choice, goal level and score rule reported", Object.keys(one.leagueChoice).length >= 3 && Object.values(one.leagueChoice).every((c) => [0, 0.3, 0.5, 0.7, 1].includes(c.w)) && one.goalsCal.all > 0.8 && one.goalsCal.all < 1.2 && one.merged.n > 0 && one.merged.logloss <= one.base33.logloss && ["max", "res", "full"].includes(one.scoreRules.rule), JSON.stringify({ lc: one.leagueChoice["eng.1"], gc: one.goalsCal, sr: one.scoreRules }));
  check("an unfinished backtest never passes the gate", walkForward(M, { configs: cfg, budgetMs: 1 }).pass === false);
  check("ensemble (4.0 x 3.3) is scored as a candidate", one.configs.length === 2 && one.configs[1].blend === 0.5 && one.configs[1].n === one.configs[0].n, `blend ${one.configs[1].logloss} vs dc ${one.configs[0].logloss} vs 3.3 ${one.base33.logloss}`); }
const { parseBoard, backfillPlan } = await import(join(root, "lib/backfill.js"));
const rows = parseBoard({ events: [{ id: "1", date: "2025-03-01T15:00Z", competitions: [{ neutralSite: true, status: { type: { state: "post" } }, competitors: [{ homeAway: "home", score: "2", team: { id: "10" }, statistics: [{ name: "shotsOnTarget", displayValue: "6" }, { name: "totalShots", displayValue: "14" }] }, { homeAway: "away", score: "1", team: { id: "11" } }] }] }, { id: "2", competitions: [{ status: { type: { state: "pre" } } }] }] }, "eng.1");
check("backfill parses finished games with neutral ground and shots", rows.length === 1 && rows[0][4] === 2 && rows[0][6] === 1 && rows[0][7] === 6 && rows[0][9] === 14, JSON.stringify(rows));
const plan = backfillPlan(Date.parse("2026-11-11"));
check("backfill plan covers two seasons for every league in month chunks", plan.length >= 24 * 23 && plan.every((x) => /^[a-z.\d_]+\|\d{8}-\d{8}$/.test(x)), String(plan.length));

const { evalsFromHist, finalCalib, picksAudit, liveAudit, lineMove, coreCheck } = await import(join(root, "lib/audit.js"));
const hist = M.slice(0, 400).map((m, i) => ({ d: m.d, ph: 0.45, pa: 0.3, mh: 0.46, md: 0.26, ma: 0.28, hs: m.hs, as: m.as, lhF: 1.5, laF: 1.2 }));
const ev = evalsFromHist(hist); const evN = Object.values(ev).reduce((s, e) => s + e.n, 0);
check("item 19: daily evaluation counts every settled match (not only the daily job's)", evN === 400 && Object.values(ev).every((e) => e.nK === e.n), String(evN));
const fc = finalCalib(hist); check("final calibration: goal level and 1X2 temperature learned", fc.n === 400 && fc.goals > 0.5 && fc.temp >= 0.8 && fc.temp <= 1.25, JSON.stringify(fc));
const pa = picksAudit([{ res: "win", prob: 0.66, fair: 0.6, kind: "dog" }, { res: "lose", prob: 0.64, fair: 0.62, kind: "dog" }, { res: "win", prob: 0.7, kind: "under" }]);
check("picks judged against the market and split by kind", pa.all.n === 3 && pa.dog.n === 2 && pa.dog.hit === 0.5 && pa.dog.fair === 0.61 && pa.under.fair === null, JSON.stringify(pa));

const lm = lineMove([{ hs: 2, as: 0, oh: 0.45, od: 0.28, oa: 0.27, mh: 0.52, md: 0.26, ma: 0.22, ph: 0.5, pa: 0.25 }, { hs: 0, as: 1, oh: 0.4, od: 0.3, oa: 0.3, mh: 0.4, md: 0.3, ma: 0.3, ph: 0.45, pa: 0.25 }]);
check("item 14: opening vs closing vs model on the same matches", lm.n === 2 && lm.close < lm.open && lm.moved === 1 && lm.toward === 1, JSON.stringify(lm));
{ const cc = coreCheck([{ ph: 0.6, pa: 0.2, ph33: 0.5, pa33: 0.25, hs: 2, as: 0 }, { ph: 0.5, pa: 0.2, hs: 1, as: 1 }]);
  check("4.2: real results compare the new core with the 3.3 path (only rows that carry both)", cc.n === 1 && cc.ll < cc.ll33, JSON.stringify(cc)); }
const la = liveAudit([{ ph: 0.7, pd: 0.2, pa: 0.1, fh: 2, fa: 1, hs: 2, as: 1, o25: 0.8 }, { ph: 0.2, pd: 0.6, pa: 0.2, fh: 1, fa: 1, hs: 1, as: 2, o25: 0.5 }]);
check("item 18: live model scored (log loss, hit, exact score)", la.n === 2 && la.hit === 0.5 && la.exact === 0.5 && la.logloss > 0, JSON.stringify(la));
const realFetch = globalThis.fetch; let refuseRanges = false;
const byMonth = {}; for (const m of M.filter((m) => m.lg !== "uefa.europa")) { const k = `${m.lg}|${m.d.slice(0, 7).replace("-", "")}`; (byMonth[k] = byMonth[k] || []).push(m); }
globalThis.fetch = async (url, opts) => {
  const u = String(url); if (u.startsWith("http://localhost")) return realFetch(url, opts);
  if (/soccer\/[^/]+\/scoreboard$/.test(u)) return /aff\.championship/.test(u) ? new Response("no", { status: 404 }) : new Response("{}", { status: 200 });   // slug check (4.1)
  if (/soccer\/bad\./.test(u)) return new Response("busy", { status: 503 });
  { const m = u.match(/soccer\/esp\.1\/scoreboard\?dates=(\d{8})-(\d{8})/); const p = (x) => Date.parse(`${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6)}`);
    if (m && p(m[2]) - p(m[1]) > 10 * 864e5) return new Response("slow", { status: 504 }); }   // a whole month of esp.1 is "too heavy": must be split
  const ev = (list) => new Response(JSON.stringify({ events: list.map((m) => ({ id: m.id, date: m.d + "T15:00Z", competitions: [{ status: { type: { state: "post" } }, competitors: [{ homeAway: "home", score: String(m.hs), team: { id: m.hid } }, { homeAway: "away", score: String(m.as), team: { id: m.aid } }] }] })) }), { status: 200 });
  if (refuseRanges && /dates=\d{8}-\d{8}/.test(u)) return new Response("bad request", { status: 400 });   // what ESPN did live on 12 Nov 2026
  { const d1 = u.match(/soccer\/([^/]+)\/scoreboard\?dates=(\d{4})(\d\d)(\d\d)$/); if (d1) return ev((byMonth[`${d1[1]}|${d1[2]}${d1[3]}`] || []).filter((m) => m.d === `${d1[2]}-${d1[3]}-${d1[4]}`)); }
  const mm = u.match(/soccer\/([^/]+)\/scoreboard\?dates=(\d{6})\d\d-/);
  if (mm) { const list = byMonth[`${mm[1]}|${mm[2]}`] || []; return new Response(JSON.stringify({ events: list.map((m) => ({ id: m.id, date: m.d + "T15:00Z", competitions: [{ status: { type: { state: "post" } }, competitors: [{ homeAway: "home", score: String(m.hs), team: { id: m.hid } }, { homeAway: "away", score: String(m.as), team: { id: m.aid } }] }] })) }), { status: 200 }); }
  return new Response("{}", { status: 404 });
};
const { backfillPlan: bp } = await import(join(root, "lib/backfill.js"));
/* 14 chunks ESPN always refuses, at the front of the queue: they must not block the rest (bug seen live 12 Nov) */
const broken = Array.from({ length: 14 }, (_, i) => `bad.${i}|20250101-20250131`);
db.set("bf:ver", "2");
db.set("bf:todo", JSON.stringify([...broken, ...bp(Date.parse("2026-05-01"), 650).filter((x) => /^(eng\.1|sco\.1|esp\.1)\|/.test(x))]));
process.env.CRON_SECRET = "s3";
const job = (await import(join(root, "api/model.js"))).default;
const call = async (q, h = {}) => { let out, code = 200; await job({ query: q, headers: h }, { setHeader() {}, status(c) { code = c; return this; }, json(o) { out = { ...o, _code: code }; } }); return out; };
check("model job refuses without the secret", (await call({}))._code === 401);
{ const w = await call({ secret: "wrong" }); check("wrong secret: refused with a Thai hint (length of what was sent only)", w._code === 401 && /ยาว 5 ตัว/.test(w.hint)); }
{ db.set("bf:lock", "1"); const b = await call({ secret: "s3" }); check("one collector at a time: a second device waits instead of racing on the queue", b.busy === true); db.delete("bf:lock"); }
let rep; for (let i = 0; i < 40; i++) { rep = await call({ secret: i ? "s3" : " <s3> \n" }); if (!rep.backfill?.left && !rep.backtest?.partial) break; }
check("backfill fills the history over several runs: heavy months split in halves, chunks ESPN keeps refusing dropped after 3 tries", rep.backfill.left === 0 && rep.matches > 2000 && JSON.parse(db.get("bf:tries") || "{}") && (db.get("bf:skip") || []).length >= 14 && (db.get("bf:skip") || []).every((x) => x.startsWith("bad.")) && Object.keys(db.get("bf:esp.1") || {}).length >= 10 && Object.keys(db.get("bf:esp.1") || {}).every((k) => /^\d{8}-\d{8}$/.test(k)), JSON.stringify(rep.backfill) + " " + rep.matches);
const bt = JSON.parse(db.get("backtest") || "null");
check("model job stores a backtest with a pass/fail gate and measured context (rest, motivation)", bt && typeof bt.pass === "boolean" && bt.best && bt.base33 && bt.context?.shortRest && "deadFor" in bt.context, bt ? `gain ${bt.gain} pass ${bt.pass}` : "none");
check("model job stores team strengths and league levels for the app", Object.keys(db.get("dct") || {}).length >= 60 && JSON.parse(db.get("dcl")).leagues["eng.1"].home > 1);
/* ESPN refuses date ranges (HTTP 400, seen live): the job switches to one request per day, week-sized chunks, and still fills */
{ refuseRanges = true; db.delete("bf:mode"); db.delete("bf:eng.1"); db.delete("bf:tries"); db.delete("bf:skip");
  db.set("bf:todo", JSON.stringify(["eng.1|20250901-20250930", "eng.1|20251001-20251031", "eng.1|20251101-20251130"]));
  let r2; for (let i = 0; i < 12; i++) { r2 = await call({ secret: "s3" }); if (!r2.backfill?.left) break; }
  const want = ["202509", "202510", "202511"].reduce((n, k) => n + (byMonth[`eng.1|${k}`] || []).length, 0);
  const got = Object.values(db.get("bf:eng.1") || {}).reduce((n, v) => n + JSON.parse(v).length, 0);
  check("ESPN refuses ranges (HTTP 400): falls back to one request per day and still stores every match", r2.backfill.left === 0 && db.get("bf:mode") === "day" && got === want && want > 50, `${got}/${want} mode ${db.get("bf:mode")}`); }
/* เมดูซ่า 4.1: national teams — slug check, 4-year backfill into bfn:*, backtest against the competition average, fit */
{ refuseRanges = false;
  const nat = []; for (let i = 0; i < 48; i++) nat.push({ id: `n${i}`, att: Math.exp(gauss() * 0.45), def: Math.exp(gauss() * 0.45) });
  const t0n = Date.now() - 1440 * 864e5, NM = [];
  for (let mo = 0; mo < 47; mo++) for (const [lg, n, home] of [["fifa.friendly", 10, 1.15], ["fifa.worldq.afc", 8, 1.35], ["uefa.nations", 8, 1.25]]) for (let k = 0; k < n; k++) {
    const h = nat[Math.floor(rnd() * 48)], a = nat[Math.floor(rnd() * 48)]; if (h === a) continue;
    const d = new Date(t0n + (mo * 30 + 3 + k * 2) * 864e5).toISOString().slice(0, 10), neutral = lg === "fifa.friendly" && rnd() < 0.3;
    const lh = 1.3 * (neutral ? 1 : home) * h.att * a.def, la = 1.3 * a.att * h.def;
    NM.push({ id: `N${mo}${lg}${k}`, d, lg, hid: h.id, aid: a.id, hs: pois(lh), as: pois(la) });
  }
  for (const m of NM) { const key = `${m.lg}|${m.d.slice(0, 7).replace("-", "")}`; (byMonth[key] = byMonth[key] || []).push(m); }
  for (const k of ["natslugs", "bfn:todo", "bfn:ver", "bfn:mode", "backtestn", "btn:state", "dcnl"]) db.delete(k);
  let rn; for (let i = 0; i < 60; i++) { rn = await call({ secret: "s3" }); const N = rn.nat || {}; if (!N.waiting && !(N.backfill?.left) && !N.backtest?.partial && db.get("dcnl")) break; }
  const sl = JSON.parse(db.get("natslugs") || "{}"), btn = JSON.parse(db.get("backtestn") || "null");
  check("4.1: national slugs checked, ones ESPN lacks are skipped", sl.bad?.includes("aff.championship") && sl.ok?.includes("afc.asian.cup") && !sl.ok.includes("aff.championship"), JSON.stringify(sl.bad));
  check("4.1: national history stored apart from clubs (bfn:*)", Object.keys(db.get("bfn:fifa.friendly") || {}).length >= 30 && !db.get("bf:fifa.friendly"), `${rn.nat?.matches} matches`);
  check("4.1: national backtest against the competition average, full run, gate 0.02", btn && !btn.partial && btn.base === "avg" && btn.minGain === 0.02 && btn.pass === true && btn.gain >= 0.02, btn ? `gain ${btn.gain} n ${btn.best.n}` : "none");
  check("4.1: national strengths stored for the app (dcnt/dcnl)", Object.keys(db.get("dcnt") || {}).length >= 40 && JSON.parse(db.get("dcnl")).cfg.halfLife >= 365); }
kvServer.close();
process.exit(fail ? 1 : 0);
