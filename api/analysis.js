// บอท Goal Club: เขียนบทวิเคราะห์เต็ม + ทัศนะบอลของคู่เดียว
// - ใช้ตัวเลขทุกอย่างที่แอปคำนวณ (ส่งมาจากหน้าแอป)
// - ดึงข้อมูลเชิงลึกจาก ESPN ฝั่งเซิร์ฟเวอร์
// - ค้นข่าวล่าสุดจากเว็บด้วยเครื่องมือ web_search ของ Claude API แล้วอ้างแหล่ง
// ส่งผลแบบสตรีมเป็นบรรทัด JSON (NDJSON) เพื่อให้หน้าแอปแสดงระหว่างเขียน
// ใช้ Claude หรือ Grok ตามคีย์ที่ตั้งใน Vercel (ดู lib/ai.js)
import { kv, kvEnabled, parse, readBody } from "../lib/kv.js";
import { aiConfig, aiProviders, friendlyError, aiText, aiStatus, geminiModel, geminiBody } from "../lib/ai.js";
import { ANALYST, checkGrounded, hashText } from "../lib/grounded.js";
import { rateLimit } from "../lib/guard.js";

const ID = /^\d{1,12}$/;
const SLUG = /^[a-z0-9._]+$/;

const SKILLS = `คุณคือ "บอท Goal Club" นักวิเคราะห์ฟุตบอลประจำแอป Goal Club เขียนภาษาไทยทั้งหมด

สกิลที่คุณมี (ใช้ให้ครบ):
1. อ่านโมเดลของแอป: ความน่าจะเป็นชนะ/เสมอ/แพ้ สูงต่ำ ทั้งยิงทั้งเสีย ประตูที่คาด (λ) ของแต่ละทีม และปัจจัยทั้งหมดที่โมเดลใช้ (ตารางคะแนน ฟอร์ม ผลที่เคยเจอกัน ฟอร์มในบ้าน/นอกบ้าน วันพัก ตัวจริง สภาพอากาศ ข่าว แนวโน้มลีก การเรียนรู้จากผลจริง ราคาตลาด) พร้อมผลที่แต่ละปัจจัยขยับตัวเลข
2. อ่านราคาต่อรอง: เขียนแฮนดิแคปแบบไทย เช่น "Inter ต่อ 1.5" เทียบโมเดลกับราคาตลาดหลังหักน้ำ
3. ทายสกอร์และคนยิง: ใช้สกอร์ที่โมเดลให้โอกาสสูงสุด รายชื่อคนยิง/คนส่งและเปอร์เซ็นต์จากแอป
4. ตลาดสนุก: ครึ่งแรกมีประตู ผลครึ่งแรก ครึ่ง/จบ ทีมยิงก่อน ชนะไม่เสียประตู
5. ค้นเว็บ: ใช้เครื่องมือค้นเว็บ (และค้นโพสต์บน X ถ้ามี) หาข่าวล่าสุดของทั้งสองทีม (บาดเจ็บ โดนแบน ตัวจริงที่คาด คำให้สัมภาษณ์โค้ช ฟอร์มนัดล่าสุด) ค้นเป็นภาษาอังกฤษจะได้ผลดีกว่า ค้นไม่เกิน 4 ครั้ง
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


/* เมดูซ่า 3.2: AI rewrites the closed-system preview; every number and name is checked against the facts */
async function polish(req, res, data) {
  res.setHeader("Cache-Control", "no-store");
  const facts = String(data.facts || "").slice(0, 9000), id = String(data.id || "");
  if (!ID.test(id) || facts.length < 200 || !facts.includes("## ")) { res.status(200).json({ ok: false, error: "bad facts" }); return; }
  const key = `ana3:${id}`, h = hashText(facts);
  const cached = kvEnabled ? parse(await kv("GET", key).catch(() => null)) : null;
  /* reuse a checked rewrite for 3 hours, or while the facts are unchanged */
  if (cached && (cached.h === h || Date.now() - Date.parse(cached.at) < 3 * 3600e3)) { res.status(200).json({ ok: true, cached: true, ...cached }); return; }
  if (!aiConfig()) { res.status(200).json({ ok: false, error: "no key" }); return; }
  if (kvEnabled && !(await rateLimit(req, "polish", 8, 60).catch(() => true))) { res.status(200).json({ ok: false, error: "busy" }); return; }
  try {
    const text = await aiText(`ข้อเท็จจริงของคู่นี้ (ห้ามใช้ข้อมูลอื่น):\n\n${facts}`, { system: ANALYST, maxTokens: 2200, timeout: 45000 });
    const chk = checkGrounded(facts, text.slice(Math.max(0, text.indexOf("## "))));
    if (!chk.ok) { res.status(200).json({ ok: false, error: "ไม่ผ่านการตรวจ", problems: chk.problems }); return; }
    const out = { at: new Date().toISOString(), h, text: chk.text, ai: aiConfig()?.name };
    if (kvEnabled) await kv("SET", key, JSON.stringify(out), "EX", String(2 * 86400)).catch(() => {});
    res.status(200).json({ ok: true, ...out });
  } catch (e) { res.status(200).json({ ok: false, error: String(e?.message || e).slice(0, 200) }); }
}

export default async function handler(req, res) {
  const id = String((req.query && req.query.id) || "");
  if (req.method === "GET") {
    if (!kvEnabled || !ID.test(id)) { res.status(200).json({}); return; }
    try { res.status(200).json(parse(await kv("GET", req.query.polish ? `ana3:${id}` : `ana2:${id}`), {})); } catch { res.status(200).json({}); }
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "GET or POST" }); return; }
  const body0 = readBody(req);
  if (body0.mode === "polish") return polish(req, res, body0);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const send = (o) => res.write(JSON.stringify(o) + "\n");
  const list = aiProviders().filter((p) => p.provider !== "cloudflare");
  let cfg = list[0];
  if (!cfg) { send({ t: "error", d: "ยังไม่ได้ตั้งคีย์ AI ใน Vercel (GEMINI_API_KEY ฟรีจาก aistudio.google.com หรือ ANTHROPIC_API_KEY / XAI_API_KEY)" }); res.end(); return; }
  if (kvEnabled && !(await rateLimit(req, "bot", 6, 60).catch(() => true))) { send({ t: "error", d: "ขอบทถี่เกินไป รอสักครู่แล้วลองใหม่" }); res.end(); return; }

  const data = body0;
  send({ t: "status", d: "กำลังอ่านข้อมูลเชิงลึกจาก ESPN" });
  const deep = await espnDeep(data.lg, data.id);
  const user = `วันนี้คือ ${new Date().toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "long" })}
