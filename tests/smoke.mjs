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
  const coh = await A.evaluate(() => getDay(S.date).matches.concat(Object.values(S.days).flatMap((d) => d.matches || [])).filter((m) => m.sum?.call).map((m) => { const r = resCall(m.sum), c = m.sum.call; const okR = r === "h" ? c.h > c.a : r === "a" ? c.a > c.h : r === "hd" ? c.h >= c.a : r === "ad" ? c.a >= c.h : c.h === c.a; const bc0 = bestCall(m); const sameAsPick = !bc0 || bc0.score === `${c.h}-${c.a}`; const okO = (m.sum.over25 >= 0.5) === (c.h + c.a >= 3); const b = bestCall(m); let okP = true; if (b) { const [h, a] = b.score.split("-").map(Number); okP = b.type === "1x2" ? (b.side === "h" ? h > a : a > h) : ["win", "half"].includes(settlePick(b, h, a)); } return sameAsPick && okP && (okR && okO || !!bc0); }));
  check("เมดูซ่า 3.3: one called score per match (same as the pick), agreeing with result and over/under when there is no pick", coh.length > 0 && coh.every(Boolean), `${coh.filter(Boolean).length}/${coh.length}`);
  check("เมดูซ่า 3.2: bot explains the game path (score first / concede first)", closed.includes("เส้นทางเกม") && /ได้ประตูก่อน: โอกาสชนะ \d+%/.test(closed));
  check("copy-to-AI button present", await A.evaluate(() => !!document.querySelector('[data-act="copyai"]') && aiPrompt(S.open).includes("ไม่ใช่คำแนะนำให้เดิมพัน")));
  const rot = await A.evaluate(() => { S.rotation = { arsenal: { team: "Arsenal", signal: "rotation", reason: "โค้ชเตรียมพักตัวหลัก", d: new Date().toISOString().slice(0, 10) } }; const m = refine({ ...S.open.raw }); S.rotation = {}; const f = m.factors.find((x) => x.k === "rotation"); return f ? { h: f.h, a: f.a } : null; });
  check("rotation news lowers the resting side's expected goals", rot && rot.h < 0.95 && rot.a > 1, JSON.stringify(rot));
  const dc4 = await A.evaluate(() => {
    const raw = S.open.raw, keep = [S.backtest, S.dc];
    S.dc = { leagues: { "eng.1": { mu: 1.4, home: 1.25, rho: -0.06 } }, teams: { 359: { att: 1.4, def: 0.8, n: 30, lg: "eng.1" }, 363: { att: 1.1, def: 1, n: 30, lg: "eng.1" } }, rows: 9000 };
    S.backtest = { pass: false }; const off = refine({ ...raw });
    S.backtest = { pass: true }; const on = refine({ ...raw }); const neu = refine({ ...raw, neutral: true });
    [S.backtest, S.dc] = keep;
    const p = devig([1.5, 4.2, 6.5]), prop = [1 / 1.5, 1 / 4.2, 1 / 6.5], s = prop.reduce((a, b) => a + b);
    return { off: off.basis, on: on.basis, noPace: !on.factors.some((f) => ["pace", "h2h", "venue", "rating", "calib"].includes(f.k)), base: on.factors[0].label, neutralLower: neu.lh0 < on.lh0, fav: p[0] > prop[0] / s, sum: p.reduce((a, b) => a + b) };
  });
  check("เมดูซ่า 4.0: core used only after the backtest passes, replaces the old layers", dc4.off !== "dc" && dc4.on === "dc" && dc4.noPace && dc4.base.includes("4.0"), JSON.stringify(dc4));
  check("4.0: neutral ground and power margin removal (favourite not under-rated)", dc4.neutralLower && dc4.fav && Math.abs(dc4.sum - 1) < 1e-9);
  const daily = await A.evaluate(() => { const d = writeDaily(getDay(S.date)); return d ? d.summary + d.notes.map((n) => n.text).join(" ") : ""; });
  check("closed daily summary", daily.length > 30 && !/undefined|NaN/.test(daily), daily.slice(0, 80));
  check("Google AI and Google news links for the match", await A.evaluate(() => { const a = [...document.querySelectorAll("#botBody ~ .row a")].map((x) => x.href); return a.some((h) => h.includes("google.com/search?udm=50")) && a.some((h) => h.includes("tbm=nws")) && !document.querySelector("#btnBot"); }));
  await A.goBack(); await A.waitForTimeout(300);
  check("back button closes the sheet", !(await A.isVisible("#sheet")));

  // live: step to 1st half, re-render and open the live match
  // a real pick on the match that is about to start (the server checks it with ESPN)
  await A.evaluate(() => fetch("/api/store", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: S.date, picks: [{ id: "9001", lg: "eng.1", type: "ou", side: "o", line: 2.5, prob: 0.6, label: "สูง 2.5", score: "2-1", ko: new Date(Date.now() + 60e3).toISOString(), match: "Arsenal – Chelsea" }] }) }));
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
  // เมดูซ่า 3.1: the shared store does not trust clients
  const post = (body) => fetch(`${BASE}/api/store`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.9" }, body: JSON.stringify(body) }).then((r) => r.status);
  const today = await A.evaluate(() => S.date);
  const g0 = await (await fetch(`${BASE}/api/store?date=${today}`)).json();
  await post({ date: today, preds: [{ id: "9002", lg: "eng.1", lh0: 1.4, la0: 1.1, ph: 0.45, pa: 0.3, ko: new Date(Date.now() + 5 * 3600e3).toISOString() }] });
  await post({ date: today, results: [{ id: "9002", hs: 9, as: 0 }] });
  await post({ date: today, picks: [{ id: "777777", lg: "eng.1", type: "ou", side: "o", line: 2.5, prob: 0.9, label: "fake", ko: new Date(Date.now() + 3600e3).toISOString() }, { id: "9002", type: "ah", side: "h", line: -0.5, prob: 0.9, label: "no league", ko: new Date(Date.now() + 3600e3).toISOString() }] });
  const g1 = await (await fetch(`${BASE}/api/store?date=${today}`)).json();
  check("fake score for an unfinished match is ignored", g1.histN === g0.histN, `${g0.histN} -> ${g1.histN}`);
  check("fake picks (unknown match, no league) are rejected", !g1.picks["777777"] && !g1.picks["9002"]?.label?.includes("no league"));
  check("finished match learned with ESPN's score", g1.audit && (g1.health?.guard === true));
  let last = 200; for (let i = 0; i < 45; i++) last = await post({ date: today });
  check("rate limit stops a flood of writes", last === 429, String(last));
  check("every pick has enough data and is not worse than the market", await A.evaluate(() => picksFor(S.date).list.every((p) => (p.dq ?? 100) >= 45 && (p.edge == null || p.edge >= -0.01 || p.m?.st !== "pre"))));
  check("data quality on every match", await A.evaluate(() => getDay(S.date).matches.every((m) => m.dq && m.dq.q >= 0 && m.dq.q <= 100 && m.dq.label)));
  await A.evaluate(() => { S.tab = "more"; render(); }); await A.waitForTimeout(300);
  const more = await A.evaluate(() => document.querySelector("#view")?.innerText || "");
  check("system status shows feed, learning job, backup and protection", ["สถานะระบบ", "ฟีด ESPN", "งานเรียนรู้ประจำวัน", "สำรองข้อมูล", "การป้องกันข้อมูลปลอม", "AI หลังบ้าน", "แหล่งข่าว"].every((k) => more.includes(k)), more.match(/สถานะระบบ[\s\S]{0,160}/)?.[0]?.replace(/\s+/g, " "));
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close(); server.kill();
}
process.exit(failed ? 1 : 0);
