// Protection for the shared store (เมดูซ่า 3.1): per-device rate limits and checking
// match facts against ESPN on the server, so a client cannot write fake scores or picks.
import { kv } from "./kv.js";
import { ALL_LEAGUES as LEAGUES } from "./leagues.js";

export const ipOf = (req) => String(req.headers?.["x-forwarded-for"] || req.headers?.["x-real-ip"] || "anon").split(",")[0].trim().slice(0, 64);

export async function rateLimit(req, name, max, seconds) {
  const k = `rl:${name}:${ipOf(req)}`;
  const n = await kv("INCR", k);
  if (n === 1) await kv("EXPIRE", k, String(seconds));
  return n <= max;
}

/* one match straight from ESPN: state (pre/in/post), score, kickoff, team ids */
export async function espnEvent(lg, id) {
  if (!LEAGUES.includes(lg) || !/^\d{1,12}$/.test(String(id))) return null;
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/summary?event=${id}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json(), c = j.header?.competitions?.[0]; if (!c) return null;
    const H = c.competitors?.find((x) => x.homeAway === "home"), A = c.competitors?.find((x) => x.homeAway === "away");
    return { state: c.status?.type?.state || null, hs: Number(H?.score), as: Number(A?.score), ko: c.date || null, hid: String(H?.team?.id ?? ""), aid: String(A?.team?.id ?? "") };
  } catch { return null; }
}

/* pick sanity: type, side, line and probability inside what the app can produce */
export function validPick(p) {
  if (!p || !/^(ah|ou|1x2)$/.test(p.type)) return false;
  const line = +p.line, prob = +p.prob;
  if (!Number.isFinite(line) || !Number.isFinite(prob) || prob < 0.5 || prob > 0.97) return false;
  if (Math.abs(line * 4 - Math.round(line * 4)) > 1e-9) return false;
  if (p.type === "ou") return /^[ou]$/.test(p.side) && line >= 0.5 && line <= 7;
  if (p.type === "ah") return /^[ha]$/.test(p.side) && Math.abs(line) <= 4;
  return /^[ha]$/.test(p.side) && line === 0;
}
