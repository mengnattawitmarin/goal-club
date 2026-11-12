// เมดูซ่า 4.0 model job (second daily cron, also callable by the owner to speed up the backfill):
//   1. backfill two seasons from ESPN, a chunk per run
//   2. walk-forward backtest of the 4.0 core against the 3.3 base, weekly or when settings are missing
//   3. fit the Dixon-Coles model on everything with the winning settings and store team strengths
// The app uses the 4.0 core only after the backtest passes (backtest.pass) — otherwise it stays on 3.3.
// Auth: Authorization: Bearer <CRON_SECRET>  or  ?secret=<CRON_SECRET>  (required).
import { LEAGUES, NATIONAL } from "../lib/leagues.js";
import { kv, kvPipe, kvEnabled, parse } from "../lib/kv.js";
import { backfillStep, loadHistory } from "../lib/backfill.js";
import { fitDC } from "../lib/dc.js";
import { walkForward } from "../lib/backtest.js";

async function getJson(url) { const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; GoalClub/2.0)" } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }

export const CONFIGS = [
  { halfLife: 120, prior: 6, xgW: 0 }, { halfLife: 240, prior: 6, xgW: 0 }, { halfLife: 365, prior: 8, xgW: 0 },
  { halfLife: 240, prior: 12, xgW: 0 }, { halfLife: 240, prior: 6, xgW: 0.3 }, { halfLife: 240, prior: 6, xgW: 0.6 },
  /* ensembles of the 4.0 core with the 3.3 base (same fit as {240, 6}, no extra cost) */
  { halfLife: 240, prior: 6, xgW: 0, blend: 0.5 }, { halfLife: 240, prior: 6, xgW: 0, blend: 0.7 },
];

/* เมดูซ่า 4.1 national teams: years matter more than weeks, friendlies may count less */
export const NAT_CONFIGS = [
  { halfLife: 365, prior: 6, xgW: 0 }, { halfLife: 540, prior: 6, xgW: 0 }, { halfLife: 730, prior: 8, xgW: 0 },
  { halfLife: 540, prior: 6, xgW: 0, lgW: { "fifa.friendly": 0.6 } }, { halfLife: 540, prior: 6, xgW: 0, lgW: { "fifa.friendly": 0.35 } },
];

