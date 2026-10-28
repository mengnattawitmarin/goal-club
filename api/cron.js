// Daily learning job (Vercel Cron, see vercel.json). Safe to run more than once a day.
// 1. collects every finished match of the last two feed days from ESPN
// 2. settles stored pre-match predictions and picks
// 3. updates team attack/defence ratings and league goal averages
// 4. records scorers and assisters per player from ESPN match summaries
// 5. scores the model against the market for the day (log loss, Brier, hit rate)
// 6. weekly: re-tunes the market blend weight on everything learned so far
import { kv, kvPipe, kvEnabled, parse } from "../lib/kv.js";
import { updateRatings, probs, logLoss, brier, outcome, blend, tune, totalLoss, predictRow, PICK_VALUE } from "../lib/learn.js";

const LEAGUES = ["tha.1","eng.1","esp.1","ger.1","ita.1","fra.1","uefa.champions","uefa.europa","uefa.europa.conf","eng.2","eng.league_cup","ned.1","por.1","bel.1","sco.1","tur.1","usa.1","mex.1","bra.1","arg.1","ksa.1","jpn.1","chn.1","aus.1"];
const nyDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const shift = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
async function getJson(url) { const r = await fetch(url, { signal: AbortSignal.timeout(7000) }); if (!r.ok) throw new Error(r.status); return r.json(); }
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } } })); return out; }
function atomic(line) { const t = Math.round(line * 4), s = t / 4; return t % 2 === 0 ? [{ line: s, w: 1 }] : [{ line: (t - 1) / 4, w: 0.5 }, { line: (t + 1) / 4, w: 0.5 }]; }
function settle(p, hs, as) {
  let s = 0;
  if (p.type === "1x2") s = (p.side === "h" ? hs > as : as > hs) ? 1 : -1;
  else { const base = p.type === "ah" ? (p.side === "h" ? hs - as : as - hs) : (p.side === "o" ? hs + as : -(hs + as)); const ln = p.type === "ah" ? (p.side === "h" ? p.line : -p.line) : (p.side === "o" ? -p.line : p.line); for (const part of atomic(ln)) { const v = base + part.line; s += (v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0) * part.w; } }
  return s >= 1 ? "win" : s > 0 ? "half" : s === 0 ? "push" : s > -1 ? "halflose" : "lose";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers?.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: "unauthorized" }); return; }
  if (!kvEnabled) { res.status(200).json({ ok: false, error: "no database" }); return; }
  const t0 = Date.now(), today = nyDate(new Date()), days = [shift(today, -2), shift(today, -1)];
  const report = { days, finished: 0, settled: 0, picks: 0, ratingsUpdated: 0, players: 0, evaluated: [] };

  /* 1. finished matches */
  const games = [];
  await pool(LEAGUES.flatMap((lg) => days.map((d) => [lg, d])), 8, async ([lg, d]) => {
    const b = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard?dates=${d.replaceAll("-", "")}`);
    for (const ev of b.events || []) {
      const c = ev.competitions?.[0]; if (c?.status?.type?.state !== "post") continue;
      const H = c.competitors?.find((x) => x.homeAway === "home"), A = c.competitors?.find((x) => x.homeAway === "away");
      const hs = Number(H?.score), as = Number(A?.score); if (!Number.isInteger(hs) || !Number.isInteger(as)) continue;
      games.push({ id: String(ev.id), lg, d, hs, as, hid: String(H.team?.id), aid: String(A.team?.id), hn: H.team?.shortDisplayName || H.team?.displayName, an: A.team?.shortDisplayName || A.team?.displayName });
    }
  });
  report.finished = games.length;
  if (!games.length) { res.status(200).json(report); return; }

  /* skip games already learned */
  const seen = await kvPipe(games.map((g) => ["SISMEMBER", "learned", g.id]));
  const fresh = games.filter((_, i) => seen[i] !== 1);

  /* 2. predictions and picks */
  const preds = await kvPipe(fresh.map((g) => ["GET", `pred:${g.id}`]));
  const picksByDay = {}; for (const d of days) picksByDay[d] = parse(await kv("GET", `picks:${d}`), {});
  const w = [];
  const evalRows = {};
  fresh.forEach((g, i) => {
    const p = parse(preds[i]);
    if (p) {
      w.push(["LPUSH", "hist", JSON.stringify({ ...p, hs: g.hs, as: g.as })], ["DEL", `pred:${g.id}`], ["SADD", "histdone", g.id]);
      report.settled++;
      const o = outcome(g.hs, g.as), e = (evalRows[g.d] = evalRows[g.d] || { n: 0, llM: 0, llK: 0, nK: 0, brM: 0, brK: 0, hitM: 0, hitK: 0 });
      const pm = [p.ph, Math.max(0, 1 - p.ph - p.pa), p.pa]; e.n++; e.llM += logLoss(pm, o); e.brM += brier(pm, o); if (pm.indexOf(Math.max(...pm)) === o) e.hitM++;
      if (p.mh) { const pk = [p.mh, p.md, p.ma]; e.nK++; e.llK += logLoss(pk, o); e.brK += brier(pk, o); if (pk.indexOf(Math.max(...pk)) === o) e.hitK++; }
    }
    for (const d of days) {
      const pk = picksByDay[d][g.id];
      if (pk) { w.push(["SADD", "pickdone", g.id]); w.push(["LPUSH", "pickhist", JSON.stringify({ d, id: g.id, label: pk.label, type: pk.type, prob: pk.prob, match: `${g.hn} ${g.hs}–${g.as} ${g.an}`, res: settle(pk, g.hs, g.as) })]); report.picks++; }
    }
  });
  /* client may already have settled some picks: drop duplicates by checking pickdone first */
  if (w.length) {
    const pickIds = fresh.filter((g) => days.some((d) => picksByDay[d][g.id])).map((g) => g.id);
    const done = pickIds.length ? await kvPipe(pickIds.map((id) => ["SISMEMBER", "pickdone", id])) : [];
    const already = new Set(pickIds.filter((_, i) => done[i] === 1));
    const cmds = w.filter((c) => !(c[0] === "LPUSH" && c[1] === "pickhist" && already.has(JSON.parse(c[2]).id)));
    await kvPipe([...cmds, ["LTRIM", "hist", "0", "4999"], ["LTRIM", "pickhist", "0", "999"]]);
  }

  /* 3. ratings: league average first, then one step per match in kickoff order */
  const lgAvg = {};
  for (const lg of new Set(fresh.map((g) => g.lg))) {
    const cur = parse(await kv("HGET", "lgavg", lg), { g: 0, n: 0 });
    for (const g of fresh.filter((x) => x.lg === lg)) { cur.g += g.hs + g.as; cur.n += 2; }
    if (cur.n > 400) { cur.g *= 400 / cur.n; cur.n = 400; }   // keep it moving with the season
    lgAvg[lg] = cur; await kv("HSET", "lgavg", lg, JSON.stringify(cur));
  }
  const ids = [...new Set(fresh.flatMap((g) => [g.hid, g.aid]))];
  const got = ids.length ? await kvPipe([["HMGET", "ratings", ...ids]]) : [[]];
  const R = {}; ids.forEach((id, i) => { R[id] = parse(got[0]?.[i], { att: 1, def: 1, n: 0 }); });
  for (const g of fresh) {
    const avg = lgAvg[g.lg].n ? lgAvg[g.lg].g / lgAvg[g.lg].n : 1.35;
    const u = updateRatings(R[g.hid], R[g.aid], g.hs, g.as, avg);
    R[g.hid] = { ...u.home, name: g.hn, lg: g.lg, at: g.d }; R[g.aid] = { ...u.away, name: g.an, lg: g.lg, at: g.d };
  }
  if (ids.length) { await kv("HSET", "ratings", ...ids.flatMap((id) => [id, JSON.stringify(R[id])])); report.ratingsUpdated = ids.length; }

  /* 4. scorers and assisters per player (summaries, bounded by time) */
  const plays = {};
  await pool(fresh.filter(() => Date.now() - t0 < 30000), 8, async (g) => {
    const s = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${g.lg}/summary?event=${g.id}`);
    for (const sp of s.scoringPlays || []) {
      const ath = sp.athletesInvolved || []; if (!ath.length || /own goal/i.test(sp.type?.text || sp.text || "")) continue;
      const add = (a, k) => { if (!a?.id) return; const r = (plays[a.id] = plays[a.id] || { name: a.displayName, g: 0, a: 0, team: sp.team?.displayName || "" }); r[k]++; };
      add(ath[0], "g"); if (ath[1]) add(ath[1], "a");
    }
    for (const t of s.rosters || []) for (const r of t.roster || []) if (r.starter || r.subbedIn) { const a = r.athlete; if (!a?.id) continue; const x = (plays[a.id] = plays[a.id] || { name: a.displayName, g: 0, a: 0, team: t.team?.displayName || "" }); x.apps = (x.apps || 0) + 1; }
  });
  const pids = Object.keys(plays);
  if (pids.length) {
    const cur = await kvPipe([["HMGET", "players", ...pids]]);
    const merged = pids.flatMap((id, i) => { const o = parse(cur[0]?.[i], { g: 0, a: 0, apps: 0 }); const n = plays[id]; return [id, JSON.stringify({ name: n.name, team: n.team, g: o.g + n.g, a: o.a + n.a, apps: (o.apps || 0) + (n.apps || 0) })]; });
    await kv("HSET", "players", ...merged); report.players = pids.length;
  }

  /* 5. daily evaluation */
  for (const [d, e] of Object.entries(evalRows)) {
    const old = parse(await kv("HGET", "evals", d), { n: 0, llM: 0, llK: 0, nK: 0, brM: 0, brK: 0, hitM: 0, hitK: 0 });
    const sum = Object.fromEntries(Object.keys(old).map((k) => [k, (old[k] || 0) + (e[k] || 0)]));
    await kv("HSET", "evals", d, JSON.stringify(sum)); report.evaluated.push(d);
  }
  await kvPipe(fresh.map((g) => ["SADD", "learned", g.id]));

  /* 6. self-improvement: re-tune factor strengths and market weights, calibrate picks, write lessons */
  const wt = parse(await kv("GET", "weights"), {});
  const due = !wt.at || Date.now() - Date.parse(wt.at) > 2.5 * 86400e3 || req.query?.tune === "1";
  if (due) {
    const hist = ((await kv("LRANGE", "hist", "0", "4999")) || []).map((x) => parse(x)).filter((h) => h && h.bH > 0 && h.bA > 0 && Number.isInteger(h.hs));
    const next = { ...wt, at: new Date().toISOString() };
    const lessons = [];
    if (hist.length >= 120) {
      const before = totalLoss(hist, wt.factors || {}, wt.market ?? 0.35);
      const t = tune(hist, wt);
      next.factors = t.factors; next.market = t.market; next.n = hist.length; next.loss = +t.loss.toFixed(4);
      lessons.push(`ปรับน้ำหนักจากผลจริง ${hist.length} นัด: log loss ${before.toFixed(3)} → ${t.loss.toFixed(3)}`);
      for (const [k, v] of Object.entries(t.factors)) if (v !== 1) lessons.push(`${k}: ${v === 0 ? "ไม่ช่วยทาย ปิดไว้" : v < 1 ? `ช่วยน้อยกว่าที่ตั้งไว้ ลดเหลือ ×${v}` : `ช่วยมากกว่าที่ตั้งไว้ เพิ่มเป็น ×${v}`}`);
      /* market weight per league where there is enough data */
      next.marketLg = {};
      const byLg = {}; for (const h of hist) (byLg[h.lg] = byLg[h.lg] || []).push(h);
      for (const [lg, rows] of Object.entries(byLg)) {
        const wm = rows.filter((r) => r.mkH > 0); if (wm.length < 80) continue;
        let bw = t.market, bl = totalLoss(wm, t.factors, t.market);
        for (let w = 0.15; w <= 0.71; w += 0.05) { const l = totalLoss(wm, t.factors, w); if (l < bl - 1e-6) { bl = l; bw = +w.toFixed(2); } }
        if (bw !== t.market) { next.marketLg[lg] = bw; lessons.push(`${lg}: ${bw > t.market ? "ราคาตลาดแม่นกว่า เพิ่มน้ำหนักราคา" : "โมเดลแม่นกว่า ลดน้ำหนักราคา"}เป็น ${Math.round(bw * 100)}%`); }
      }
      /* where does the model lose to the market */
      for (const [lg, rows] of Object.entries(byLg)) {
        const wm = rows.filter((r) => r.mh > 0); if (wm.length < 25) continue;
        let lm = 0, lk = 0; for (const r of wm) { const o = outcome(r.hs, r.as); lm += logLoss(predictRow(r, t.factors, next.marketLg[lg] ?? t.market), o); lk += logLoss([r.mh, r.md, r.ma], o); }
        const d = (lm - lk) / wm.length;
        if (Math.abs(d) > 0.01) lessons.push(`${lg}: ${d < 0 ? "โมเดลชนะราคาตลาด" : "โมเดลยังแพ้ราคาตลาด"} (ต่าง ${Math.abs(d).toFixed(3)} log loss จาก ${wm.length} นัด)`);
      }
    } else lessons.push(`สะสมผลที่มีข้อมูลครบแล้ว ${hist.length} นัด ต้องครบ 120 นัดจึงเริ่มปรับน้ำหนักเอง`);
    /* calibrate pick probabilities by type */
    const ph = ((await kv("LRANGE", "pickhist", "0", "999")) || []).map((x) => parse(x)).filter((x) => x && x.res !== "push" && PICK_VALUE[x.res] != null);
    next.pickCal = {};
    for (const type of ["ah", "ou", "1x2"]) {
      const rows = ph.filter((x) => x.type === type); if (rows.length < 20) continue;
      const act = rows.reduce((s, x) => s + PICK_VALUE[x.res], 0) / rows.length, pred = rows.reduce((s, x) => s + x.prob, 0) / rows.length;
      const c = Math.min(1.1, Math.max(0.8, 1 + (act / pred - 1) * rows.length / (rows.length + 50)));
      next.pickCal[type] = +c.toFixed(3);
      lessons.push(`ฟันธง${type === "ah" ? "แฮนดิแคป" : type === "ou" ? "สูงต่ำ" : "ผลชนะ"}: ทายไว้เฉลี่ย ${Math.round(pred * 100)}% ได้จริง ${Math.round(act * 100)}% จาก ${rows.length} คู่ → ${c < 1 ? "ลด" : c > 1 ? "เพิ่ม" : "คง"}ความมั่นใจ ×${c.toFixed(2)}`);
    }
    await kv("SET", "weights", JSON.stringify(next));
    await kv("SET", "lessons", JSON.stringify({ at: next.at, items: lessons.slice(0, 20) }));
    report.weights = next; report.lessons = lessons.length;
  }

  /* 7. player news: who is out or doubtful, from today's headlines (needs ANTHROPIC_API_KEY) */
  if (process.env.ANTHROPIC_API_KEY && Date.now() - t0 < 32000) {
    try { report.newsPlayers = await scanPlayerNews(today); } catch { report.newsPlayers = "failed"; }
  }
  report.ms = Date.now() - t0;
  res.status(200).json(report);
}

