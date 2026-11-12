// เมดูซ่า 4.0 model job (second daily cron, also callable by the owner to speed up the backfill):
//   1. backfill two seasons from ESPN, a chunk per run
//   2. walk-forward backtest of the 4.0 core against the 3.3 base, weekly or when settings are missing
//   3. fit the Dixon-Coles model on everything with the winning settings and store team strengths
// The app uses the 4.0 core only after the backtest passes (backtest.pass) — otherwise it stays on 3.3.
// Auth: Authorization: Bearer <CRON_SECRET>  or  ?secret=<CRON_SECRET>  (required).
import { LEAGUES } from "../lib/leagues.js";
import { kv, kvPipe, kvEnabled, parse } from "../lib/kv.js";
import { backfillStep, loadHistory } from "../lib/backfill.js";
import { fitDC } from "../lib/dc.js";
import { walkForward } from "../lib/backtest.js";

async function getJson(url) { const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; GoalClub/2.0)" } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }

export const CONFIGS = [
  { halfLife: 120, prior: 6, xgW: 0 }, { halfLife: 240, prior: 6, xgW: 0 }, { halfLife: 365, prior: 8, xgW: 0 },
  { halfLife: 240, prior: 12, xgW: 0 }, { halfLife: 240, prior: 6, xgW: 0.3 }, { halfLife: 240, prior: 6, xgW: 0.6 },
];

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
    const pre = parse(await kv("GET", "bf:todo"));
    const filling = !pre || pre.length > 0;
    report.backfill = await backfillStep(getJson, { budgetMs: filling ? 36000 : 20000 });
    if (report.backfill.left > 0) {   // still collecting: skip the heavy part, the last run does it
      report.months = await kvPipe(LEAGUES.map((lg) => ["HLEN", `bf:${lg}`])).then((r) => r.reduce((s, x) => s + (+x || 0), 0)).catch(() => null);
      report.ms = Date.now() - t0; await kv("SET", "modellog", JSON.stringify(report)); res.status(200).json(report); return;
    }
    const hist = await loadHistory(); report.matches = hist.length;
    const bt = parse(await kv("GET", "backtest"));
    const stale = !bt || Date.now() - Date.parse(bt.at) > 6.5 * 864e5 || (bt.matches || 0) * 1.25 < hist.length;
    if (hist.length >= 1500 && stale && Date.now() - t0 < 30000) {
      const hasXg = hist.filter((m) => m.xh != null).length > hist.length * 0.5;
      const r = walkForward(hist, { configs: CONFIGS.filter((c) => hasXg || !c.xgW), budgetMs: 20000 });
      if (r.ok) { await kv("SET", "backtest", JSON.stringify(r)); report.backtest = { gain: r.gain, pass: r.pass, best: r.best, partial: r.partial }; }
    }
    const best = parse(await kv("GET", "backtest"))?.best || CONFIGS[1];
    if (hist.length >= 500 && Date.now() - t0 < 45000) {
      const md = fitDC(hist, { halfLife: best.halfLife, prior: best.prior, xgW: best.xgW || 0 });
      const ids = Object.keys(md.teams);
      const cmds = [["DEL", "dct"], ["SET", "dcl", JSON.stringify({ leagues: md.leagues, asOf: md.asOf, cfg: { halfLife: md.halfLife, prior: md.prior, xgW: md.xgW }, rows: md.rows })]];
      for (let i = 0; i < ids.length; i += 400) cmds.push(["HSET", "dct", ...ids.slice(i, i + 400).flatMap((id) => [id, JSON.stringify([md.teams[id].att, md.teams[id].def, md.teams[id].n, md.teams[id].lg])])]);
      await kvPipe(cmds); report.fit = { teams: ids.length, leagues: Object.keys(md.leagues).length };
    }
    report.ms = Date.now() - t0;
    await kv("SET", "modellog", JSON.stringify(report));
    res.status(200).json(report);
  } catch (e) {
    report.error = String(e?.message || e).slice(0, 200);
    await kv("SET", "modellog", JSON.stringify(report)).catch(() => {});
    res.status(200).json(report);
  }
}
