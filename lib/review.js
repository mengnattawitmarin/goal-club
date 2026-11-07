// เมดูซ่า 3.2: rule-based reason why a pre-match call missed, from what happened on the pitch.
const pct = (x) => `${Math.round(x * 100)}%`;
export function ruleReview(g, p, f = {}) {
  const pd = Math.max(0, 1 - p.ph - p.pa), probs = [p.ph, pd, p.pa], call = probs.indexOf(Math.max(...probs));
  const act = g.hs > g.as ? 0 : g.hs === g.as ? 1 : 2, name = ["เจ้าบ้านชนะ", "เสมอ", "ทีมเยือนชนะ"];
  const side = (i) => (i === 0 ? g.hn : i === 2 ? g.an : "เสมอ");
  const sot = f.sotH != null && f.sotA != null ? `ยิงเข้ากรอบ ${f.sotH}–${f.sotA}` : null;
  const predTot = (p.lh0 || 0) + (p.la0 || 0), tot = g.hs + g.as;
  let kind, reason;
  const red = (f.reds || [])[0];
  if (red && (red.side === "h" ? call === 0 : call === 2)) { kind = "red"; reason = `${red.side === "h" ? g.hn : g.an} โดนใบแดง${red.min ? `นาที ${red.min}` : ""} เกมเปลี่ยนทันที`; }
  else if (sot && call !== 1 && (call === 0 ? f.sotH > f.sotA : f.sotA > f.sotH)) { kind = "luck"; reason = `${side(call)} คุมเกมตามที่คาด (${sot}) แต่จบสกอร์ไม่คม`; }
  else if (sot && act !== 1 && (act === 0 ? f.sotH >= f.sotA + 3 : f.sotA >= f.sotH + 3)) { kind = "under"; reason = `${side(act)} เหนือกว่าจริงในสนาม (${sot}) โมเดลประเมินต่ำไป`; }
  else if (predTot && tot >= predTot + 2.5) { kind = "open"; reason = `เกมเปิดกว่าที่คาดมาก จบ ${tot} ประตู ขณะที่คาดไว้ราว ${predTot.toFixed(1)}`; }
  else { kind = "close"; reason = `เกมสูสี ${sot ? `(${sot}) ` : ""}ผลพลิกได้ทุกทาง`; }
  return { id: g.id, d: g.d, lg: g.lg, match: `${g.hn} ${g.hs}–${g.as} ${g.an}`, pred: `${name[call]} ${pct(probs[call])}`, kind, reason, text: reason, surprise: 1 - probs[act] };
}
