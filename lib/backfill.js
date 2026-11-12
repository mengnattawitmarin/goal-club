// เมดูซ่า 4.0 (plan item 1): two seasons of finished matches for every league, fetched from ESPN in
// month-sized chunks across several runs (a Vercel function has 60 s), stored compactly per league:
//   HSET bf:<league> <YYYYMMDD-YYYYMMDD> [[id, date, homeId, awayId, hs, as, neutral, sotH, sotA, shotsH, shotsA], ...]
import { kv, kvPipe, parse } from "./kv.js";
import { LEAGUES } from "./leagues.js";

const DAY = 864e5;
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replaceAll("-", "");
export const SHOT_XG = { sot: 0.3, off: 0.04 };   // simple expected goals per shot on / off target (item 12)

export function backfillPlan(today = Date.now(), days = 730) {
  const items = [];
  for (const lg of LEAGUES) {
    for (let t = today - days * DAY; t < today; t += 31 * DAY) {
      const a = new Date(t), from = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1), to = Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0);
      items.push(`${lg}|${ymd(from)}-${ymd(to)}`);
    }
  }
  return [...new Set(items)];
}

const stat = (c, re) => { const x = (c?.statistics || []).find((s) => re.test(String(s.name || s.abbreviation || ""))); const v = parseFloat(String(x?.displayValue ?? x?.value ?? "")); return Number.isFinite(v) ? v : null; };
export function parseBoard(b, lg) {
  const out = [];
  for (const ev of b?.events || []) {
    const c = ev.competitions?.[0]; if (c?.status?.type?.state !== "post") continue;
    const H = c.competitors?.find((x) => x.homeAway === "home"), A = c.competitors?.find((x) => x.homeAway === "away");
    const hs = Number(H?.score?.value ?? H?.score), as = Number(A?.score?.value ?? A?.score);
    if (!H?.team?.id || !A?.team?.id || !Number.isInteger(hs) || !Number.isInteger(as)) continue;
    out.push([String(ev.id), String(ev.date || c.date || "").slice(0, 10), String(H.team.id), String(A.team.id), hs, as, c.neutralSite ? 1 : 0,
      stat(H, /^shotsOnTarget$/i), stat(A, /^shotsOnTarget$/i), stat(H, /^totalShots$/i), stat(A, /^totalShots$/i)]);
  }
  return out;
}

/* one run: take the next chunks off the to-do list until the time budget is spent.
   A chunk that fails goes to the back of the list (so it can never block the rest) and is dropped after 3 tries. */
export async function backfillStep(getJson, { budgetMs = 30000, conc = 6, maxTries = 3 } = {}) {
  const t0 = Date.now();
  let todo = parse(await kv("GET", "bf:todo"));
  if (!todo) { todo = backfillPlan(); await kv("SET", "bf:todo", JSON.stringify(todo)); }
  const tries = parse(await kv("GET", "bf:tries"), {}) || {};
  let done = 0, rows = 0, failed = 0, skipped = 0, split = 0, streak = 0; const errors = [];
  const seen = new Set();
  while (todo.length && Date.now() - t0 < budgetMs) {
    const batch = todo.filter((x) => !seen.has(x)).slice(0, conc); if (!batch.length) break;   // every chunk left already tried this run
    batch.forEach((x) => seen.add(x));
    const got = await Promise.all(batch.map(async (it) => {
      const [lg, range] = it.split("|");
      try { const b = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard?dates=${range}&limit=500`); return { it, lg, range, rows: parseBoard(b, lg) }; }
      catch (e) { return { it, lg, range, failed: true, why: String(e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : e?.message || e).slice(0, 40) }; }
    }));
    const cmds = [], gone = new Set(), back = [];
    for (const g of got) {
      if (g.failed) {
        failed++; gone.add(g.it); if (errors.length < 4) errors.push(`${g.it} ${g.why}`);
        /* a month that times out or is refused is retried as two halves (a big month is a heavy page); only a week-sized piece counts tries */
        const [a, b] = g.range.split("-"), ta = Date.parse(`${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6)}`), tb = Date.parse(`${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6)}`);
        if (tb - ta >= 8 * DAY) { const mid = ta + Math.floor((tb - ta) / DAY / 2) * DAY; back.push(`${g.lg}|${ymd(ta)}-${ymd(mid)}`, `${g.lg}|${ymd(mid + DAY)}-${ymd(tb)}`); split++; continue; }
        tries[g.it] = (tries[g.it] || 0) + 1;
        if (tries[g.it] >= maxTries) { skipped++; cmds.push(["RPUSH", "bf:skip", g.it]); } else back.push(g.it);
        continue;
      }
      if (g.rows.length) cmds.push(["HSET", `bf:${g.lg}`, g.range, JSON.stringify(g.rows)]);
      rows += g.rows.length; done++; gone.add(g.it); delete tries[g.it];
    }
    todo = [...todo.filter((x) => !gone.has(x)), ...back];
    streak = got.every((g) => g.failed) ? streak + 1 : 0;
    cmds.push(["SET", "bf:todo", JSON.stringify(todo)], ["SET", "bf:tries", JSON.stringify(tries)]);
    await kvPipe(cmds);
    if (streak >= 3) break;   // ESPN unhappy right now: stop for this run
  }
  return { done, rows, failed, skipped, split, left: todo.length, errors };
}

/* add the daily job's finished games so the history keeps growing after the backfill */
export async function backfillAdd(games) {
  const by = {};
  for (const g of games) { const k = `${g.lg}|${g.d.replaceAll("-", "").slice(0, 6)}`; (by[k] = by[k] || []).push([g.id, g.d, g.hid, g.aid, g.hs, g.as, g.neutral ? 1 : 0, g.sotH ?? null, g.sotA ?? null, g.shH ?? null, g.shA ?? null]); }
  for (const [k, list] of Object.entries(by)) {
    const [lg, mo] = k.split("|"); const cur = parse(await kv("HGET", `bf:${lg}`), []);
    const ids = new Set(cur.map((r) => r[0])); for (const r of list) if (!ids.has(r[0])) cur.push(r);
    await kv("HSET", `bf:${lg}`, mo, JSON.stringify(cur));
  }
}

/* everything stored, as match objects for the model and the backtest */
export async function loadHistory() {
  const lists = await kvPipe(LEAGUES.map((lg) => ["HGETALL", `bf:${lg}`]));
  const out = [], seen = new Set();
  LEAGUES.forEach((lg, i) => {
    const arr = lists[i] || [];
    for (let k = 1; k < arr.length; k += 2) for (const r of parse(arr[k], [])) {
      if (seen.has(r[0])) continue; seen.add(r[0]);
      const [id, d, hid, aid, hs, as, neutral, sotH, sotA, shH, shA] = r;
      const xg = (sot, sh) => (Number.isFinite(sot) && Number.isFinite(sh) && sh >= sot ? SHOT_XG.sot * sot + SHOT_XG.off * (sh - sot) : null);
      out.push({ id, d, lg, hid, aid, hs, as, neutral: !!neutral, xh: xg(sotH, shH), xa: xg(sotA, shA) });
    }
  });
  return out;
}
