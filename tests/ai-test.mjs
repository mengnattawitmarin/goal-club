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
process.exit(failed ? 1 : 0);
