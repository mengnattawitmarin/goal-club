// Server-side relay for ESPN's public soccer feed, so the app never depends on browser CORS.
// GET /api/espn?path=site/v2/sports/soccer/eng.1/scoreboard&dates=20261028
const ALLOWED = /^(site\/v2|v2)\/sports\/soccer\/[a-z0-9._]+\/(scoreboard|standings|summary|news)$/;
const ALLOWED_CORE = /^v2\/sports\/soccer\/athletes\/\d+$/;
const TTL = { scoreboard: 30, summary: 120, news: 600, standings: 1800 };

export default async function handler(req, res) {
  const { path = "", host = "", ...rest } = req.query;
  const core = host === "core";
  if (core ? !ALLOWED_CORE.test(path) : !ALLOWED.test(path)) {
    res.status(400).json({ error: "path not allowed" });
    return;
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) if (/^(dates|event|limit)$/.test(k)) qs.set(k, String(v));
  const url = core ? `https://sports.core.api.espn.com/${path}` : `https://site.api.espn.com/apis/${path}${qs.size ? "?" + qs : ""}`;
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; GoalClub/2.0)" },
      signal: AbortSignal.timeout(8000),
    });
    const body = await r.text();
    const ttl = core ? 86400 : TTL[path.split("/").pop()] ?? 60;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`);
    res.status(r.status).send(body);
  } catch {
    res.status(502).json({ error: "feed unavailable" });
  }
}
