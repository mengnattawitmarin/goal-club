// Local test server: serves public/, fakes the ESPN feed (one match that you can step through
// pre -> 1st half -> half time -> 2nd half -> full time), fakes Upstash Redis and runs the real api/store.js.
// Usage: node tests/mock-server.mjs   then open http://localhost:8099
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8099);

/* ---- fake Upstash REST ---- */
const db = new Map();
function redis([c, ...a]) {
  c = String(c).toUpperCase();
  if (c === "GET") return db.has(a[0]) ? db.get(a[0]) : null;
  if (c === "SET") { db.set(a[0], a[1]); return "OK"; }
  if (c === "DEL") return db.delete(a[0]) ? 1 : 0;
  if (c === "LPUSH") { const l = db.get(a[0]) || []; l.unshift(...a.slice(1).reverse()); db.set(a[0], l); return l.length; }
  if (c === "LTRIM") { const l = db.get(a[0]) || []; db.set(a[0], l.slice(+a[1], +a[2] + 1)); return "OK"; }
  if (c === "LRANGE") return (db.get(a[0]) || []).slice(+a[1], +a[2] + 1);
  if (c === "SADD") { const s = db.get(a[0]) || new Set(); const had = s.has(a[1]); s.add(a[1]); db.set(a[0], s); return had ? 0 : 1; }
  if (c === "SREM") { const s = db.get(a[0]) || new Set(); return s.delete(a[1]) ? 1 : 0; }
  if (c === "HSET") { const h = db.get(a[0]) || {}; h[a[1]] = a[2]; db.set(a[0], h); return 1; }
  if (c === "HGETALL") return Object.entries(db.get(a[0]) || {}).flat();
  return null;
}
const kvServer = http.createServer((req, res) => {
  let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
    const j = JSON.parse(b); res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url.endsWith("/pipeline") ? j.map((c) => ({ result: redis(c) })) : { result: redis(j) }));
  });
});
await new Promise((r) => kvServer.listen(0, r));
process.env.KV_REST_API_URL = `http://localhost:${kvServer.address().port}`;
process.env.KV_REST_API_TOKEN = "test";
const store = (await import(join(root, "api/store.js"))).default;

/* ---- fake ESPN ---- */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
const iso = (d) => d.toISOString().replace(/:\d\d\.\d+Z$/, "Z");
const STEPS = [["pre", "STATUS_SCHEDULED", 0, 0, ""], ["in", "STATUS_FIRST_HALF", 1, 0, "12'"], ["in", "STATUS_HALFTIME", 1, 0, "HT"], ["in", "STATUS_SECOND_HALF", 2, 0, "63'"], ["post", "STATUS_FULL_TIME", 2, 1, "FT"]];
let step = 0;
const team = (id, name) => ({ id, displayName: name, shortDisplayName: name, logo: `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` });
const ev = (id, h, a, st, ko) => ({ id, date: iso(ko), competitions: [{ status: { displayClock: st[4], type: { name: st[1], state: st[0] } },
  competitors: [{ homeAway: "home", form: "WWDLW", score: String(st[2]), team: team(...h), statistics: st[0] === "pre" ? [] : [{ name: "shotsOnTarget", displayValue: "6" }, { name: "totalShots", displayValue: "13" }, { name: "possessionPct", displayValue: "61.5" }] },
    { homeAway: "away", form: "LDWWL", score: String(st[3]), team: team(...a), statistics: st[0] === "pre" ? [] : [{ name: "shotsOnTarget", displayValue: "1" }, { name: "totalShots", displayValue: "4" }, { name: "possessionPct", displayValue: "38.5" }] }],
  details: step >= 3 && id === "9001" ? [{ type: { text: "Red Card" }, redCard: true, team: { id: a[0] } }] : [],
  odds: [{ provider: { displayName: "DraftKings" }, pointSpread: { home: { close: { line: "-0.5", odds: "-110" } }, away: { close: { line: "+0.5", odds: "-110" } } } }] }] });
