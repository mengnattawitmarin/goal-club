// Shared data for every device: daily picks (locked at kickoff), pre-match predictions,
// settled results, pick track record, learned calibration, news carried between days, daily brief.
import { kv, kvPipe, kvEnabled, parse, readBody } from "../lib/kv.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,12}$/;

function atomic(line) {
  const t = Math.round(line * 4), s = t / 4;
  return t % 2 === 0 ? [{ line: s, w: 1 }] : [{ line: (t - 1) / 4, w: 0.5 }, { line: (t + 1) / 4, w: 0.5 }];
}
function settle(p, hs, as) {
  let s = 0;
  if (p.type === "1x2") s = (p.side === "h" ? hs > as : as > hs) ? 1 : -1;
  else {
    const base = p.type === "ah" ? (p.side === "h" ? hs - as : as - hs) : (p.side === "o" ? hs + as : -(hs + as));
    const ln = p.type === "ah" ? (p.side === "h" ? p.line : -p.line) : (p.side === "o" ? -p.line : p.line);
    for (const part of atomic(ln)) { const v = base + part.line; s += (v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0) * part.w; }
  }
  return s >= 1 ? "win" : s > 0 ? "half" : s === 0 ? "push" : s > -1 ? "halflose" : "lose";
}
function calib(hist) {
  const out = {};
  const add = (k, h) => { const o = (out[k] = out[k] || { n: 0, hs: 0, as: 0, lh: 0, la: 0 }); o.n++; o.hs += h.hs; o.as += h.as; o.lh += h.lh0; o.la += h.la0; };
  for (const h of hist) { if (h && h.lh0 > 0 && h.la0 > 0) { add(h.lg, h); add("_all", h); } }
  for (const k in out) {
    const o = out[k], w = o.n / (o.n + 40), c = (x) => Math.min(1.1, Math.max(0.9, x));
    o.hAdj = c(1 + (o.hs / o.lh - 1) * w); o.aAdj = c(1 + (o.as / o.la - 1) * w);
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!kvEnabled) { res.status(200).json({ enabled: false }); return; }
  try {
    if (req.method === "GET") {
      const date = String(req.query.date || "");
      if (!DAY.test(date)) { res.status(400).json({ error: "bad date" }); return; }
      const teams = String(req.query.teams || "").split(",").filter((x) => ID.test(x)).slice(0, 200);
      const players = String(req.query.players || "").split(",").filter((x) => ID.test(x)).slice(0, 60);
      const [picks, brief, ph, hist, news, weights, evals, lgavg, np, lessons, rat, pl] = await kvPipe([
        ["GET", `picks:${date}`], ["GET", `brief:${date}`], ["LRANGE", "pickhist", "0", "299"], ["LRANGE", "hist", "0", "1999"], ["HGETALL", "newsteam"],
        ["GET", "weights"], ["HGETALL", "evals"], ["HGETALL", "lgavg"], ["HGETALL", "newsplayer"], ["GET", "lessons"],
        teams.length ? ["HMGET", "ratings", ...teams] : ["GET", "__none"], players.length ? ["HMGET", "players", ...players] : ["GET", "__none"],
      ]);
      const pairs = (arr) => { const o = {}; for (let i = 0; Array.isArray(arr) && i < arr.length; i += 2) o[arr[i]] = parse(arr[i + 1]); return o; };
      const pick = (keys, vals) => { const o = {}; keys.forEach((k, i) => { const v = parse(Array.isArray(vals) ? vals[i] : null); if (v) o[k] = v; }); return o; };
      const ev = pairs(evals); const evalDays = Object.keys(ev).sort().slice(-21);
      const newsTeam = {};
      for (let i = 0; Array.isArray(news) && i < news.length; i += 2) newsTeam[news[i]] = parse(news[i + 1]);
      const histRows = (hist || []).map((x) => parse(x)).filter(Boolean);
      res.status(200).json({
        enabled: true,
        picks: parse(picks, {}),
        brief: parse(brief),
        pickHist: (ph || []).map((x) => parse(x)).filter(Boolean),
        calib: calib(histRows),
        histN: histRows.length,
        newsTeam,
        weights: parse(weights),
        newsPlayer: pairs(np),
        lessons: parse(lessons),
        evals: Object.fromEntries(evalDays.map((d) => [d, ev[d]])),
        lgavg: Object.fromEntries(Object.entries(pairs(lgavg)).map(([k, v]) => [k, v && v.n ? v.g / v.n : null])),
        ratings: pick(teams, rat),
        players: pick(players, pl),
      });
      return;
    }
    if (req.method !== "POST") { res.status(405).json({ error: "GET or POST" }); return; }
    const b = readBody(req), now = Date.now(), date = String(b.date || "");
    if (!DAY.test(date)) { res.status(400).json({ error: "bad date" }); return; }

    /* picks: entries already kicked off stay locked; the rest follow the latest ranking */
    if (Array.isArray(b.picks)) {
      const cur = parse(await kv("GET", `picks:${date}`), {});
      const next = {};
      // already kicked off = locked (a short grace lets a late "not started yet" update through only for new ids)
      for (const [id, p] of Object.entries(cur)) if (Date.parse(p.ko) <= now) next[id] = p;
      for (const p of b.picks.slice(0, 12)) {
        if (!p || !ID.test(String(p.id)) || next[p.id] || !(Date.parse(p.ko) > now - 15 * 60e3)) continue;
        if (!/^(ah|ou|1x2)$/.test(p.type) || !Number.isFinite(+p.prob) || !Number.isFinite(+p.line)) continue;
        next[p.id] = { id: String(p.id), type: p.type, side: String(p.side).slice(0, 1), line: +p.line, prob: +(+p.prob).toFixed(4),
          label: String(p.label || "").slice(0, 60), phrase: String(p.phrase || "").slice(0, 80), score: String(p.score || "").slice(0, 7),
          ko: p.ko, match: String(p.match || "").slice(0, 80) };
      }
      await kv("SET", `picks:${date}`, JSON.stringify(next), "EX", String(40 * 86400));
    }

    /* pre-match predictions, kept until the result arrives */
    const cmds = [];
    for (const p of (Array.isArray(b.preds) ? b.preds : []).slice(0, 80)) {
      if (!p || !ID.test(String(p.id)) || !(Date.parse(p.ko) > now - 15 * 60e3)) continue;
      const num = (x) => (Number.isFinite(+x) && +x > 0 ? +(+x).toFixed(4) : undefined);
      const row = { id: String(p.id), d: date, lg: String(p.lg || "").slice(0, 24), lh0: +p.lh0, la0: +p.la0, ph: +p.ph, pa: +p.pa, ko: p.ko,
        pH: num(p.pH), pA: num(p.pA), bH: num(p.bH), bA: num(p.bA),
        fr: p.fr && typeof p.fr === "object" ? Object.fromEntries(Object.entries(p.fr).filter(([k, v]) => /^[a-zA-Z]{2,12}$/.test(k) && Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(+x) && Math.abs(+x) < 2)).slice(0, 16).map(([k, v]) => [k, [+v[0], +v[1]]])) : undefined, mv: num(p.mv), mkH: num(p.mkH), mkA: num(p.mkA), mh: num(p.mh), md: num(p.md), ma: num(p.ma), hid: String(p.hid || ""), aid: String(p.aid || "") };
      if (!(row.lh0 > 0 && row.la0 > 0)) continue;
      cmds.push(["SET", `pred:${row.id}`, JSON.stringify(row), "EX", String(14 * 86400)]);
    }
    if (cmds.length) await kvPipe(cmds);

    /* full-time scores: settle predictions and picks once */
    const results = (Array.isArray(b.results) ? b.results : []).filter((r) => r && ID.test(String(r.id)) && Number.isInteger(r.hs) && Number.isInteger(r.as) && r.hs >= 0 && r.as >= 0 && r.hs < 20 && r.as < 20).slice(0, 80);
    if (results.length) {
      const picks = parse(await kv("GET", `picks:${date}`), {});
      const got = await kvPipe(results.map((r) => ["GET", `pred:${r.id}`]));
      const done = await kvPipe(results.flatMap((r) => [["SADD", "histdone", String(r.id)], ["SADD", "pickdone", String(r.id)]]));
      const w = [];
      results.forEach((r, i) => {
        const pred = parse(got[i]);
        const newHist = done[i * 2] === 1, newPick = done[i * 2 + 1] === 1;
        if (pred && newHist) { w.push(["LPUSH", "hist", JSON.stringify({ ...pred, hs: r.hs, as: r.as })], ["DEL", `pred:${r.id}`]); }
        else if (!pred && newHist) w.push(["SREM", "histdone", String(r.id)]);
        const p = picks[r.id];
        if (p && newPick && Date.parse(p.ko) < now) {
          w.push(["LPUSH", "pickhist", JSON.stringify({ d: date, id: p.id, label: p.label, type: p.type, prob: p.prob, match: (r.match || p.match || "").slice(0, 80), res: settle(p, r.hs, r.as) })]);
        } else if (newPick) w.push(["SREM", "pickdone", String(r.id)]);
      });
      if (w.length) await kvPipe([...w, ["LTRIM", "hist", "0", "1999"], ["LTRIM", "pickhist", "0", "999"]]);
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false, error: "store unavailable" });
  }
}
