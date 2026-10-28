// Builds the single-page app from src/ into public/index.html (and dist/artifact.html for claude.ai).
// Usage: node scripts/build.mjs        (also run by Vercel before each deploy)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const head = read("src/head.html");
const logic = read("src/logic.js");
const ui = read("src/ui.js");
const snapshot = read("data/snapshot.json").replaceAll("</", "<\\/");

if (!logic.includes("/*__SNAPSHOT__*/null")) throw new Error("src/logic.js must keep the /*__SNAPSHOT__*/null placeholder");
const script = (logic + ui).replace("/*__SNAPSHOT__*/null", snapshot);
try { new Function(script); } catch (e) { console.error("JavaScript syntax error in src/logic.js or src/ui.js:\n" + e.message); process.exit(1); }

const body = head + "<script>" + script + "</script>\n";

// claude.ai artifact version: the host adds <html>/<head>; keep the viewport-fit marker
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/artifact.html"), body);

// website version: full document with PWA tags
const site = `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0c0b09">
<meta name="description" content="ความน่าจะเป็นคู่ฟุตบอลวันนี้ จากตารางคะแนน ฟอร์ม และผลที่เคยเจอกัน เทียบราคาตลาด">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Goal Club">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
${body.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")}
</body></html>
`;
writeFileSync(join(root, "public/index.html"), site);
console.log(`built public/index.html (${(site.length / 1024).toFixed(0)} KB) and dist/artifact.html`);