function summary() {
  const d = (k) => new Date(Date.now() - k * 864e5).toISOString();
  const five = (id, o) => ({ team: { id }, events: [0, 1, 2, 3, 4].map((i) => ({ gameResult: ["W", "D", "W", "L", "W"][i], homeTeamId: i % 2 ? "999" : id, awayTeamId: i % 2 ? id : "999", homeTeamScore: String(2 + o - (i % 2)), awayTeamScore: String(i % 3), gameDate: d(3 + i * 7 + o * 3) })) });
  return { seasonseries: [{ summary: "ARS leads 2-1-0", events: [1, 2, 3].map((i) => ({ date: `2025-0${i}-01`, statusType: { state: "post" }, competitors: [{ homeAway: "home", team: { id: "359", displayName: "Arsenal" }, score: String(i) }, { homeAway: "away", team: { id: "363", displayName: "Chelsea" }, score: "1" }] })) }],
    lastFiveGames: [five("359", 0), five("363", 1)],
    leaders: [{ team: { id: "359" }, leaders: [{ name: "goalsLeaders", leaders: [{ displayValue: "7", athlete: { id: "101", displayName: "Bukayo Saka" } }, { displayValue: "4", athlete: { id: "102", displayName: "Kai Havertz" } }] }] },
      { team: { id: "363" }, leaders: [{ name: "goalsLeaders", leaders: [{ displayValue: "6", athlete: { id: "201", displayName: "Cole Palmer" } }] }] }],
    rosters: [{ team: { id: "359" }, roster: Array.from({ length: 11 }, (_, i) => ({ starter: true, athlete: { id: String(i === 0 ? "101" : 300 + i) } })) }, { team: { id: "363" }, roster: Array.from({ length: 11 }, (_, i) => ({ starter: true, athlete: { id: String(400 + i) } })) }],
    gameInfo: { venue: { fullName: "Emirates Stadium", address: { city: "London" } } } };
}
function espn(u) {
  const p = u.searchParams.get("path") || "";
  if (u.searchParams.get("host") === "core") return { dateOfBirth: `1995-0${1 + (Number(p.slice(-1)) % 9)}-14T07:00Z` };
  if (p.endsWith("/scoreboard") && p.includes("/eng.1/") && u.searchParams.get("dates") === today)
    return { events: [ev("9001", ["359", "Arsenal"], ["363", "Chelsea"], STEPS[step], new Date(Date.now() - 60e3)), ev("9002", ["367", "Spurs"], ["368", "Everton"], STEPS[0], new Date(Date.now() + 5 * 3600e3))] };
  if (p.endsWith("/scoreboard")) return { events: p.includes("eng.1") && !u.searchParams.get("dates") ? [{}] : [] };
  if (p.endsWith("/standings")) return { children: [] };
  if (p.endsWith("/summary")) return summary();
  return null;
}

/* ---- server ---- */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
  if (u.pathname === "/step") { step = Math.min(step + 1, STEPS.length - 1); return res.end(String(step)); }
  if (u.pathname === "/reset") { step = 0; db.clear(); return res.end("ok"); }
  if (u.pathname === "/api/espn") { const j = espn(u); if (!j) res.statusCode = 404; return json(j || {}); }
  if (u.pathname === "/api/brief") return json({ at: new Date().toISOString(), summary: "สรุปทดสอบ", notes: [{ match: "Arsenal - Chelsea", text: "ทดสอบ" }], players: [], headlines: [{ source: "BBC Sport", title: "Test headline", url: "https://www.bbc.co.uk/sport" }], adjust: [] });
  if (u.pathname === "/api/analysis") {
    if (req.method === "GET") return json({});
    res.setHeader("content-type", "application/x-ndjson");
    const lines = [{ t: "status", d: "กำลังค้น: test query" }, { t: "text", d: "## ทัศนะบอล ทดสอบ\nย่อหน้าแรก\n" }, { t: "text", d: "## ทัศนะ\n- ทายสกอร์: 2-1\n" }, { t: "src", d: [{ url: "https://example.com", title: "แหล่งทดสอบ" }] }, { t: "done" }];
    for (const l of lines) { res.write(JSON.stringify(l) + "\n"); await new Promise((r) => setTimeout(r, 60)); }
    return res.end();
  }
  if (u.pathname === "/api/store") {
    let b = ""; req.on("data", (d) => (b += d)); await new Promise((r) => req.on("end", r));
    const r2 = { status(c) { res.statusCode = c; return r2; }, setHeader: (k, v) => res.setHeader(k, v), json };
    return store({ method: req.method, query: Object.fromEntries(u.searchParams), body: b }, r2);
  }
  try {
    const f = join(root, "public", u.pathname === "/" ? "index.html" : u.pathname);
    const data = await readFile(f); res.setHeader("content-type", TYPES[extname(f)] || "application/octet-stream"); res.end(data);
  } catch { res.statusCode = 404; res.end("not found"); }
}).listen(PORT, () => console.log(`mock server on http://localhost:${PORT}`));