/* which national competitions ESPN carries (a scoreboard without a date answers for the current/next round) */
async function checkNatSlugs(report) {
  const cur = parse(await kv("GET", "natslugs"));
  if (cur && Date.now() - Date.parse(cur.at) < 7 * 864e5) return cur;
  const ok = [], bad = [];
  await Promise.all(NATIONAL.map(async (lg) => {
    try { await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard`); ok.push(lg); }
    catch (e) { (/HTTP 4\d\d/.test(String(e?.message)) ? bad : ok).push(lg); }   // a timeout is not proof it is missing
  }));
  const out = { at: new Date().toISOString(), ok: NATIONAL.filter((x) => ok.includes(x)), bad: NATIONAL.filter((x) => bad.includes(x)) };
  await kv("SET", "natslugs", JSON.stringify(out)); report.natslugs = out; return out;
}

/* the national pipeline, run once the club one has nothing left this call: backfill -> backtest -> fit */
async function natStep(t0, report) {
  const out = (report.nat = {});
  if (Date.now() - t0 > 40000) { out.waiting = true; return; }
  const slugs = await checkNatSlugs(report);
  out.backfill = await backfillStep(getJson, { set: "nat", leagues: slugs.ok, budgetMs: Math.max(5000, 38000 - (Date.now() - t0)) });
  if (out.backfill.left > 0) return;
  const hist = await loadHistory("nat"); out.matches = hist.length;
  const [btRaw, stRaw, dclRaw] = await kvPipe([["GET", "backtestn"], ["GET", "btn:state"], ["GET", "dcnl"]]);
  const bt = parse(btRaw), st = parse(stRaw);
  const stale = !bt || bt.partial || Date.now() - Date.parse(bt.at) > 6.5 * 864e5 || (bt.matches || 0) * 1.15 < hist.length;
  if (hist.length >= 600 && (st || stale) && Date.now() - t0 < 42000) {
    const r = walkForward(hist, { configs: NAT_CONFIGS, base: "avg", minGain: 0.02, stepDays: 30, warmDays: 365, budgetMs: Math.max(6000, 46000 - (Date.now() - t0)), state: st });
    if (r.ok) {
      const { state, ...pub } = r;
      if (r.done) await kvPipe([["SET", "backtestn", JSON.stringify(pub)], ["DEL", "btn:state"]]);
      else { await kv("SET", "btn:state", JSON.stringify(state)); if (!bt || bt.partial) await kv("SET", "backtestn", JSON.stringify(pub)); }
      out.backtest = { gain: r.gain, pass: r.pass, best: r.best, partial: !r.done, progress: r.progress };
      if (!r.done) return;
    } else out.backtest = { reason: r.reason };
  }
  const best = parse(await kv("GET", "backtestn"))?.best || NAT_CONFIGS[1], dcl = parse(dclRaw);
  const due = !dcl || dcl.asOf !== new Date().toISOString().slice(0, 10) || JSON.stringify(dcl.cfg) !== JSON.stringify(best);
  if (hist.length >= 300 && due && Date.now() - t0 < 50000) {
    const md = fitDC(hist, { halfLife: best.halfLife, prior: best.prior, xgW: 0, lgW: best.lgW });
    const ids = Object.keys(md.teams);
    const cmds = [["DEL", "dcnt"], ["SET", "dcnl", JSON.stringify({ leagues: md.leagues, asOf: md.asOf, cfg: best, rows: md.rows })]];
    for (let i = 0; i < ids.length; i += 400) cmds.push(["HSET", "dcnt", ...ids.slice(i, i + 400).flatMap((id) => [id, JSON.stringify([md.teams[id].att, md.teams[id].def, md.teams[id].n, md.teams[id].lg])])]);
    await kvPipe(cmds); out.fit = { teams: ids.length };
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  /* forgiving about what a phone copy-paste adds: spaces, line breaks, quotes, the <> of the example */
  const clean = (x) => String(x ?? "").trim().replace(/^["'<]+|["'>]+$/g, "").trim();
  const secret = clean(process.env.CRON_SECRET), q = clean(req.query?.secret);
  const given = !!secret && (clean(String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "")) === secret || q === secret);
  if (!secret) { res.status(403).json({ error: "ตั้ง CRON_SECRET ใน Vercel ก่อน" }); return; }
  if (!given) { res.status(401).json({ error: "unauthorized", hint: q ? `รหัสที่ส่งมายาว ${q.length} ตัว แต่ไม่ตรงกับ CRON_SECRET ของ deploy นี้ (ถ้าเพิ่งแก้ใน Vercel ต้อง Redeploy ก่อน)` : "ยังไม่ได้ใส่รหัสต่อท้าย ?secret=" }); return; }
  if (!kvEnabled) { res.status(200).json({ error: "no database" }); return; }
  const t0 = Date.now(), report = { at: new Date().toISOString() };
  try {
    /* one collector at a time: a second device (or the daily cron) would fetch the same chunks and race on the queue */
    const got = await kv("SET", "bf:lock", String(t0), "NX", "EX", "75");
    if (got !== "OK") { res.status(200).json({ ok: true, busy: true, note: "อีกเครื่องกำลังเก็บผลย้อนหลังอยู่" }); return; }
    const pre = parse(await kv("GET", "bf:todo"));
    const filling = !pre || pre.length > 0;
    report.backfill = await backfillStep(getJson, { budgetMs: filling ? 36000 : 20000 });
    if (report.backfill.left > 0) {   // still collecting: skip the heavy part, the last run does it
      report.months = await kvPipe(LEAGUES.map((lg) => ["HLEN", `bf:${lg}`])).then((r) => r.reduce((s, x) => s + (+x || 0), 0)).catch(() => null);
      report.ms = Date.now() - t0; await kvPipe([["SET", "modellog", JSON.stringify(report)], ["DEL", "bf:lock"]]); res.status(200).json(report); return;
    }
    const hist = await loadHistory(); report.matches = hist.length;
    const [btRaw, stRaw] = await kvPipe([["GET", "backtest"], ["GET", "bt:state"]]);
    const bt = parse(btRaw), st = parse(stRaw);
    const stale = !bt || bt.partial || Date.now() - Date.parse(bt.at) > 6.5 * 864e5 || (bt.matches || 0) * 1.25 < hist.length;
    if (hist.length >= 1500 && (st || stale) && Date.now() - t0 < 30000) {
      /* resumable: each run tests the next windows and saves where it stopped; the gate is decided only on a full run */
      const hasXg = hist.filter((m) => m.xh != null).length > hist.length * 0.5;
      const r = walkForward(hist, { configs: CONFIGS.filter((c) => hasXg || !c.xgW), budgetMs: Math.max(8000, 44000 - (Date.now() - t0)), state: st });
      if (r.ok) {
        const { state, ...pub } = r;
        if (r.done) await kvPipe([["SET", "backtest", JSON.stringify(pub)], ["DEL", "bt:state"]]);
        else { await kv("SET", "bt:state", JSON.stringify(state)); if (!bt || bt.partial) await kv("SET", "backtest", JSON.stringify(pub)); }
        report.backtest = { gain: r.gain, pass: r.pass, best: r.best, partial: !r.done, progress: r.progress };
        if (!r.done) { report.ms = Date.now() - t0; await kvPipe([["SET", "modellog", JSON.stringify(report)], ["DEL", "bf:lock"]]); res.status(200).json(report); return; }
      }
    }
    const best = parse(await kv("GET", "backtest"))?.best || CONFIGS[1], dclNow = parse(await kv("GET", "dcl"));
    const fitDue = !dclNow || dclNow.asOf !== new Date().toISOString().slice(0, 10) || dclNow.cfg?.halfLife !== best.halfLife || dclNow.cfg?.prior !== best.prior || (dclNow.cfg?.blend ?? null) !== (best.blend ?? null);
    if (hist.length >= 500 && fitDue && Date.now() - t0 < 45000) {
      const md = fitDC(hist, { halfLife: best.halfLife, prior: best.prior, xgW: best.xgW || 0 });
      const ids = Object.keys(md.teams);
      const cmds = [["DEL", "dct"], ["SET", "dcl", JSON.stringify({ leagues: md.leagues, asOf: md.asOf, cfg: { halfLife: md.halfLife, prior: md.prior, xgW: md.xgW, blend: best.blend ?? null }, rows: md.rows })]];
      for (let i = 0; i < ids.length; i += 400) cmds.push(["HSET", "dct", ...ids.slice(i, i + 400).flatMap((id) => [id, JSON.stringify([md.teams[id].att, md.teams[id].def, md.teams[id].n, md.teams[id].lg])])]);
      await kvPipe(cmds); report.fit = { teams: ids.length, leagues: Object.keys(md.leagues).length };
    }
    await natStep(t0, report);
    report.ms = Date.now() - t0;
    await kvPipe([["SET", "modellog", JSON.stringify(report)], ["DEL", "bf:lock"]]);
    res.status(200).json(report);
  } catch (e) {
    report.error = String(e?.message || e).slice(0, 200);
    await kvPipe([["SET", "modellog", JSON.stringify(report)], ["DEL", "bf:lock"]]).catch(() => {});
    res.status(200).json(report);
  }
}
