// บอท Goal Club: เขียนบทวิเคราะห์เต็ม + ทัศนะบอลของคู่เดียว
// - ใช้ตัวเลขทุกอย่างที่แอปคำนวณ (ส่งมาจากหน้าแอป)
// - ดึงข้อมูลเชิงลึกจาก ESPN ฝั่งเซิร์ฟเวอร์
// - ค้นข่าวล่าสุดจากเว็บด้วยเครื่องมือ web_search ของ Claude API แล้วอ้างแหล่ง
// ส่งผลแบบสตรีมเป็นบรรทัด JSON (NDJSON) เพื่อให้หน้าแอปแสดงระหว่างเขียน
// ต้องตั้ง ANTHROPIC_API_KEY ใน Vercel (ตัวเลือก ANTHROPIC_MODEL)
import { kv, kvEnabled, parse, readBody } from "../lib/kv.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const ID = /^\d{1,12}$/;
const SLUG = /^[a-z0-9._]+$/;

const SKILLS = `คุณคือ "บอท Goal Club" นักวิเคราะห์ฟุตบอลประจำแอป Goal Club เขียนภาษาไทยทั้งหมด

สกิลที่คุณมี (ใช้ให้ครบ):
1. อ่านโมเดลของแอป: ความน่าจะเป็นชนะ/เสมอ/แพ้ สูงต่ำ ทั้งยิงทั้งเสีย ประตูที่คาด (λ) ของแต่ละทีม และปัจจัยทั้งหมดที่โมเดลใช้ (ตารางคะแนน ฟอร์ม ผลที่เคยเจอกัน ฟอร์มในบ้าน/นอกบ้าน วันพัก ตัวจริง สภาพอากาศ ข่าว แนวโน้มลีก การเรียนรู้จากผลจริง ราคาตลาด) พร้อมผลที่แต่ละปัจจัยขยับตัวเลข
2. อ่านราคาต่อรอง: เขียนแฮนดิแคปแบบไทย เช่น "Inter ต่อ 1.5" เทียบโมเดลกับราคาตลาดหลังหักน้ำ
3. ทายสกอร์และคนยิง: ใช้สกอร์ที่โมเดลให้โอกาสสูงสุด รายชื่อคนยิง/คนส่งและเปอร์เซ็นต์จากแอป
4. ตลาดสนุก: ครึ่งแรกมีประตู ผลครึ่งแรก ครึ่ง/จบ ทีมยิงก่อน ชนะไม่เสียประตู
5. ค้นเว็บ: ใช้ web_search หาข่าวล่าสุดของทั้งสองทีม (บาดเจ็บ โดนแบน ตัวจริงที่คาด คำให้สัมภาษณ์โค้ช ฟอร์มนัดล่าสุด) ค้นเป็นภาษาอังกฤษจะได้ผลดีกว่า ค้นไม่เกิน 4 ครั้ง
6. ดวง: ถ้าแอปส่งข้อมูลดวงมา ใช้ได้เฉพาะในหัวข้อดวงท้ายบท และต้องบอกว่าเพื่อความสนุก ไม่เกี่ยวกับความน่าจะเป็น
7. เรียนรู้จากผลงานย้อนหลัง: แอปส่ง lessons, trackRecord และ learnedWeights มา ใช้บอกผู้อ่านว่าโมเดลแม่นหรือพลาดตรงไหนในลีก/ประเภทเส้นนี้ และลดหรือเพิ่มระดับความมั่นใจ (ดาว) ให้สอดคล้อง ถ้าโมเดลแพ้ราคาตลาดในลีกนี้ ให้เขียนตรง ๆ
8. ข่าวนักเตะจากระบบ: playerNews คือรายชื่อที่ระบบจับได้จากหัวข่าว ใช้ร่วมกับผลค้นเว็บ
9. เขียนทัศนะบอล: สำนวนนักข่าวกีฬาไทยยุคปัจจุบัน อ่านสนุก มีจังหวะ กระชับ ไม่เยิ่นเย้อ

กติกาเหล็ก:
- ตัวเลขทุกตัวต้องมาจากข้อมูลของแอปหรือผลค้นเว็บเท่านั้น ห้ามแต่งตัวเลข ชื่อนักเตะ อาการบาดเจ็บ หรือข่าว
- ข้อมูลจากเว็บต้องมาจากผลค้นหาจริง ถ้าค้นไม่เจอให้เขียนว่ายังไม่พบข่าว
- ถ้าข่าวจากเว็บขัดกับตัวเลขของแอป (เช่น ดาวยิงเจ็บแต่แอปยังนับ) ให้บอกตรง ๆ ว่าควรปรับมุมมองอย่างไร
- ห้ามชวนเดิมพัน ห้ามใช้คำว่า แทง ลงเงิน ทุ่ม หมดหน้าตัก ห้ามอ้างว่าชัวร์หรือแม่นที่สุด
- ความน่าจะเป็นในบทต้องใช้ตัวเลขของแอป ไม่ปรับเองตามความรู้สึก

ห้ามเขียนข้อความใด ๆ ก่อนหรือระหว่างการค้น เริ่มเขียนตั้งแต่หัวข้อแรกหลังค้นเสร็จ

รูปแบบคำตอบ (ข้อความล้วน ใช้ ## นำหน้าหัวข้อ และ - นำหน้ารายการ ห้ามใช้ตารางหรือตัวหนา):
## ทัศนะบอล {ลีก}: {เจ้าบ้าน} พบ {ทีมเยือน}
(1–2 ประโยคเปิดเรื่องบรรยากาศเกม)
## สถานการณ์ล่าสุด
## ข่าวทีมและตัวผู้เล่น
## สถิติที่ต้องรู้
## ตัวเลขจากโมเดล Goal Club
## วิเคราะห์เกม
## ทัศนะ
- ทิศทางเกม: ...
- แฮนดิแคปที่โมเดลเอียง: ... (โอกาสครอบเส้น ...%)
- สูง/ต่ำ: ...
- ทายสกอร์: ...
- ดาวยิงที่น่าจับตา: ...
- ความมั่นใจ: ★ ถึง ★★★★★ (อิงความต่างของความน่าจะเป็น)
## ดวงวันนี้ (เพื่อความสนุก)
(ข้ามหัวข้อนี้ถ้าไม่มีข้อมูลดวง)
ปิดท้ายด้วยบรรทัด: ใช้ประกอบการดูบอล ไม่ใช่คำแนะนำให้เดิมพัน`;