async function headlines() {
  const rss = async (url) => { try { const x = await (await fetch(url, { signal: AbortSignal.timeout(5000) })).text(); return [...x.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].slice(0, 15).map((m) => m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim()); } catch { return []; } };
  const espn = async (lg) => { try { const j = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/news?limit=8`); return (j.articles || []).map((a) => `${a.headline} — ${a.description || ""}`); } catch { return []; } };
  return (await Promise.all([rss("https://feeds.bbci.co.uk/sport/football/rss.xml"), rss("https://www.theguardian.com/football/rss"), ...["eng.1", "esp.1", "ita.1", "ger.1", "fra.1"].map(espn)])).flat().slice(0, 70);
}
async function scanPlayerNews(today) {
  const lines = await headlines(); if (!lines.length) return 0;
  const prompt = `จากหัวข่าวฟุตบอลด้านล่าง ดึงเฉพาะนักเตะที่ข่าวระบุชัดว่า บาดเจ็บ/โดนแบน/ไม่ได้ลงนัดถัดไป (out) หรือ ไม่แน่ว่าจะได้ลง (doubtful) หรือ หายเจ็บกลับมา (back)
ห้ามเดา ถ้าข่าวไม่ระบุชัดให้ข้าม ตอบ JSON เท่านั้น: {"players":[{"name":"ชื่อตามข่าว","team":"สโมสร","status":"out|doubtful|back","reason":"สั้น ๆ ภาษาไทย"}]}
หัวข่าว: ${JSON.stringify(lines)}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(22000),
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await r.json(); const text = (j.content || []).map((c) => c.text || "").join("");
  const out = parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1), { players: [] });
  const blob = lines.join(" ").toLowerCase();
  const ok = (out.players || []).filter((p) => p?.name && /^(out|doubtful|back)$/.test(p.status) && String(p.name).toLowerCase().split(/\s+/).some((w) => w.length > 2 && blob.includes(w)));
  const cmds = ok.map((p) => p.status === "back" ? ["HDEL", "newsplayer", String(p.name).toLowerCase()] : ["HSET", "newsplayer", String(p.name).toLowerCase(), JSON.stringify({ name: p.name, team: p.team || "", status: p.status, reason: String(p.reason || "").slice(0, 120), d: today })]);
  /* forget news older than 14 days */
  const all = await kv("HGETALL", "newsplayer") || [];
  for (let i = 0; i < all.length; i += 2) { const v = parse(all[i + 1]); if (v?.d && (Date.parse(today) - Date.parse(v.d)) / 864e5 > 14) cmds.push(["HDEL", "newsplayer", all[i]]); }
  if (cmds.length) await kvPipe(cmds);
  return ok.length;
}
