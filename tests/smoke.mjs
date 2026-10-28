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

  await A.click('.mcard[data-open="9001"]'); await A.waitForTimeout(1500);
  check("match sheet opens", await A.isVisible("#sheet"));
  const factors = await A.evaluate(() => S.open.factors.map((f) => f.k));
  check("model factors applied", ["h2h", "pace", "venue", "rest", "lineup"].every((k) => factors.includes(k)), factors.join(","));
  for (const t of ["market", "stats", "luck", "overview"]) { await A.click(`[data-set="sheetTab:${t}"]`); await A.waitForTimeout(150); }
  check("sheet tabs switch without errors", errors.length === 0);
  await A.goBack(); await A.waitForTimeout(300);
  check("back button closes the sheet", !(await A.isVisible("#sheet")));

  const B = await device();
  await B.goto(BASE); await B.waitForTimeout(2500);
  check("second device sees the same picks", (await B.evaluate(() => Object.keys(Shared.picks[S.date] || {}).length)) >= 1);

  for (let i = 0; i < 4; i++) await fetch(`${BASE}/step`);
  await A.evaluate(() => refresh(S.date, false)); await A.waitForTimeout(1500);
  const card = await A.evaluate(() => document.querySelector('[data-open="9001"]')?.innerText || "");
  check("full-time score shown", card.includes("2") && card.includes("1"));
  await B.evaluate(() => syncPull(S.date)); await B.waitForTimeout(300);
  check("pick settled and visible on the other device", (await B.evaluate(() => Shared.pickHist.length)) >= 1);
  check("result stored for learning", (await B.evaluate(() => Shared.histN)) >= 1);
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close(); server.kill();
}
process.exit(failed ? 1 : 0);