async function espnDeep(lg, id) {
  if (!SLUG.test(lg || "") || !ID.test(id || "")) return null;
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/summary?event=${id}`, { signal: AbortSignal.timeout(6000) });
    const p = await r.json();
    const team = (t) => t?.team?.displayName || t?.displayName;
    return {
      venue: p.gameInfo?.venue?.fullName || null,
      h2h: (p.seasonseries?.[0]?.events || []).slice(0, 5).map((e) => `${(e.date || "").slice(0, 10)} ${e.competitors?.map((c) => `${team(c)} ${c.score}`).join(" - ")}`),
      lastFive: (p.lastFiveGames || []).map((b) => ({ team: team(b), games: (b.events || []).slice(0, 5).map((e) => `${(e.gameDate || "").slice(0, 10)} ${e.gameResult} ${e.homeTeamScore}-${e.awayTeamScore} vs ${e.opponent?.displayName || ""}`) })),
      leaders: (p.leaders || []).map((s) => ({ team: team(s), top: (s.leaders || []).map((c) => `${c.displayName || c.name}: ${(c.leaders || []).slice(0, 3).map((l) => `${l.athlete?.displayName} ${l.displayValue}`).join(", ")}`) })),
      injuries: (p.injuries || []).map((t) => ({ team: team(t), list: (t.injuries || []).slice(0, 8).map((i) => `${i.athlete?.displayName} (${i.status || i.type?.description || ""})`) })),
      lineups: (p.rosters || []).map((t) => ({ team: team(t), starters: (t.roster || []).filter((x) => x.starter).map((x) => x.athlete?.displayName) })).filter((t) => t.starters.length),
      news: (p.news?.articles || []).slice(0, 5).map((a) => a.headline),
    };
  } catch { return null; }
}


export default async function handler(req, res) {
  const id = String((req.query && req.query.id) || "");
  if (req.method === "GET") {
    if (!kvEnabled || !ID.test(id)) { res.status(200).json({}); return; }
    try { res.status(200).json(parse(await kv("GET", `ana2:${id}`), {})); } catch { res.status(200).json({}); }
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "GET or POST" }); return; }
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const send = (o) => res.write(JSON.stringify(o) + "\n");
  if (!process.env.ANTHROPIC_API_KEY) { send({ t: "error", d: "ยังไม่ได้ตั้ง ANTHROPIC_API_KEY ใน Vercel" }); res.end(); return; }

  const data = readBody(req);
  send({ t: "status", d: "กำลังอ่านข้อมูลเชิงลึกจาก ESPN" });
  const deep = await espnDeep(data.lg, data.id);
  const user = `วันนี้คือ ${new Date().toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "long" })}