เขียนทัศนะบอลคู่นี้ ค้นข่าวล่าสุดของทั้งสองทีมจากเว็บก่อน แล้วเขียนตามรูปแบบ

ข้อมูลจากแอป Goal Club:
${JSON.stringify(data).slice(0, 9000)}

ข้อมูลเชิงลึกจาก ESPN:
${JSON.stringify(deep || "ไม่มี").slice(0, 5000)}`;

  let text = "", stop = null; const sources = new Map();
  const on = {
    text: (d) => { text += d; send({ t: "text", d }); },
    status: (d) => send({ t: "status", d }),
    source: (url, title) => { if (url && !sources.has(url)) sources.set(url, title || url); },
    stop: (s) => { stop = s; },
  };
  try {
    /* try each provider until one starts writing (e.g. Gemini quota used up -> Claude/Grok if configured) */
    let err = null;
    for (const c of list) {
      cfg = c;
      err = c.provider === "gemini" ? await streamGemini(c, user, on) : c.provider === "grok" ? await streamGrok(c, user, on) : c.provider === "claude" ? await streamClaude(c, user, on) : friendlyError(c, "unknown");
      await aiStatus(!err, c, err);
      if (!err || text) break;
      on.status(err);
    }
    if (err && !text) { send({ t: "error", d: err }); res.end(); return; }
  } catch (e) {
    if (!text) { send({ t: "error", d: e?.name === "TimeoutError" ? "บอทใช้เวลานานเกินไป ลองใหม่อีกครั้ง" : `เชื่อมต่อ ${cfg.name} ไม่สำเร็จ ลองใหม่อีกครั้ง` }); res.end(); return; }
  }
  const src = [...sources].slice(0, 10).map(([url, title]) => ({ url, title }));
  send({ t: "src", d: src });
  if (stop === "pause_turn" || stop === "max_tokens") send({ t: "status", d: "บทนี้ถูกตัดตอนเพราะยาวหรือค้นนาน" });
  if (text.trim()) {
    const k = text.indexOf("## "); const body = (k > 0 ? text.slice(k) : text).trim();
    const result = { at: new Date().toISOString(), text: body, sources: src, bot: true, ai: cfg.name };
    if (kvEnabled && ID.test(String(data.id || ""))) { try { await kv("SET", `ana2:${data.id}`, JSON.stringify(result), "EX", String(5 * 86400)); } catch {} }
  }
  send({ t: "done" });
  res.end();
}

/* read a server-sent-events body and hand each JSON event to fn */
async function eachEvent(body, fn) {
  const reader = body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue; const raw = line.slice(5).trim(); if (raw === "[DONE]") continue;
      const ev = parse(raw); if (ev) fn(ev);
    }
  }
}

/* Claude: Messages API with the built-in web_search tool */
async function streamClaude(cfg, user, on) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(57000),
    headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: cfg.model, max_tokens: 3000, stream: true, system: SKILLS,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4, user_location: { type: "approximate", country: "TH", timezone: "Asia/Bangkok" } }],
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); return friendlyError(cfg, j?.error?.message || r.status); }
  on.status("บอท (Claude) เริ่มค้นข่าวและเขียนบท");
  let q = "", inSearch = false;
  await eachEvent(r.body, (ev) => {
    if (ev.type === "content_block_start") {
      const b = ev.content_block || {};
      if (b.type === "server_tool_use") { inSearch = true; q = ""; }
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) { on.status(`พบข้อมูล ${b.content.length} แหล่ง`); for (const x of b.content.slice(0, 6)) on.source(x.url, x.title); }
    } else if (ev.type === "content_block_delta") {
      const d = ev.delta || {};
      if (d.type === "text_delta") on.text(d.text);
      else if (d.type === "input_json_delta" && inSearch) q += d.partial_json || "";
      else if (d.type === "citations_delta" && d.citation?.url) on.source(d.citation.url, d.citation.title);
    } else if (ev.type === "content_block_stop" && inSearch) {
      inSearch = false; const qq = parse(q, {})?.query; if (qq) on.status(`กำลังค้น: ${qq}`);
    } else if (ev.type === "message_delta") on.stop(ev.delta?.stop_reason);
    else if (ev.type === "error") on.status(friendlyError(cfg, ev.error?.message));
  });
  return null;
}

/* Gemini: streamGenerateContent with Google Search grounding (retries without search if the key cannot use it) */
async function streamGemini(cfg, user, on) {
  let model;
  try { model = await geminiModel(cfg); } catch (e) { return friendlyError(cfg, e?.message); }
  const go = (search) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
    method: "POST", signal: AbortSignal.timeout(57000),
    headers: { "content-type": "application/json", "x-goog-api-key": cfg.key },
    body: JSON.stringify(geminiBody(SKILLS, user, 3000, search)),
  });
  let r = await go(true), search = true;
  if (r.status === 400) { r = await go(false); search = false; }
  if (!r.ok) { const j = await r.json().catch(() => ({})); return friendlyError(cfg, `${r.status} ${j?.error?.status || ""} ${j?.error?.message || ""}`); }
  on.status(search ? `บอท (Gemini) ค้นข่าวด้วย Google และเขียนบท` : `บอท (Gemini) เขียนบทจากข้อมูลของแอป (คีย์นี้ใช้การค้นเว็บไม่ได้)`);
  const said = new Set();
  await eachEvent(r.body, (ev) => {
    const c = ev.candidates?.[0];
    for (const p of c?.content?.parts || []) if (p.text) on.text(p.text);
    const gm = c?.groundingMetadata;
    for (const q of gm?.webSearchQueries || []) if (!said.has(q)) { said.add(q); on.status(`กำลังค้น: ${q}`); }
    for (const g of gm?.groundingChunks || []) if (g.web?.uri) on.source(g.web.uri, g.web.title);
    if (c?.finishReason) on.stop(c.finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn");
    if (ev.error) on.status(friendlyError(cfg, ev.error.message));
  });
  return null;
}

/* Grok: xAI Responses API with live web search and X search */
async function streamGrok(cfg, user, on) {
  const r = await fetch("https://api.x.ai/v1/responses", {
    method: "POST", signal: AbortSignal.timeout(57000),
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model, stream: true, max_output_tokens: 3000,
      input: [{ role: "system", content: SKILLS }, { role: "user", content: user }],
      tools: [{ type: "web_search" }, { type: "x_search" }],
    }),
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); return friendlyError(cfg, j?.error?.message || j?.error || j?.code || r.status); }
  on.status("บอท (Grok) เริ่มค้นข่าว ค้นโพสต์บน X และเขียนบท");
  const said = new Set();
  const takeCitations = (resp) => {
    for (const u of resp?.citations || []) on.source(typeof u === "string" ? u : u?.url, typeof u === "string" ? u : u?.title);
    for (const o of resp?.output || []) for (const c of o?.content || []) for (const an of c?.annotations || []) if (an?.url) on.source(an.url, an.title);
  };
  await eachEvent(r.body, (ev) => {
    const t = String(ev.type || "");
    if (t.endsWith("output_text.delta") && typeof ev.delta === "string") on.text(ev.delta);
    else if (t.includes("annotation") && ev.annotation?.url) on.source(ev.annotation.url, ev.annotation.title);
    else if (/web_search_call|x_search_call/.test(t)) {
      const what = t.includes("x_search") ? "กำลังค้นโพสต์บน X" : "กำลังค้นเว็บ";
      const q = ev.item?.action?.query || ev.query; const msg = q ? `${what}: ${q}` : what;
      if (!said.has(msg)) { said.add(msg); on.status(msg); }
    } else if (t === "response.completed") { takeCitations(ev.response); on.stop(ev.response?.status === "incomplete" ? "max_tokens" : "end_turn"); }
    else if (t === "response.failed" || t === "error") on.status(friendlyError(cfg, ev.error?.message || ev.response?.error?.message || "error"));
  });
  return null;
}
