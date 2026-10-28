// Daily brief: reads real headlines (BBC Sport, The Guardian, ESPN) and the app's model numbers,
// then asks Claude for a Thai summary. Needs ANTHROPIC_API_KEY in the Vercel project settings.
const FEEDS = [
  { source: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/football/rss.xml" },
  { source: "The Guardian", url: "https://www.theguardian.com/football/rss" },
];
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

function decode(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, "").trim();
}
async function rss({ source, url }) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map((m) => ({
      source,
      title: decode((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""),
      url: decode((m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || ""),
    })).filter((x) => x.title);
  } catch { return []; }
}
async function espnNews() {
  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/news?limit=6", { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return (j.articles || []).map((a) => ({ source: "ESPN", title: a.headline, url: a.links?.web?.href || "" })).filter((x) => x.title);
  } catch { return []; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(200).json({ error: "ยังไม่ได้ตั้ง ANTHROPIC_API_KEY ใน Vercel จึงยังเขียนบทวิเคราะห์ไม่ได้" }); return; }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const matches = Array.isArray(body.matches) ? body.matches.slice(0, 30) : [];
  const headlines = (await Promise.all([...FEEDS.map(rss), espnNews()])).flat().slice(0, 20);

  const prompt = `คุณคือนักวิเคราะห์สถิติฟุตบอลของแอป Goal Club เขียนภาษาไทยทั้งหมด
ข้อมูลคือผลโมเดลและราคาตลาดของวันที่ ${body.date} (เวลาไทย) และหัวข่าวจริงของวันนี้
กติกา: ใช้เฉพาะตัวเลขและข่าวที่ให้มา ชื่อนักเตะต้องปรากฏในหัวข่าวเท่านั้น ห้ามแต่งข่าวหรือตัวเลข ห้ามชวนเดิมพัน ห้ามอ้างว่าแม่นหรือชัวร์
ตอบเป็น JSON เท่านั้น: {"summary":"ภาพรวม 2-3 ประโยค","notes":[{"match":"ทีม - ทีม","text":"หนึ่งประโยค"}],"players":[{"name":"ชื่อจากข่าว","club":"สโมสร","detail":"ย้ายทีม/บาดเจ็บ/กำลังใจ หนึ่งประโยค"}]}
notes 3-5 คู่ players ไม่เกิน 7 คน (ถ้าข่าวไม่มีชื่อให้เป็น [])
หัวข่าว: ${JSON.stringify(headlines.map((h) => `${h.source}: ${h.title}`))}
ข้อมูลคู่: ${JSON.stringify(matches)}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(50000),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message || String(r.status));
    const text = (j.content || []).map((c) => c.text || "").join("");
    const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const names = headlines.map((h) => h.title.toLowerCase()).join(" ");
    const players = (out.players || []).filter((p) => p?.name && p.name.toLowerCase().split(/\s+/).some((w) => w.length > 2 && names.includes(w)));
    res.status(200).json({ summary: out.summary || "", notes: out.notes || [], players, headlines });
  } catch (e) {
    res.status(200).json({ error: "เขียนบทวิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง" });
  }
}
