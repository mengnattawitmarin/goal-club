// Daily brief: reads real headlines (BBC Sport, The Guardian, ESPN) and the app's model numbers,
// then asks Claude for a Thai summary. Needs ANTHROPIC_API_KEY in the Vercel project settings.
import { kv, kvPipe, kvEnabled } from "../lib/kv.js";
import { aiConfig, aiText } from "../lib/ai.js";

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
  if (!aiConfig()) { res.status(200).json({ error: "ยังไม่ได้ตั้งคีย์ AI ใน Vercel (ANTHROPIC_API_KEY หรือ XAI_API_KEY) จึงยังเขียนบทวิเคราะห์ไม่ได้" }); return; }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const matches = Array.isArray(body.matches) ? body.matches.slice(0, 30) : [];
  const headlines = (await Promise.all([...FEEDS.map(rss), espnNews()])).flat().slice(0, 20);

  const prompt = `คุณคือนักวิเคราะห์สถิติฟุตบอลของแอป Goal Club เขียนภาษาไทยทั้งหมด
ข้อมูลคือผลโมเดลและราคาตลาดของวันที่ ${body.date} (เวลาไทย) และหัวข่าวจริงของวันนี้
กติกา: ใช้เฉพาะตัวเลขและข่าวที่ให้มา ชื่อนักเตะต้องปรากฏในหัวข่าวเท่านั้น ห้ามแต่งข่าวหรือตัวเลข ห้ามชวนเดิมพัน ห้ามอ้างว่าแม่นหรือชัวร์
สำนวน: ภาษานักข่าวกีฬาไทยยุคปัจจุบัน อ่านสนุก กระชับ มีจังหวะ
ตอบเป็น JSON เท่านั้น: {"summary":"ภาพรวมของวัน 4-6 ประโยค","notes":[{"match":"ทีม - ทีม (ใช้ชื่อตามช่อง match)","text":"2 ประโยค"}],"players":[{"name":"ชื่อจากข่าว","club":"สโมสร","detail":"ย้ายทีม/บาดเจ็บ/กำลังใจ หนึ่งประโยค"}],"adjust":[{"match":"ทีม - ทีม (ตามช่อง match)","team":"home|away","effect":-0.05,"reason":"เหตุผลสั้น อ้างข่าว"}]}
notes 4-6 คู่ players ไม่เกิน 7 คน (ถ้าข่าวไม่มีชื่อให้เป็น [])
adjust ใส่เฉพาะเมื่อหัวข่าวยืนยันว่านักเตะหลักของทีมในคู่วันนี้ไม่ได้ลง (บาดเจ็บ/โดนแบน) หรือเปลี่ยนโค้ชกะทันหัน effect อยู่ระหว่าง -0.05 ถึง 0.03 ถ้าไม่มีให้เป็น []
หัวข่าว: ${JSON.stringify(headlines.map((h) => `${h.source}: ${h.title}`))}
ข้อมูลคู่: ${JSON.stringify(matches)}`;

  try {
    const text = await aiText(prompt, { maxTokens: 2500 });
    const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const names = headlines.map((h) => h.title.toLowerCase()).join(" ");
    const players = (out.players || []).filter((p) => p?.name && p.name.toLowerCase().split(/\s+/).some((w) => w.length > 2 && names.includes(w)));
    const adjust = (out.adjust || []).filter((a) => a && a.match && /^(home|away)$/.test(a.team) && Number.isFinite(Number(a.effect)));
    const brief = { at: new Date().toISOString(), summary: out.summary || "", notes: out.notes || [], players, headlines, adjust };
    if (kvEnabled && /^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) {
      try {
        const cmds = [["SET", `brief:${body.date}`, JSON.stringify(brief), "EX", String(14 * 86400)]];
        for (const a of adjust) {
          const m = matches.find((x) => String(a.match || "").toLowerCase().includes(String(x.match || "").split(" - ")[0].toLowerCase()));
          const tid = m && (a.team === "away" ? m.awayId : m.homeId);
          if (tid) cmds.push(["HSET", "newsteam", String(tid), JSON.stringify({ e: Math.max(-0.05, Math.min(0.03, Number(a.effect) || 0)), reason: String(a.reason || "").slice(0, 120), d: body.date })]);
        }
        for (const p of players) {
          const st = p.kind === "injury" ? "out" : null; if (!st || !p.name) continue;
          cmds.push(["HSET", "newsplayer", String(p.name).toLowerCase(), JSON.stringify({ name: p.name, team: p.club || "", status: st, reason: String(p.detail || "").slice(0, 120), d: body.date })]);
        }
        await kvPipe(cmds);
      } catch {}
    }
    res.status(200).json(brief);
  } catch (e) {
    res.status(200).json({ error: /คีย์|เครดิต|รุ่น|ตอบว่า/.test(String(e?.message)) ? e.message : "เขียนบทวิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง" });
  }
}
