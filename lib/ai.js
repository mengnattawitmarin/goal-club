// One place that decides which AI to call (เมดูซ่า 3.2). The provider follows the keys in Vercel:
//   GEMINI_API_KEY (any format, e.g. "AIza…" or the newer "AQ.…") -> Google Gemini   model: GEMINI_MODEL, else picked automatically
//   key starting with "xai-"                    -> Grok (xAI)      model: GROK_MODEL (default grok-4.5)
//   key starting with "sk-ant-"                 -> Claude          model: ANTHROPIC_MODEL (default claude-sonnet-5-5)
//   CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN -> Cloudflare Workers AI (backup)  model: CF_AI_MODEL
// Order: AI_PROVIDER (gemini|grok|claude|cloudflare) if set, then Gemini, Grok, Claude, Cloudflare.
// aiText() falls through to the next configured provider when one fails (quota, bad key).
import { kv, kvEnabled, parse } from "./kv.js";

const clean = (v) => String(v || "").replace(/[\s"'`]/g, "");
const isGoogleKey = (k) => /^(AIza|AQ\.)/.test(k);
const NAMES = { gemini: "Gemini", grok: "Grok", claude: "Claude", cloudflare: "Cloudflare AI" };

export function aiProviders() {
  const keys = [clean(process.env.GEMINI_API_KEY), clean(process.env.GOOGLE_API_KEY), clean(process.env.XAI_API_KEY), clean(process.env.ANTHROPIC_API_KEY), clean(process.env.AI_API_KEY)].filter(Boolean);
  const out = [];
  /* anything in GEMINI_API_KEY / GOOGLE_API_KEY is a Google key; elsewhere recognise Google's key formats */
  const g = clean(process.env.GEMINI_API_KEY) || clean(process.env.GOOGLE_API_KEY) || keys.find((k) => isGoogleKey(k));
  if (g) out.push({ provider: "gemini", key: g, model: process.env.GEMINI_MODEL || "" });
  const x = keys.find((k) => k.startsWith("xai-")); if (x) out.push({ provider: "grok", key: x, model: process.env.GROK_MODEL || "grok-4.5" });
  const c = keys.find((k) => k.startsWith("sk-ant-")); if (c) out.push({ provider: "claude", key: c, model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5" });
  const cfA = clean(process.env.CLOUDFLARE_ACCOUNT_ID), cfT = clean(process.env.CLOUDFLARE_API_TOKEN);
  if (cfA && cfT) out.push({ provider: "cloudflare", key: cfT, account: cfA, model: process.env.CF_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct" });
  const unknown = keys.find((k) => !isGoogleKey(k) && !/^(xai-|sk-ant-)/.test(k) && k !== g);
  if (!out.length && unknown) out.push({ provider: "unknown", key: unknown, model: "" });
  const pref = String(process.env.AI_PROVIDER || "").toLowerCase();
  out.sort((a, b) => (b.provider === pref) - (a.provider === pref));
  return out.map((p) => ({ ...p, known: p.provider !== "unknown", hint: p.key.slice(0, 4) + "…", name: NAMES[p.provider] || "AI" }));
}
export function aiConfig() { return aiProviders()[0] || null; }

export function friendlyError(cfg, msg) {
  const m = String(msg || "");
  if (cfg && cfg.provider === "unknown") {
    const guess = /^sk-proj-|^sk-[A-Za-z0-9]{20}/.test(cfg.key) ? " (หน้าตาเหมือนคีย์ของ OpenAI/ChatGPT)" : "";
    return `คีย์ที่ตั้งไว้ใน Vercel ขึ้นต้นด้วย "${cfg.hint}"${guess} ไม่ใช่คีย์ที่แอปรู้จัก (คีย์ Gemini ให้ใส่ในช่อง GEMINI_API_KEY, Grok ขึ้นต้น xai-, Claude ขึ้นต้น sk-ant-)`;
  }
  if (cfg && /^sk-ant-(oat|ort)/.test(cfg.key)) return "คีย์ที่ตั้งไว้เป็นโทเคนล็อกอินของแพ็กเกจ Claude (sk-ant-oat…) ใช้เรียก API ไม่ได้ ต้องใช้ API key ที่ขึ้นต้นด้วย sk-ant-api จาก console.anthropic.com";
  if (cfg?.provider === "gemini") {
    if (/quota|rate|exhaust|429|resource_exhausted/i.test(m)) return "โควตาฟรีของ Gemini ช่วงนี้หมดแล้ว ระบบใช้บอทระบบปิดแทนไปก่อน ลองใหม่ภายหลัง";
    if (/api key|permission|unauth|invalid|403|400.*key/i.test(m)) return `Gemini ไม่รับคีย์ที่ตั้งไว้ (ขึ้นต้นด้วย "${cfg.key.slice(0, 6)}…") สร้างคีย์ใหม่ที่ aistudio.google.com แล้วใส่ใน GEMINI_API_KEY จากนั้น Redeploy`;
  }
  if (cfg?.provider === "claude" && /x-api-key|authentication|invalid.*key/i.test(m)) return `Claude ไม่รับคีย์ที่ตั้งไว้ (ขึ้นต้นด้วย "${cfg.key.slice(0, 10)}…") คีย์อาจถูกลบ คัดลอกไม่ครบ หรือมาจากบัญชีอื่น สร้าง API key ใหม่ที่ console.anthropic.com → API Keys แล้วใส่ใน ANTHROPIC_API_KEY จากนั้น Redeploy`;
  if (/x-api-key|api key|authentication|unauthor|invalid.*key|incorrect.*key/i.test(m)) return `คีย์ ${cfg?.name || "AI"} ใน Vercel ใช้ไม่ได้ ตรวจคีย์แล้ว Redeploy`;
  if (/credit|balance|billing|quota|spending|429/i.test(m)) return `โควตาหรือเครดิต ${cfg?.name || "AI"} หมด ระบบใช้บอทระบบปิดแทนไปก่อน`;
  if (/model/i.test(m)) return `${cfg?.name || "AI"} ไม่รู้จักรุ่นโมเดลที่ตั้งไว้ (${cfg?.model || "อัตโนมัติ"})`;
  return `${cfg?.name || "AI"} ตอบว่า: ${m.slice(0, 160)}`;
}

/* remember how the AI did, for the system status page */
export async function aiStatus(ok, cfg, err) {
  if (!kvEnabled) return;
  const row = { at: new Date().toISOString(), ok, ai: cfg?.name || null, err: ok ? null : String(err || "").slice(0, 200) };
  /* one row per provider, so a failing backup does not hide how the main AI is doing */
  try { const all = parse(await kv("GET", "ai:status"), {}) || {}; const m = all.ai ? {} : all; m[cfg?.provider || "ai"] = row; await kv("SET", "ai:status", JSON.stringify(m), "EX", String(14 * 86400)); } catch {}
}

/* Gemini model: GEMINI_MODEL, else the newest general "flash" model this key can use (cached a day) */
const GEM = "https://generativelanguage.googleapis.com/v1beta";
export async function geminiModel(cfg) {
  if (cfg.model) return cfg.model.replace(/^models\//, "");
  if (kvEnabled) { try { const c = await kv("GET", "ai:geminiModel"); if (c) return c; } catch {} }
  const r = await fetch(`${GEM}/models?pageSize=200`, { headers: { "x-goog-api-key": cfg.key }, signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (/key|permission|unauth|quota|exhaust/i.test(j?.error?.message || "") || r.status === 429) throw new Error(`${r.status} ${j?.error?.message || ""}`); return "gemini-flash-latest"; }
  const ver = (n) => Number((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const ok = (j.models || []).map((x) => ({ n: String(x.name || "").replace(/^models\//, ""), m: x.supportedGenerationMethods || [] }))
    .filter((x) => x.m.includes("generateContent") && /^gemini-[\d.]+-flash/.test(x.n) && !/lite|image|tts|audio|live|thinking|exp|preview|embed/i.test(x.n))
    .sort((a, b) => ver(b.n) - ver(a.n) || a.n.length - b.n.length);
  const pick = ok[0]?.n || (j.models || []).map((x) => String(x.name || "").replace(/^models\//, "")).find((n) => /flash/.test(n) && !/image|tts|embed/.test(n));
  if (!pick) return "gemini-flash-latest";
  if (kvEnabled) { try { await kv("SET", "ai:geminiModel", pick, "EX", "86400"); } catch {} }
  return pick;
}
export function geminiBody(system, prompt, maxTokens, search) {
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    ...(search ? { tools: [{ google_search: {} }] } : {}),
  };
}

async function callOne(cfg, prompt, { system, maxTokens, timeout }) {
  if (cfg.provider === "gemini") {
    const model = await geminiModel(cfg);
    const r = await fetch(`${GEM}/models/${model}:generateContent`, {
      method: "POST", signal: AbortSignal.timeout(timeout),
      headers: { "content-type": "application/json", "x-goog-api-key": cfg.key },
      body: JSON.stringify(geminiBody(system, prompt, maxTokens, false)),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (r.status === 404 && kvEnabled) await kv("DEL", "ai:geminiModel").catch(() => {}); throw new Error(friendlyError(cfg, `${r.status} ${j?.error?.status || ""} ${j?.error?.message || ""}`)); }
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  }
  if (cfg.provider === "cloudflare") {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfg.account}/ai/run/${cfg.model}`, {
      method: "POST", signal: AbortSignal.timeout(timeout),
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ max_tokens: maxTokens, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(friendlyError(cfg, j?.errors?.[0]?.message || r.status));
    return j.result?.response || "";
  }
  if (cfg.provider === "grok") {
    const r = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(timeout),
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(friendlyError(cfg, j?.error?.message || j?.error || r.status));
    return j.choices?.[0]?.message?.content || "";
  }
  if (cfg.provider === "claude") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(timeout),
      headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: "user", content: prompt }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(friendlyError(cfg, j?.error?.message || r.status));
    return (j.content || []).map((c) => c.text || "").join("");
  }
  throw new Error(friendlyError(cfg, "unknown key"));
}

/* plain text answer; tries each configured provider in order (daily job, reviews, analyst polish) */
export async function aiText(prompt, { system = "", maxTokens = 2000, timeout = 50000 } = {}) {
  const list = aiProviders(); if (!list.length) throw new Error("no key");
  let last;
  for (const cfg of list) {
    try { const t = await callOne(cfg, prompt, { system, maxTokens, timeout }); await aiStatus(true, cfg); return t; }
    catch (e) { last = e; await aiStatus(false, cfg, e?.message); }
  }
  throw last;
}
export const aiParse = (text, d = null) => { const s = String(text || ""); return parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1), d); };
