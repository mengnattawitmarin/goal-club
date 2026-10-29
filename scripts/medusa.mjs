// เมดูซ่า: list / archive / restore versions of the analysis algorithm. See MEDUSA.md.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, arg] = process.argv.slice(2);
const current = () => Number(readFileSync(join(root, "src/logic.js"), "utf8").match(/const MEDUSA=\{v:(\d+)/)?.[1]);
const versions = () => existsSync(join(root, "models")) ? readdirSync(join(root, "models")).map((d) => Number(d.match(/^medusa-(\d+)$/)?.[1])).filter(Boolean).sort((a, b) => a - b) : [];
if (cmd === "list") {
  console.log(`ตอนนี้ใช้: เมดูซ่า ${current()}`);
  for (const v of versions()) console.log(`  เก็บไว้: เมดูซ่า ${v}  (models/medusa-${v}/)`);
} else if (cmd === "archive") {
  const v = current(); const dir = join(root, "models", `medusa-${v}`); mkdirSync(dir, { recursive: true });
  for (const f of ["logic.js", "ui.js"]) copyFileSync(join(root, "src", f), join(dir, f));
  console.log(`สำรองเมดูซ่า ${v} ไว้ที่ models/medusa-${v}/`);
} else if (cmd === "restore" && arg) {
  const dir = join(root, "models", `medusa-${Number(arg)}`);
  if (!existsSync(dir)) { console.error(`ไม่พบ models/medusa-${arg}/`); process.exit(1); }
  for (const f of ["logic.js", "ui.js"]) writeFileSync(join(root, "src", f), readFileSync(join(dir, f)));
  execFileSync(process.execPath, [join(root, "scripts/build.mjs")], { stdio: "inherit" });
  console.log(`เรียกเมดูซ่า ${arg} กลับมาแล้ว ตรวจด้วย npm test ก่อน push`);
} else {
  console.log("ใช้: node scripts/medusa.mjs list | archive | restore <เลขเวอร์ชัน>");
}
