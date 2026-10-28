// One place that decides which AI to call. The provider follows the key you paste in Vercel:
//   key starting with "xai-"    -> Grok (xAI)      model: GROK_MODEL (default grok-4.5)
//   key starting with "sk-ant-" -> Claude (Anthropic) model: ANTHROPIC_MODEL (default claude-sonnet-5-5)
// The key can sit in ANTHROPIC_API_KEY or XAI_API_KEY. Switching = changing the key + Redeploy.
const clean = (v) => String(v || "").replace(/[\s"'`]/g, "");

export function aiConfig() {
  const keys = [clean(process.env.XAI_API_KEY), clean(process.env.ANTHROPIC_API_KEY), clean(process.env.AI_API_KEY)].filter(Boolean);
  const key = keys.find((k) => k.startsWith("xai-")) || keys.find((k) => k.startsWith("sk-ant-")) || keys[0] || "";
  if (!key) return null;
  const provider = key.startsWith("xai-") ? "grok" : "claude";
  const known = key.startsWith("xai-") || key.startsWith("sk-ant-");
  return {
    provider, key, known, hint: key.slice(0, 4) + "…",
    name: provider === "grok" ? "Grok" : "Claude",
    model: provider === "grok" ? process.env.GROK_MODEL || "grok-4.5" : process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  };
}

export function friendlyError(cfg, msg) {
  const m = String(msg || "");
  if (cfg && !cfg.known) {
    const guess = /^sk-proj-|^sk-[A-Za-z0-9]{20}/.test(cfg.key) ? " (หน้าตาเหมือนคีย์ของ OpenAI/ChatGPT)" : /^AIza/.test(cfg.key) ? " (หน้าตาเหมือนคีย์ของ Google Gemini)" : "";
    return `คีย์ที่ตั้งไว้ใน Vercel ขึ้นต้นด้วย "${cfg.hint}"${guess} ไม่ใช่คีย์ของ Grok (ขึ้นต้น xai-) หรือ Claude (ขึ้นต้น sk-ant-)`;
  }
  if (/x-api-key|api key|authentication|unauthor|invalid.*key|incorrect.*key/i.test(m)) return `คีย์ ${cfg?.name || "AI"} ใน Vercel ใช้ไม่ได้ ตรวจคีย์แล้ว Redeploy`;
  if (/credit|balance|billing|quota|spending/i.test(m)) return `เครดิต ${cfg?.name || "AI"} หมด เติมเครดิตแล้วลองใหม่`;
  if (/model/i.test(m)) return `${cfg?.name || "AI"} ไม่รู้จักรุ่นโมเดลที่ตั้งไว้ (${cfg?.model}) ตั้ง ${cfg?.provider === "grok" ? "GROK_MODEL" : "ANTHROPIC_MODEL"} ใน Vercel`;
  return `${cfg?.name || "AI"} ตอบว่า: ${m}`;
}

/* plain text answer (used by the daily brief and the news scan) */
export async function aiText(prompt, { system = "", maxTokens = 2000, timeout = 50000 } = {}) {
  const cfg = aiConfig(); if (!cfg) throw new Error("no key");
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
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(timeout),
    headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: "user", content: prompt }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(friendlyError(cfg, j?.error?.message || r.status));
  return (j.content || []).map((c) => c.text || "").join("");
}
