// Long-form analysis for one match. Uses only the numbers the app sends plus today's headlines.
// Needs ANTHROPIC_API_KEY in the Vercel project settings.
import { kv, kvEnabled, parse } from "../lib/kv.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

async function headlines() {
  try {
    const r = await fetch("https://feeds.bbci.co.uk/sport/football/rss.xml", { signal: AbortSignal.timeout(5000) });
    const xml = await r.text();
    return [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].slice(0, 15)
      .map((m) => m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
  } catch { return []; }
}

export default async function handler(req, res) {
  const id = String((req.query && req.query.id) || "");
  if (req.method === "GET") {
    if (!kvEnabled || !/^\d{1,12}$/.test(id)) { res.status(200).json({}); return; }
    try { res.status(200).json(parse(await kv("GET", `ana:${id}`), {})); } catch { res.status(200).json({}); }
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "GET or POST" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(200).json({ error: "ยังไม่ได้ตั้ง ANTHROPIC_API_KEY ใน Vercel" }); return; }
  const data = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const news = await headlines();
  const prompt = `เขียนบทวิเคราะห์ฟุตบอลคู่นี้เป็นภาษาไทย สำนวนนักข่าวกีฬาไทยยุคปัจจุบัน อ่านสนุก มีจังหวะ ไม่เยิ่นเย้อ 5-7 ย่อหน้า
โครง: เปิดเรื่องบรรยากาศเกม / ฟอร์มและสไตล์ของสองทีม / สถิติที่เคยเจอกัน / ปัจจัยหน้างาน (วันพัก ตัวจริง สภาพอากาศ ข่าว) / มุมเกมรุก-รับและประตู / มุมราคา / สรุปทายสกอร์
กติกา: ใช้เฉพาะข้อมูลด้านล่าง ชื่อนักเตะต้องมีอยู่ในข้อมูลหรือหัวข่าวเท่านั้น ห้ามแต่งข่าว อาการบาดเจ็บ หรือแท็กติกที่ไม่มีข้อมูล ห้ามชวนเดิมพัน ห้ามอ้างว่าแม่นหรือชัวร์
ตอบ JSON เท่านั้น: {"paras":["ย่อหน้า 1","ย่อหน้า 2",...]}
หัวข่าววันนี้: ${JSON.stringify(news)}
ข้อมูลคู่: ${JSON.stringify(data).slice(0, 6000)}`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2500, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(55000),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || String(r.status));
    const text = (j.content || []).map((c) => c.text || "").join("");
    const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const result = { at: new Date().toISOString(), paras: Array.isArray(out.paras) ? out.paras.slice(0, 8) : [] };
    if (kvEnabled && /^\d{1,12}$/.test(String(data.id || "")) && result.paras.length) {
      try { await kv("SET", `ana:${data.id}`, JSON.stringify(result), "EX", String(5 * 86400)); } catch {}
    }
    res.status(200).json(result);
  } catch {
    res.status(200).json({ error: "เขียนบทวิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง" });
  }
}
