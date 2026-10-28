// Tests api/cron.js (daily learning job) against a fake Redis and a fake ESPN feed.
import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const db = new Map();
function redis([c, ...a]) {
  c = String(c).toUpperCase();
  const h = () => db.get(a[0]) || {}; const set = () => db.get(a[0]) || new Set(); const list = () => db.get(a[0]) || [];
  switch (c) {
    case "GET": return db.has(a[0]) ? db.get(a[0]) : null;
    case "SET": db.set(a[0], a[1]); return "OK";
    case "DEL": return db.delete(a[0]) ? 1 : 0;
    case "LPUSH": { const l = list(); l.unshift(...a.slice(1).reverse()); db.set(a[0], l); return l.length; }
    case "LTRIM": db.set(a[0], list().slice(+a[1], +a[2] + 1)); return "OK";
    case "LRANGE": return list().slice(+a[1], +a[2] + 1);
    case "SADD": { const s = set(); const had = s.has(a[1]); s.add(a[1]); db.set(a[0], s); return had ? 0 : 1; }
    case "SISMEMBER": return set().has(a[1]) ? 1 : 0;
    case "SREM": return set().delete(a[1]) ? 1 : 0;
    case "HSET": { const o = h(); for (let i = 1; i < a.length; i += 2) o[a[i]] = a[i + 1]; db.set(a[0], o); return 1; }
    case "HGET": return h()[a[1]] ?? null;
    case "HDEL": { const o = h(); const had = a[1] in o; delete o[a[1]]; return had ? 1 : 0; }
    case "HMGET": return a.slice(1).map((k) => h()[k] ?? null);
    case "HGETALL": return Object.entries(h()).flat();
  }
  return null;
}
const kvServer = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { const j = JSON.parse(b); res.setHeader("content-type", "application/json"); res.end(JSON.stringify(req.url.endsWith("/pipeline") ? j.map((c) => ({ result: redis(c) })) : { result: redis(j) })); }); });
await new Promise((r) => kvServer.listen(0, r));
process.env.KV_REST_API_URL = `http://localhost:${kvServer.address().port}`; process.env.KV_REST_API_TOKEN = "t";

const nyDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const shift = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const yday = shift(nyDate(new Date()), -1);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("http://localhost")) return realFetch(url, opts);
  const json = (o) => new Response(JSON.stringify(o), { status: 200 });
  if (u.includes("/eng.1/scoreboard") && u.includes(yday.replaceAll("-", ""))) return json({ events: [
    { id: "7001", competitions: [{ status: { type: { state: "post" } }, competitors: [{ homeAway: "home", score: "3", team: { id: "1", shortDisplayName: "Alpha" } }, { homeAway: "away", score: "1", team: { id: "2", shortDisplayName: "Beta" } }] }] },
    { id: "7002", competitions: [{ status: { type: { state: "post" } }, competitors: [{ homeAway: "home", score: "0", team: { id: "3", shortDisplayName: "Gamma" } }, { homeAway: "away", score: "0", team: { id: "4", shortDisplayName: "Delta" } }] }] }] });
  if (u.includes("/scoreboard")) return json({ events: [] });
  if (u.includes("/summary?event=7001")) return json({ scoringPlays: [{ team: { displayName: "Alpha" }, athletesInvolved: [{ id: "11", displayName: "Striker A" }, { id: "12", displayName: "Mid A" }] }, { team: { displayName: "Alpha" }, athletesInvolved: [{ id: "11", displayName: "Striker A" }] }],
    rosters: [{ team: { displayName: "Alpha" }, roster: [{ starter: true, athlete: { id: "11", displayName: "Striker A" } }, { starter: true, athlete: { id: "12", displayName: "Mid A" } }] }] });
  if (u.includes("/summary")) return json({});
  if (u.includes("bbci.co.uk")) return new Response("<rss><item><title>Striker A ruled out with hamstring injury</title></item></rss>", { status: 200 });
  if (u.includes("theguardian.com")) return new Response("<rss></rss>", { status: 200 });
  if (u.includes("/news")) return json({ articles: [] });
  if (u.includes("api.anthropic.com")) return json({ content: [{ type: "text", text: JSON.stringify({ players: [{ name: "Striker A", team: "Alpha", status: "out", reason: "เจ็บต้นขา" }, { name: "Made Up Name", team: "X", status: "out", reason: "x" }] }) }] });
  return new Response("{}", { status: 404 });
};

