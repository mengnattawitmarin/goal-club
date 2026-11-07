// Tests the bot (api/analysis.js) with both providers against fake streams.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sse = (evs) => evs.map((o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`).join("");
const CLAUDE = sse([
  { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "s1", name: "web_search", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"query\":\"Inter injury news\"}" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "web_search_tool_result", content: [{ url: "https://a.example", title: "A" }] } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "## ทัศนะบอล Claude\nเนื้อหา" } },
  { type: "message_delta", delta: { stop_reason: "end_turn" } }]);
const GROK = sse([
  { type: "response.web_search_call.in_progress", item: { action: { query: "Inter injury" } } },
  { type: "response.x_search_call.searching" },
  { type: "response.output_text.delta", delta: "## ทัศนะบอล Grok\n" },
  { type: "response.output_text.delta", delta: "เนื้อหา" },
  { type: "response.completed", response: { status: "completed", citations: ["https://x.com/post/1"], output: [{ content: [{ annotations: [{ type: "url_citation", url: "https://b.example", title: "B" }] }] }] } }]);
let lastUrl = "";
globalThis.fetch = async (url) => {
  lastUrl = String(url);
  const stream = (s) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (let i = 0; i < s.length; i += 41) c.enqueue(e.encode(s.slice(i, i + 41))); c.close(); } }), { status: 200 });
  if (lastUrl.includes("api.anthropic.com")) return stream(CLAUDE);
  if (lastUrl.includes("api.x.ai")) return stream(GROK);
  return new Response("{}", { status: 200 });
};
const h = (await import(join(root, "api/analysis.js"))).default;
async function run() { let out = ""; const res = { setHeader() {}, write(s) { out += s; }, end() {}, status() { return this; }, json(o) { out += JSON.stringify(o); } }; await h({ method: "POST", query: {}, body: { id: "1", lg: "ita.1" } }, res); return out.trim().split("\n").map((l) => JSON.parse(l)); }
let failed = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ai: ${n}${x ? "  " + x : ""}`); if (!ok) failed++; };

process.env.ANTHROPIC_API_KEY = "sk-ant-test"; delete process.env.XAI_API_KEY;
let ev = await run();
check("sk-ant- key uses Claude with web search", lastUrl.includes("anthropic") && ev.some((e) => e.t === "status" && e.d.includes("Inter injury news")) && ev.filter((e) => e.t === "text").map((e) => e.d).join("").includes("Claude"));
process.env.ANTHROPIC_API_KEY = " xai-test\n";   // Grok key pasted into the Anthropic slot, with stray whitespace
ev = await run();
const src = ev.find((e) => e.t === "src")?.d || [];
check("xai- key uses Grok with web and X search", lastUrl.includes("x.ai") && ev.some((e) => e.t === "status" && e.d.includes("X")) && ev.filter((e) => e.t === "text").map((e) => e.d).join("") === "## ทัศนะบอล Grok\nเนื้อหา");
check("Grok citations collected", src.some((s) => s.url === "https://b.example") && src.some((s) => s.url === "https://x.com/post/1"), JSON.stringify(src));
process.env.ANTHROPIC_API_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz";
globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 });
ev = await run();
check("unknown key type is named by its first characters", ev.some((e) => e.t === "error" && e.d.includes("sk-p…") && e.d.includes("OpenAI")), ev.map((e) => e.d).join(" | "));
delete process.env.ANTHROPIC_API_KEY;
ev = await run();
check("no key gives a clear message", ev[0]?.t === "error" && ev[0].d.includes("คีย์"));

/* ---- เมดูซ่า 3.2: Gemini ---- */
const GEM_SSE = [
  { candidates: [{ content: { parts: [{ text: "## ทัศนะบอล Gemini\n" }] }, groundingMetadata: { webSearchQueries: ["Inter team news"] } }] },
  { candidates: [{ content: { parts: [{ text: "เนื้อหา" }] }, finishReason: "STOP", groundingMetadata: { groundingChunks: [{ web: { uri: "https://g.example", title: "G" } }] } }] },
].map((o) => `data: ${JSON.stringify(o)}\r\n\r\n`).join("");
const MODELS = { models: [{ name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.8-flash-lite", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.8-flash-image", supportedGenerationMethods: ["generateContent"] }] };
let gemMode = "ok", urls = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url); urls.push(u);
  const stream = (s) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (let i = 0; i < s.length; i += 37) c.enqueue(e.encode(s.slice(i, i + 37))); c.close(); } }), { status: 200 });
  if (u.includes("generativelanguage") && u.endsWith("/models?pageSize=200")) return new Response(JSON.stringify(MODELS), { status: 200 });
  if (u.includes("streamGenerateContent")) return gemMode === "quota" || (gemMode === "newOnly" && u.includes("3.8-flash:")) ? new Response(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }), { status: 429 }) : stream(GEM_SSE);
  if (u.includes(":generateContent")) {
    const facts = JSON.parse(opts.body).contents[0].parts[0].text;
    const good = facts.split("\n").filter((l) => l.startsWith("##") || l.startsWith("-")).join("\n") + "\nเกมนี้น่าสนใจมาก ".repeat(10);
    const bad = good + "\n- Kylian Mbappé ยิงแน่ 99%";
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: gemMode === "invent" ? bad : good }] } }] }), { status: 200 });
  }
  if (u.includes("api.anthropic.com")) return stream(CLAUDE);
  return new Response("{}", { status: 200 });
};
process.env.GEMINI_API_KEY = "AIzaTestKey123"; process.env.ANTHROPIC_API_KEY = "";
const { aiProviders, geminiModel, geminiModels } = await import(join(root, "lib/ai.js"));
check("Gemini key is picked first and the newest general flash model is chosen", aiProviders()[0].provider === "gemini" && (await geminiModel(aiProviders()[0])) === "gemini-3.8-flash");
ev = await run();
check("Gemini streams with Google Search grounding", urls.some((u) => u.includes("gemini-3.8-flash:streamGenerateContent")) && ev.filter((e) => e.t === "text").map((e) => e.d).join("") === "## ทัศนะบอล Gemini\nเนื้อหา" && ev.some((e) => e.t === "status" && e.d.includes("Inter team news")) && (ev.find((e) => e.t === "src")?.d || []).some((s) => s.url === "https://g.example"));
gemMode = "quota";
ev = await run();
check("Gemini quota used up gives a clear Thai message", ev.some((e) => e.t === "error" && e.d.includes("โควตาฟรีของ Gemini")), ev.map((e) => e.d).join(" | "));
gemMode = "newOnly"; urls = [];
ev = await run();
check("newest model out of free quota -> older flash model is used instead", urls.some((u) => u.includes("gemini-2.0-flash:streamGenerateContent")) && ev.filter((e) => e.t === "text").map((e) => e.d).join("").includes("Gemini"), urls.filter((u) => u.includes("stream")).map((u) => u.split("/models/")[1]).join(" "));
check("model order: newest flash, older flash, lite last", JSON.stringify((await geminiModels(aiProviders()[0])).slice(0, 3)) === JSON.stringify(["gemini-3.8-flash", "gemini-2.0-flash", "gemini-3.8-flash-lite"]));
gemMode = "quota";
process.env.ANTHROPIC_API_KEY = "sk-ant-test";
ev = await run();
check("falls through to Claude when Gemini quota is used up", ev.filter((e) => e.t === "text").map((e) => e.d).join("").includes("Claude"));
process.env.ANTHROPIC_API_KEY = ""; gemMode = "ok";
const facts = "## ทัศนะบอล\nพรีเมียร์ลีก · Arsenal พบ Chelsea\n## ตัวเลขจากโมเดล Goal Club\n- ผลการแข่งขัน: Arsenal 52% · เสมอ 26% · Chelsea 22%\n- ประตูที่คาด: Arsenal 1.62 · Chelsea 1.05\n## ทัศนะ\n- ทายสกอร์: 2-1\n- ดาวยิงที่น่าจับตา: Bukayo Saka (Arsenal) 41%\n" + "ข้อมูลเพิ่มเติม ".repeat(20);
const polish = async () => { let out; const res = { setHeader() {}, status() { return this; }, json(o) { out = o; } }; await h({ method: "POST", query: {}, headers: {}, body: { mode: "polish", id: "9", facts } }, res); return out; };
let pj = await polish();
check("AI analyst rewrite passes the fact check", pj.ok === true && pj.text.includes("ไม่ใช่คำแนะนำให้เดิมพัน"), JSON.stringify(pj).slice(0, 120));
gemMode = "invent"; pj = await polish();
check("rewrite with an invented player and number is rejected", pj.ok === false && pj.problems?.some((x) => x.includes("99")) && pj.problems?.some((x) => /mbapp/i.test(x)), JSON.stringify(pj));
const { checkGrounded } = await import(join(root, "lib/grounded.js"));
check("betting talk is rejected", !checkGrounded(facts, facts + "\nแทงเลย ชัวร์").ok);
process.env.GEMINI_API_KEY = "AQ.TestNewFormatKey"; process.env.ANTHROPIC_API_KEY = "";
check("new Google key format (AQ.) in GEMINI_API_KEY is used as Gemini", aiProviders()[0]?.provider === "gemini" && aiProviders().length === 1);
process.env.GEMINI_API_KEY = `curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent" \\\n  -H 'Content-Type: application/json' \\\n  -H 'X-goog-api-key: AQ.Ab8TestPastedKey_abc-123456789' \\\n  -X POST`;
check("key is pulled out of a pasted curl example", aiProviders()[0]?.key === "AQ.Ab8TestPastedKey_abc-123456789", aiProviders()[0]?.hint);
process.exit(failed ? 1 : 0);