เขียนทัศนะบอลคู่นี้ ค้นข่าวล่าสุดของทั้งสองทีมจากเว็บก่อน แล้วเขียนตามรูปแบบ

ข้อมูลจากแอป Goal Club:
${JSON.stringify(data).slice(0, 9000)}

ข้อมูลเชิงลึกจาก ESPN:
${JSON.stringify(deep || "ไม่มี").slice(0, 5000)}`;

  let text = "", stop = null; const sources = new Map(); let q = "", inSearch = false;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 3000, stream: true, system: SKILLS,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4, user_location: { type: "approximate", country: "TH", timezone: "Asia/Bangkok" } }],
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(57000),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      send({ t: "error", d: `Claude API ตอบว่า: ${j?.error?.message || r.status}` }); res.end(); return;
    }
    send({ t: "status", d: "บอทเริ่มค้นข่าวและเขียนบท" });
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const ev = parse(line.slice(5).trim()); if (!ev) continue;
        if (ev.type === "content_block_start") {
          const b = ev.content_block || {};
          if (b.type === "server_tool_use") { inSearch = true; q = ""; }
          if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
            send({ t: "status", d: `พบข้อมูล ${b.content.length} แหล่ง` });
            for (const x of b.content.slice(0, 6)) if (x.url && !sources.has(x.url)) sources.set(x.url, x.title || x.url);
          }
        } else if (ev.type === "content_block_delta") {
          const d = ev.delta || {};
          if (d.type === "text_delta") { text += d.text; send({ t: "text", d: d.text }); }
          else if (d.type === "input_json_delta" && inSearch) q += d.partial_json || "";
          else if (d.type === "citations_delta" && d.citation?.url) sources.set(d.citation.url, d.citation.title || d.citation.url);
        } else if (ev.type === "content_block_stop" && inSearch) {
          inSearch = false; const qq = parse(q, {})?.query; if (qq) send({ t: "status", d: `กำลังค้น: ${qq}` });
        } else if (ev.type === "message_delta") stop = ev.delta?.stop_reason || stop;
        else if (ev.type === "error") send({ t: "error", d: ev.error?.message || "Claude API error" });
      }
    }
  } catch (e) {
    if (!text) { send({ t: "error", d: e?.name === "TimeoutError" ? "บอทใช้เวลานานเกินไป ลองใหม่อีกครั้ง" : "เชื่อมต่อ Claude ไม่สำเร็จ ลองใหม่อีกครั้ง" }); res.end(); return; }
  }
  const src = [...sources].slice(0, 10).map(([url, title]) => ({ url, title }));
  send({ t: "src", d: src });
  if (stop === "pause_turn" || stop === "max_tokens") send({ t: "status", d: "บทนี้ถูกตัดตอนเพราะยาวหรือค้นนาน" });
  if (text.trim()) {
    const k = text.indexOf("## "); const body = (k > 0 ? text.slice(k) : text).trim();
    const result = { at: new Date().toISOString(), text: body, sources: src, bot: true };
    if (kvEnabled && ID.test(String(data.id || ""))) { try { await kv("SET", `ana2:${data.id}`, JSON.stringify(result), "EX", String(5 * 86400)); } catch {} }
  }
  send({ t: "done" });
  res.end();
}
