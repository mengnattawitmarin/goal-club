// Tiny Upstash Redis REST client (works with Vercel's Upstash/KV integration env vars).
// Accept any prefix the Vercel integration was given (KV_, STORAGE_, UPSTASH_REDIS_, ...).
function findEnv(suffixes) {
  for (const s of suffixes) if (process.env[s]) return process.env[s];
  for (const [k, v] of Object.entries(process.env)) if (v && suffixes.some((s) => k.endsWith("_" + s) || k === s)) return v;
  return "";
}
const URL_ = findEnv(["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL", "REST_API_URL", "REDIS_REST_URL"]);
const TOKEN = findEnv(["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN", "REST_API_TOKEN", "REDIS_REST_TOKEN"]);
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

// Anthropic key as pasted in Vercel, minus stray spaces, line breaks or quotes
export function anthropicKey() {
  return String(process.env.ANTHROPIC_API_KEY || "").replace(/[\s"'`]/g, "");
}
