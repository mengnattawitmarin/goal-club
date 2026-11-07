// เมดูซ่า 3.2: let an AI rewrite the closed-system preview in a seasoned analyst's voice,
// then check it never adds a number, a player name or betting talk that the facts do not contain.
export const ANALYST = `คุณคือนักวิเคราะห์ฟุตบอลระดับตำนานของแอป Goal Club เขียนภาษาไทยทั้งหมด
งาน: เรียบเรียง "ข้อเท็จจริง" ที่ให้มาใหม่ให้อ่านเหมือนนักวิเคราะห์ตัวจริง
- เปิดด้วยประเด็นที่น่าสนใจที่สุดของคู่นี้ เล่าเป็นเรื่อง มีเหตุและผล ไม่เรียงข้อมูลแห้ง ๆ
- อธิบายเส้นทางเกม (ถ้าได้ก่อน/เสียก่อนจะเป็นอย่างไร) จากตัวเลขที่ให้มา
- มีประโยคฟันธงเด็ด ๆ 1 ประโยคในหัวข้อทัศนะ แต่ห้ามอ้างว่าชัวร์หรือแม่นที่สุด
- ถ้าข้อมูลน้อยหรือระบบเคยพลาดกับคู่แบบนี้ ให้พูดตรง ๆ
กติกาเหล็ก:
- ใช้เฉพาะตัวเลข ชื่อทีม ชื่อนักเตะ และข้อเท็จจริงที่อยู่ในข้อความที่ให้มา ห้ามเพิ่มตัวเลขหรือชื่อใหม่ ห้ามแต่งข่าว
- ห้ามชวนเดิมพัน ห้ามใช้คำว่า แทง ลงเงิน ทุ่ม หมดหน้าตัก ชัวร์ การันตี
- คงหัวข้อแบบ ## ตามข้อเท็จจริงเดิม ใช้ - สำหรับรายการ ห้ามตารางหรือตัวหนา
- บรรทัดสุดท้าย: ใช้ประกอบการดูบอล ไม่ใช่คำแนะนำให้เดิมพัน`;

const BANNED = /(แทง|ลงเงิน|ทุ่มสุดตัว|ทุ่ม(?!เท)|หมดหน้าตัก|ชัวร์|การันตี|รับประกันผล|เดิมพันเลย|รวยแน่)/;
const DISCLAIMER = "ไม่ใช่คำแนะนำให้เดิมพัน";

const nums = (s) => new Set((String(s).match(/\d+(?:[.,]\d+)?/g) || []).map((x) => x.replace(",", ".").replace(/\.0+$/, "")));
/* Latin-script names (teams, players): any capitalised word must also appear in the facts */
const names = (s) => new Set((String(s).match(/\b[A-ZÀ-Þ][A-Za-zÀ-ÿ'’.-]{2,}/g) || []).map((x) => x.toLowerCase().replace(/[.’']+$/, "")));

export function checkGrounded(facts, text) {
  const t = String(text || "").trim();
  const problems = [];
  if (t.length < 200) problems.push("สั้นเกินไป");
  if (!t.includes("## ")) problems.push("ไม่มีหัวข้อ");
  if (BANNED.test(t)) problems.push(`มีคำชวนเดิมพัน (${t.match(BANNED)[0]})`);
  const fn = nums(facts), extraN = [...nums(t)].filter((n) => !fn.has(n) && !(Number(n) <= 10 && Number.isInteger(Number(n))));
  if (extraN.length) problems.push(`ตัวเลขที่ไม่มีในข้อมูล: ${extraN.slice(0, 5).join(", ")}`);
  const fl = String(facts).toLowerCase(), extraW = [...names(t)].filter((w) => !fl.includes(w));
  if (extraW.length) problems.push(`ชื่อที่ไม่มีในข้อมูล: ${extraW.slice(0, 5).join(", ")}`);
  const out = t.includes(DISCLAIMER) ? t : `${t}\n\nใช้ประกอบการดูบอล ไม่ใช่คำแนะนำให้เดิมพัน`;
  return { ok: problems.length === 0, problems, text: out };
}

export function hashText(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
