// End-to-end smoke test against tests/mock-server.mjs. Needs: npm i && npx playwright install chromium
// Usage: npm test
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright"); // local node_modules or a global install
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8099, BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, [join(root, "tests/mock-server.mjs")], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => server.stdout.once("data", r));

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? "  " + extra : ""}`); if (!ok) failed++; };
const browser = await chromium.launch();
const errors = [];
async function device() {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/espncdn|site\.api\.espn\.com|sports\.core|googleapis|gstatic|open-meteo|wikipedia/, (r) => r.abort());
  return p;
}
try {
  await fetch(`${BASE}/reset`);
  const A = await device();
  await A.goto(BASE); await A.waitForTimeout(2500);
  check("live status shows ESPN", (await A.textContent("#status")).includes("สดจาก ESPN"));
  check("shared store is on", await A.evaluate(() => Shared.on));
  check("picks drawer rendered", await A.isVisible('.dhead[data-drawer="picks"]'));
  check("page has no horizontal scroll", (await A.evaluate(() => document.documentElement.scrollWidth)) <= 400);

  await A.click('#view .pcard[data-open="9001"]'); await A.waitForTimeout(1500);
  check("match sheet opens", await A.isVisible("#sheet"));
  const factors = await A.evaluate(() => S.open.factors.map((f) => f.k));
  check("model factors applied", ["h2h", "pace", "venue", "rest", "lineup"].every((k) => factors.includes(k)), factors.join(","));
  for (const t of ["market", "stats", "luck", "overview"]) { await A.click(`[data-set="sheetTab:${t}"]`); await A.waitForTimeout(150); }
  check("sheet tabs switch without errors", errors.length === 0);
  await A.click('[data-set="sheetTab:overview"]');
  const closed = await A.evaluate(() => document.querySelector("#botBody")?.innerText || "");
  check("closed-system bot writes a full ทัศนะ instantly", ["ทัศนะบอล", "สถานการณ์ล่าสุด", "ข่าวทีมและตัวผู้เล่น", "สถิติที่ต้องรู้", "ตัวเลขจากโมเดล Goal Club", "วิเคราะห์เกม", "ทายสกอร์", "ไม่ใช่คำแนะนำให้เดิมพัน"].every((k) => closed.includes(k)) && !/undefined|NaN|null/.test(closed), closed.slice(0, 80).replace(/\s+/g, " "));
  check("closed bot lists injuries", closed.includes("Cole Palmer (Hamstring)") && closed.includes("บาดเจ็บ"), closed.match(/.*บาดเจ็บ.*/)?.[0] || "");
  const inj = await A.evaluate(() => { const m = refine({ ...S.open.raw, ds: { ...S.open.ds, lineup: null } }); const f = m.factors.find((x) => x.k === "injury"); const pal = m.scorers?.list.find((p) => p.name === "Cole Palmer"); return f ? { a: f.a, h: f.h, palmer: pal?.pGoal, v: MEDUSA.v } : null; });
  check("เมดูซ่า: injured scorer cuts his team's expected goals before line-ups", inj && inj.a < 0.95 && inj.h > 0.97 && inj.palmer < 0.05 && inj.v >= 2, JSON.stringify(inj));
  const coh = await A.evaluate(() => getDay(S.date).matches.concat(Object.values(S.days).flatMap((d) => d.matches || [])).filter((m) => m.sum?.call).map((m) => { const r = resOf(m.sum), c = m.sum.call; const okR = r === "h" ? c.h > c.a : r === "a" ? c.a > c.h : c.h === c.a; const okO = (m.sum.over25 >= 0.5) === (c.h + c.a >= 3); const b = bestCall(m); let okP = true; if (b) { const [h, a] = b.score.split("-").map(Number); okP = b.type === "1x2" ? (b.side === "h" ? h > a : a > h) : ["win", "half"].includes(settlePick(b, h, a)); } return okR && okO && okP; }));
  check("เมดูซ่า 3: called score never contradicts result, over/under or the pick", coh.length > 0 && coh.every(Boolean), `${coh.filter(Boolean).length}/${coh.length}`);
  const daily = await A.evaluate(() => { const d = writeDaily(getDay(S.date)); return d ? d.summary + d.notes.map((n) => n.text).join(" ") : ""; });
  check("closed daily summary", daily.length > 30 && !/undefined|NaN/.test(daily), daily.slice(0, 80));
  await A.click("#btnBot"); await A.waitForTimeout(1200);
  const botText = await A.evaluate(() => document.querySelector("#botBody")?.innerText || "");
  check("optional AI version is kept beside the closed one", botText.includes("ฉบับ AI ค้นเว็บ") && botText.includes("สถานการณ์ล่าสุด"), botText.slice(0, 60).replace(/\s+/g, " "));
  await A.goBack(); await A.waitForTimeout(300);
  check("back button closes the sheet", !(await A.isVisible("#sheet")));

  // live: step to 1st half, re-render and open the live match
  await fetch(`${BASE}/step`); await A.evaluate(() => refresh(S.date, false)); await A.waitForTimeout(1200);
  await A.click('#view .pcard[data-open="9001"]'); await A.waitForTimeout(800);
  const live = await A.evaluate(() => document.querySelector("#liveBox")?.innerText || "");
  check("live box shows match stats and a live score prediction", live.includes("ยิงเข้ากรอบ") && live.includes("ทายสกอร์จบ"), live.slice(0, 80).replace(/\s+/g, " "));
  check("live model moves with the game (home dominating)", await A.evaluate(() => S.open.live.ph > S.open.sum.home));
  await A.goBack(); await A.waitForTimeout(300);
  const B = await device();
  await B.goto(BASE); await B.waitForTimeout(2500);
  check("second device sees the same picks", (await B.evaluate(() => Object.keys(Shared.picks[S.date] || {}).length)) >= 1);

  // second half 63': red card, injured scorer substituted, injury delay
  for (let i = 0; i < 2; i++) await fetch(`${BASE}/step`);
  await A.evaluate(() => { for (const k in deepAt) delete deepAt[k]; return refresh(S.date, false); }); await A.waitForTimeout(2000);
  const lc = await A.evaluate(() => document.querySelector("#view .livecard")?.innerText || "");
  check("home shows a live analysis card with events", lc.includes("ทายจบ") && lc.includes("ใบแดง") && lc.includes("Trossard"), lc.replace(/\s+/g, " ").slice(0, 120));
  const lv = await A.evaluate(() => { const m = getDay(S.date).matches.find((x) => x.id === "9001"); return { notes: m.live.notes.join(" | "), f: m.live.final, s: [m.h.score, m.a.score], ph: m.live.ph, pa: m.live.pa, pd: m.live.pd, more: m.live.pMore }; });
  check("live model uses red card, substitution of a scorer and injuries", /ใบแดง.*Caicedo/.test(lv.notes) && /Saka/.test(lv.notes) && /Enzo/.test(lv.notes), lv.notes);
  const r = lv.ph >= lv.pa && lv.ph >= lv.pd ? "h" : lv.pa >= lv.pd ? "a" : "d";
  check("live final score agrees with live result and goal expectation", (r === "h" ? lv.f.h > lv.f.a : r === "a" ? lv.f.a > lv.f.h : lv.f.h === lv.f.a) && ((lv.more >= 0.5) === (lv.f.h + lv.f.a > lv.s[0] + lv.s[1])) && lv.f.h >= lv.s[0] && lv.f.a >= lv.s[1], JSON.stringify(lv.f));
  await fetch(`${BASE}/step`);
  await A.evaluate(() => refresh(S.date, false)); await A.waitForTimeout(1500);
  const card = await A.evaluate(() => document.querySelector('[data-open="9001"]')?.innerText || "");
  check("full-time score shown", card.includes("2") && card.includes("1"));
  const badges = await A.evaluate(() => document.querySelector('#view [data-open="9001"] .vbs')?.innerText || "");
  check("finished match shows right/wrong for winner and over/under", /ผล|ทาย/.test(badges) && /สูง|ต่ำ/.test(badges), badges.replace(/\s+/g, " "));
  await B.evaluate(() => syncPull(S.date)); await B.waitForTimeout(300);
  check("pick settled and visible on the other device", (await B.evaluate(() => Shared.pickHist.length)) >= 1);
  check("result stored for learning", (await B.evaluate(() => Shared.histN)) >= 1);
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close(); server.kill();
}
process.exit(failed ? 1 : 0);
