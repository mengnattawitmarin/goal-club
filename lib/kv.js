// Tiny Upstash Redis REST client (works with Vercel's Upstash/KV integration env vars).
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
export const kvEnabled = Boolean(URL_ && TOKEN);

export async function kv(...cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(6000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
export async function kvPipe(cmds) {
  if (!cmds.length) return [];
  const r = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json();
  return Array.isArray(j) ? j.map((x) => x.result) : [];
}
export const parse = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
export function readBody(req) {
  return typeof req.body === "string" ? parse(req.body, {}) : req.body || {};
}