const { kv } = await import(join(root, "lib/kv.js"));
const cron = (await import(join(root, "api/cron.js"))).default;
const run = async () => { let out; const res = { setHeader() {}, status() { return this; }, json(o) { out = o; } }; await cron({ headers: {} }, res); return out; };

await kv("SET", "pred:7001", JSON.stringify({ id: "7001", d: yday, lg: "eng.1", lh0: 1.6, la0: 1.0, ph: 0.5, pa: 0.25, pH: 1.6, pA: 1.0, mkH: 1.7, mkA: 0.9, mh: 0.52, md: 0.25, ma: 0.23 }));
await kv("SET", `picks:${yday}`, JSON.stringify({ 7001: { id: "7001", type: "ah", side: "h", line: -0.5, prob: 0.6, label: "Alpha -0.5", ko: new Date(Date.now() - 864e5).toISOString() } }));

let failed = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} cron: ${n}${x ? "  " + x : ""}`); if (!ok) failed++; };
const r1 = await run();
check("collects finished matches", r1.finished === 2, JSON.stringify(r1));
check("settles stored prediction", r1.settled === 1);
check("settles pick", r1.picks === 1 && JSON.parse((await kv("LRANGE", "pickhist", "0", "0"))[0]).res === "win");
const ratings = await kv("HMGET", "ratings", "1", "2");
const a = JSON.parse(ratings[0]), b = JSON.parse(ratings[1]);
check("winner's attack goes up, loser's defence weakens", a.att > 1 && b.def > 1, `Alpha att ${a.att.toFixed(3)} Beta def ${b.def.toFixed(3)}`);
const pl = JSON.parse((await kv("HMGET", "players", "11"))[0]);
check("player goals and apps recorded", pl.g === 2 && pl.apps === 1, JSON.stringify(pl));
const ev = JSON.parse(await kv("HGET", "evals", yday));
check("daily evaluation model vs market", ev.n === 1 && ev.nK === 1 && ev.llM > 0, JSON.stringify(ev));
const r2 = await run();
check("second run does not double count", r2.settled === 0 && r2.picks === 0 && JSON.parse(await kv("HGET", "evals", yday)).n === 1);
// self-tuning: a helpful factor and a noise factor; market more accurate than stats
const rows = [];
for (let i = 0; i < 200; i++) {
  const homeStrong = i % 3 !== 0;
  const right = i % 5 !== 0;                                          // right 80% of the time, small effect
  const good = (homeStrong === right) ? [0.12, -0.1] : [-0.1, 0.12];
  const noise = i % 2 ? [0.3, -0.3] : [-0.3, 0.3];                   // random direction
  rows.push(JSON.stringify({ lg: "eng.1", bH: 1.3, bA: 1.3, fr: { good, noise }, pH: 1.3, pA: 1.3, mkH: homeStrong ? 2.6 : 0.7, mkA: homeStrong ? 0.6 : 1.7, mh: homeStrong ? 0.6 : 0.3, md: 0.25, ma: homeStrong ? 0.15 : 0.45, hs: homeStrong ? 2 : 0, as: homeStrong ? 0 : 1, lh0: 1.3, la0: 1.3 }));
}
await kv("LPUSH", "hist", ...rows); await kv("SET", "weights", JSON.stringify({ at: "2000-01-01T00:00:00Z" }));
for (let i = 0; i < 25; i++) await kv("LPUSH", "pickhist", JSON.stringify({ type: "ou", prob: 0.65, res: i % 2 ? "win" : "lose" }));
process.env.ANTHROPIC_API_KEY = "test";
const r3 = await run();
const wt = JSON.parse(await kv("GET", "weights"));
check("keeps or boosts the helpful factor", (wt.factors?.good ?? 0) >= 1, JSON.stringify(wt.factors));
check("switches off or weakens the noise factor", (wt.factors?.noise ?? 1) < 1);
check("raises market weight when the market is better", wt.market > 0.35, `market ${wt.market}`);
check("calibrates over-confident picks down", wt.pickCal?.ou < 1, JSON.stringify(wt.pickCal));
const lessons = JSON.parse(await kv("GET", "lessons"));
check("writes lessons for the bot", lessons.items.length >= 3, lessons.items[0]);
const np = await kv("HGETALL", "newsplayer");
check("player news: keeps names found in headlines, drops invented ones", np.includes("striker a") && !np.includes("made up name"), JSON.stringify(r3.newsPlayers));
kvServer.close(); process.exit(failed ? 1 : 0);
