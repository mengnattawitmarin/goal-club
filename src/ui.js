/* =====================================================================
   UI — helpers, components, views, match sheet, events, boot
   ===================================================================== */
Object.assign(S, {
  status: "all",          // โปรแกรม filter: all | in | pre | post
  mode: "picks",          // วิเคราะห์ mode: picks | edge | goals
  edgeKind: "all",        // all | ah | ou | 1x2
  sheetTab: "overview",   // overview | market | stats
  calc: {},
  _: 0
});

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const lg = m => LEAGUE_NAME[m.lg] || m.lg;
const isFav = m => S.favs[m.h.id] || S.favs[m.a.id];
const isGoal = m => S.goals[m.id] && Date.now()-S.goals[m.id] < 120e3;
const liveCls = m => (m.st==="in" ? " is-live" : "") + (isGoal(m) ? " goal" : "");
function hue(str){ let h=0; for(const c of String(str)) h=(h*31+c.charCodeAt(0))>>>0; return h%360; }
function logoUrl(u, px){
  if(!u) return null;
  const m=String(u).match(/^https:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?]+)/);
  return m ? `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${px}&h=${px}` : u;
}
function badge(t, size=""){
  const px = size==="lg" ? 120 : 56;
  const ini=(t.short||t.name).replace(/[^A-Za-zก-๙0-9 ]/g,"").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"?";
  const src=S.logos?logoUrl(t.logo,px):null;
  return `<span class="badge ${size}" style="background:hsl(${hue(t.name)} 42% 68%)" aria-hidden="true">${esc(ini)}${src?`<img class="logo" src="${esc(src)}" alt="" loading="lazy" decoding="async">`:""}</span>`;
}
/* a logo that cannot load (offline, blocked) removes itself and the initials show through */
document.addEventListener("error",e=>{ const t=e.target; if(t?.classList?.contains("logo")){ t.remove(); S.logoFails=(S.logoFails||0)+1; if(S.logoFails>6) S.logos=false; } },true);
const formPills = f => f ? `<span class="pills" aria-label="ฟอร์ม ${esc(f)}">${f.toUpperCase().replace(/[^WDL]/g,"").slice(-5).split("").map(c=>`<span class="pill ${c}">${c}</span>`).join("")}</span>` : `<span class="faint" style="font-size:12px">ยังไม่มีฟอร์ม</span>`;
const starSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
const starBtn = m => `<button class="star ${isFav(m)?"on":""}" data-fav="${m.id}" aria-label="${isFav(m)?"เอาออกจากทีมโปรด":"เพิ่มทีมโปรด"}">${starSvg}</button>`;
function stateTag(m){
  if(m.st==="in") return `<span class="tag live"><span class="dot live pulse"></span>สด ${esc(m.clock||"")}</span>`;
  if(m.st==="post") return `<span class="tag">จบแล้ว</span>`;
  if(m.st==="pp") return `<span class="tag warn">เลื่อน/ยกเลิก</span>`;
  if(m.st==="unk") return `<span class="tag">สกอร์ ณ เวลาบันทึก</span>`;
  return `<span class="num" style="color:var(--fg);font-weight:600">${kickTime(m.ko)}</span>`;
}
const timeCell = m => m.st==="in" ? esc(m.clock||"สด") : m.st==="post" ? "จบ" : m.st==="pp" ? "เลื่อน" : m.st==="unk" ? "ค้าง" : kickTime(m.ko);
function hdpText(m){
  if(m.mk?.spread) return `<span>แฮนดิแคป <b>${esc(ahPhrase(m.h.short,m.a.short,m.mk.spread.line))}</b></span>`;
  const t=m.sum.top[0]; return `<span>ยังไม่มีราคา · โมเดลทาย <b class="num">${t.h}-${t.a}</b></span>`;
}
function h2hText(m){
  if(!m.ds) return "";
  if(!m.meets.length) return `<span>ยังไม่เคยเจอกัน</span>`;
  const avg=m.meets.reduce((s,x)=>s+x.f+x.a,0)/m.meets.length;
  const w=m.meets.filter(x=>x.f>x.a).length, d=m.meets.filter(x=>x.f===x.a).length, l=m.meets.length-w-d;
  return `<span>พบกัน ${m.meets.length} นัด <b class="num">${w}-${d}-${l}</b> · เฉลี่ย <b class="num">${avg.toFixed(1)}</b> ประตู</span>`;
}
const valueRow = m => { if(m.st!=="pre") return null; const b=bestEdge(m); return b && b.edge>=VALUE_EDGE ? b : null; };
function toast(msg){ const el=$("#toast"); el.textContent=msg; el.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>el.hidden=true,3200); }
function filtered(day){
  let ms=day.matches;
  if(S.q){ const q=S.q.toLowerCase(); ms=ms.filter(m=>(m.h.name+" "+m.a.name+" "+m.h.short+" "+m.a.short).toLowerCase().includes(q)); }
  if(S.league) ms=ms.filter(m=>m.lg===S.league);
  return ms;
}
function sec(title, sub, act){ return `<div class="sec"><h2>${title}</h2>${sub?`<span class="sub">${sub}</span>`:""}${act||""}</div>`; }

/* ---------- components ---------- */
function matchCard(m){
  const v=valueRow(m);
  return `<div class="mcard${liveCls(m)}" role="button" tabindex="0" data-open="${m.id}">
    <div class="mhead"><span class="lg">${esc(lg(m))}</span>${isGoal(m)?`<span class="tag value">ประตู!</span>`:""}${stateTag(m)}${starBtn(m)}</div>
    <div class="teams">
      <div class="team">${badge(m.h)}<span class="nm">${esc(m.h.short)}</span>${m.h.rank?`<span class="rk">#${m.h.rank}</span>`:""}</div>
      ${m.st==="pre"?formPills(m.h.form):`<span class="score num">${m.h.score??"–"}</span>`}
      <div class="team">${badge(m.a)}<span class="nm">${esc(m.a.short)}</span>${m.a.rank?`<span class="rk">#${m.a.rank}</span>`:""}</div>
      ${m.st==="pre"?formPills(m.a.form):`<span class="score num">${m.a.score??"–"}</span>`}
    </div>
    <div class="probbar" aria-hidden="true"><i class="h" style="width:${m.sum.home*100}%"></i><i class="d" style="width:${m.sum.draw*100}%"></i><i class="a" style="width:${m.sum.away*100}%"></i></div>
    <div class="problabels num"><span>เจ้าบ้าน <b>${pct(m.sum.home)}</b></span><span>เสมอ <b>${pct(m.sum.draw)}</b></span><span>เยือน <b>${pct(m.sum.away)}</b></span></div>
    <div class="mfoot">${hdpText(m)}<span>สูง 2.5 <b class="num">${pct(m.sum.over25)}</b></span>${h2hText(m)}${v?`<span class="tag value">มีค่า ${esc(v.label)} ${pts(v.edge)}</span>`:""}</div>
  </div>`;
}
function matchRow(m, lead){
  const right = m.st==="pre"
    ? `<div class="num muted">${pct(m.sum.home)}</div><div class="num muted">${pct(m.sum.away)}</div>`
    : `<div class="num"><b>${m.h.score??"–"}</b></div><div class="num"><b>${m.a.score??"–"}</b></div>`;
  const v=valueRow(m);
  return `<button class="mrow${liveCls(m)}" data-open="${m.id}"${lead?` data-day="${lead.date}"`:""}>
    <span class="t num">${lead?`${esc(lead.label)}<br>`:""}${timeCell(m)}</span>
    <span class="tm">${badge(m.h,"sm")}<span>${esc(m.h.short)}</span></span>
    <span class="r" style="grid-row:span 2">${right}</span>
    <span class="tm">${badge(m.a,"sm")}<span>${esc(m.a.short)}</span></span>
    <span class="meta">${m.mk?.spread?`<span><b>${esc(ahPhrase(m.h.short,m.a.short,m.mk.spread.line))}</b></span>`:`<span>ทาย ${m.sum.top[0].h}-${m.sum.top[0].a}</span>`}<span>สูง 2.5 ${pct(m.sum.over25)}</span>${v?`<span class="tag value">มีค่า ${pts(v.edge)}</span>`:""}${isGoal(m)?`<span class="tag value">ประตู!</span>`:""}</span>
  </button>`;
}
function skeleton(n=3){
  return `<div class="stack" aria-busy="true">${Array.from({length:n},()=>`<div class="card skel"><div class="sk w40"></div><div class="sk w70"></div><div class="sk w60"></div><div class="sk bar"></div></div>`).join("")}<p class="faint" style="text-align:center;font-size:13px;margin:0">กำลังโหลดโปรแกรมของ${relLabel(S.date)}…</p></div>`;
}
function emptyDay(){
  if(S.loading===S.date || (S.liveOk===null && getDay(S.date).source==="none")) return skeleton();
  const ds=[...new Set([...Object.keys(SNAPSHOT||{}),...Object.keys(S.days).filter(d=>S.days[d].matches.length)])].sort();
  const next=ds.find(d=>d>S.date), sat=nextSaturday(S.date);
  return `<div class="card empty"><h3>${relLabel(S.date)}ไม่มีคู่ในลีกที่ติดตาม</h3>
    <p>${getDay(S.date).source==="none"&&!S.liveOk?"ข้อมูลชุดที่บันทึกไว้ไม่มีโปรแกรมของวันนี้":"ฟีดยังไม่มีโปรแกรมของวันนี้"}</p>
    <div class="row" style="justify-content:center">${next?`<button class="btn" data-date="${next}">ไปวันถัดไป · ${dayLabel(next)}</button>`:""}${sat!==next?`<button class="btn ghost" data-date="${sat}">เสาร์นี้ · ${dayLabel(sat)}</button>`:""}</div></div>`;
}
function leagueSelect(day){
  const counts={}; day.matches.forEach(m=>counts[m.lg]=(counts[m.lg]||0)+1);
  return `<select class="select ${S.league?"on":""}" id="leagueSel" aria-label="เลือกลีก"><option value="">ทุกลีก</option>${LEAGUES.filter(([s])=>counts[s]).map(([s,n])=>`<option value="${s}" ${S.league===s?"selected":""}>${n} (${counts[s]})</option>`).join("")}</select>`;
}
function seg(key, opts, cur){
  return `<div class="seg" role="tablist">${opts.map(([v,l,n])=>`<button role="tab" aria-selected="${cur===v}" class="${cur===v?"on":""}" data-set="${key}:${v}">${l}${n!=null?`<span class="n num">${n}</span>`:""}</button>`).join("")}</div>`;
}
const TYPE_LABEL={ah:"แฮนดิแคป",ou:"สูงต่ำ","1x2":"ผลชนะ"};
function pickStatus(p){
  const m=p.m; if(!m||m.st==="pre") return "";
  if(m.h.score==null) return "";
  const r=settlePick(p,m.h.score,m.a.score);
  if(m.st==="in") return `<span class="tag live">${m.h.score}–${m.a.score} · ${r==="win"||r==="half"?"กำลังเข้า":r==="push"?"เสมอเส้น":"ยังไม่เข้า"}</span>`;
  if(m.st==="unk") return `<span class="tag">${m.h.score}–${m.a.score}</span>`;
  return `<span class="tag ${r==="win"||r==="half"?"value":r==="push"?"":"warn"}">${m.h.score}–${m.a.score} · ${RES_LABEL[r]}</span>`;
}
function pickRows(picks){
  return picks.map((p,i)=>`<button class="pick${p.m?.st==="in"?" is-live":""}" data-open="${p.id}">
    <span class="rank num">${i+1}</span>
    <span class="ph">${esc(p.label)} <span class="ptype">${TYPE_LABEL[p.type]||""}</span></span>
    <span class="pp num"><b class="gold">${pct(p.prob)}</b><div class="meter"><i style="width:${Math.round(p.prob*100)}%"></i></div></span>
    <span class="sub">${p.m?`<span class="num">${timeCell(p.m)}</span> · ${esc(p.m.h.short)} – ${esc(p.m.a.short)} · ${esc(lg(p.m))}`:""} · ทาย <span class="num">${p.score}</span></span>
    <span class="pst">${pickStatus(p)}</span>
  </button>`).join("");
}
function recordPill(){
  const r=pickRecord(14); if(!r.n) return "";
  return `<span class="tag gold num">ย้อนหลัง 14 วัน เข้า ${r.won}/${r.n} (${Math.round(r.won/r.n*100)}%)${r.push?` · คืนทุน ${r.push}`:""}</span>`;
}
function picksHero(day){
  const P=picksFor(S.date);
  const head=`<div class="ph-head"><svg width="22" height="18" viewBox="0 0 26 22" aria-hidden="true"><path d="M2 18 L4 6 L9 11 L13 3 L17 11 L22 6 L24 18 Z" fill="#f0cc86"/></svg><h2>ฟันธงคู่เด็ด${relLabel(S.date)==="วันนี้"?"วันนี้":relLabel(S.date)}</h2></div>`;
  if(!P.list.length) return `<section class="card gold picks-hero">${head}<p class="muted" style="margin:8px 0 0">${day.matches.some(m=>m.st==="pre")?"ยังไม่มีคู่ที่โมเดลให้เกิน 55%":"ทุกคู่เริ่มเตะแล้ว ฟันธงจะคัดจากคู่ที่ยังไม่เตะเท่านั้น"}</p>${recordPill()?`<div style="margin-top:10px">${recordPill()}</div>`:""}</section>`;
  return `<section class="card gold picks-hero">${head}
    <p class="ph-sub">คัด ${P.list.length} คู่ที่โมเดลให้เปอร์เซ็นต์สูงสุดจาก ${P.total} คู่ · วันบอลเยอะสูงสุด 10 คู่</p>
    ${recordPill()?`<div style="margin:8px 0 2px">${recordPill()}</div>`:""}
    <div class="list" style="margin-top:12px">${pickRows(P.list)}</div>
    <p class="note">เลือกเส้นที่แรงที่สุดของแต่ละคู่ (แฮนดิแคป สูงต่ำ หรือผลชนะ) % คือโอกาสได้ผลเมื่อไม่นับคืนทุน คู่ที่เริ่มเตะแล้วจะล็อกไว้ไม่เปลี่ยน · ไม่ใช่คำแนะนำให้เดิมพัน</p>
  </section>`;
}
function briefCard(day){
  const b=store.get("brief:"+S.date,null);
  const hosted=!window.claude;
  return `<div class="card gold brief">
    <div class="row"><h3>บทวิเคราะห์วันนี้</h3><span class="spacer"></span>${b?`<span class="faint" style="font-size:12px">เขียนเมื่อ ${stampTime(b.at)}</span>`:""}</div>
    ${b?`<p>${esc(b.summary)}</p>${b.notes?.length?`<ul>${b.notes.map(n=>`<li><b>${esc(n.match)}</b> — ${esc(n.text)}</li>`).join("")}</ul>`:""}`
       :`<p class="muted">ให้ Claude อ่านตัวเลขโมเดลกับราคาของ ${day.matches.length} คู่${hosted?" พร้อมหัวข่าวของวันนี้":""} แล้วสรุปเป็นภาษาไทย ผลจะจำไว้ใช้ทั้งวัน</p>`}
    ${b?.players?.length?`<div style="margin-top:10px"><b style="font-size:13px" class="gold">นักเตะในข่าว</b><ul>${b.players.map(p=>`<li><b>${esc(p.name)}</b>${p.club?` (${esc(p.club)})`:""} — ${esc(p.detail)}</li>`).join("")}</ul></div>`:""}
    ${b?.headlines?.length?`<details><summary>ข่าวที่ใช้ ${b.headlines.length} ชิ้น</summary><ul style="font-size:13px">${b.headlines.map(h=>`<li><span class="faint">${esc(h.source)}</span> ${h.url?`<a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a>`:esc(h.title)}</li>`).join("")}</ul></details>`:""}
    ${S.briefErr?`<p style="color:var(--loss);font-size:13px">${esc(S.briefErr)}</p>`:""}
    <div class="row" style="margin-top:14px"><button class="btn" id="btnBrief" ${S.briefBusy||!day.matches.length?"disabled":""}>${S.briefBusy?"กำลังวิเคราะห์…":b?"วิเคราะห์อีกรอบ":"วิเคราะห์วันนี้"}</button></div>
    <p class="note">${hosted?"อ่านหัวข่าว BBC Sport, The Guardian และ ESPN ก่อนสรุป":"สรุปจากสถิติและราคาในหน้านี้ ยังไม่ได้อ่านข่าว"} · ไม่ใช่คำแนะนำให้เดิมพัน</p>
  </div>`;
}

/* ---------- views ---------- */
function viewHome(){
  const day=getDay(S.date);
  if(!day.matches.length) return emptyDay();
  const ms=filtered(day);
  const live=ms.filter(m=>m.st==="in"), upcoming=ms.filter(m=>m.st==="pre"), done=ms.filter(m=>m.st==="post");
  const values=ms.filter(valueRow).length, favs=ms.filter(isFav);
  return `${picksHero(day)}
  <div class="tiles" style="margin-top:12px">
    <button class="tile" data-goto="schedule:all"><span class="k">คู่ทั้งหมด</span><span class="v num">${ms.length}</span></button>
    <button class="tile live" data-goto="schedule:in"><span class="k">กำลังแข่ง</span><span class="v num">${live.length}</span></button>
    <button class="tile value" data-goto="analyze:edge"><span class="k">มีค่าตามโมเดล</span><span class="v num">${values}</span></button>
  </div>
  ${live.length?sec(`<span class="dot live pulse" style="vertical-align:4px;margin-right:8px"></span>กำลังแข่ง`,`อัปเดตทุกนาที`)+`<div class="stack">${live.map(matchCard).join("")}</div>`:""}
  ${sec("บทวิเคราะห์")}${briefCard(day)}
  ${favs.length?sec("ทีมโปรดวันนี้")+`<div class="list">${favs.map(m=>matchRow(m)).join("")}</div>`:""}
  ${upcoming.length?sec("ถัดไป",`เวลาไทย`,`<button class="act" data-goto="schedule:pre">ดูโปรแกรมทั้งหมด</button>`)+`<div class="stack">${upcoming.slice(0,4).map(matchCard).join("")}</div>`:""}
  ${done.length?sec("ผลล่าสุด",`จบแล้ว ${done.length} คู่`,`<button class="act" data-goto="schedule:post">ดูผลทั้งหมด</button>`)+`<div class="list">${done.slice(-5).reverse().map(m=>matchRow(m)).join("")}</div>`:""}`;
}
function viewSchedule(){
  const day=getDay(S.date);
  if(!day.matches.length) return emptyDay();
  const base=filtered(day);
  const cnt=k=>base.filter(m=>k==="all"||m.st===k).length;
  const ms=base.filter(m=>S.status==="all"||m.st===S.status);
  const groups={}; ms.forEach(m=>(groups[m.lg]=groups[m.lg]||[]).push(m));
  const keys=Object.keys(groups).sort((a,b)=>(LEAGUE_ORDER[a]??99)-(LEAGUE_ORDER[b]??99));
  return `<div class="toolbar">${seg("status",[["all","ทั้งหมด",cnt("all")],["in","สด",cnt("in")],["pre","ยังไม่เตะ",cnt("pre")],["post","จบแล้ว",cnt("post")]],S.status)}${leagueSelect(day)}</div>
  ${keys.length?`<div class="stack">${keys.map(k=>`<div class="list"><div class="lhead"><span>${esc(LEAGUE_NAME[k]||k)}</span><span class="n num">${groups[k].length} คู่</span></div>${groups[k].map(m=>matchRow(m)).join("")}</div>`).join("")}</div>`
    :`<div class="card empty"><p>ไม่มีคู่ในหมวดนี้</p></div>`}
  <p class="note">เวลาไทย · วันแข่งตัดรอบราว 11:00 น. ตามฟีด ESPN · ตัวเลขด้านขวาคือโอกาสชนะของเจ้าบ้านและทีมเยือน</p>`;
}
function viewAnalyze(){
  const day=getDay(S.date);
  if(!day.matches.length) return emptyDay();
  const ms=filtered(day);
  let body="";
  if(S.mode==="picks"){
    const P=picksFor(S.date), R=pickRecord(30);
    body = `<p class="pagelead">หนึ่งเส้นที่แรงที่สุดต่อคู่ คัดตามเปอร์เซ็นต์สูงสุดของวัน สูงสุด 10 คู่ ล็อกไว้เมื่อเริ่มเตะ</p>`
      + (P.list.length?`<div class="list">${pickRows(P.list)}</div>`:`<div class="card empty"><p>ยังไม่มีคู่ที่โมเดลให้เกิน 55%</p></div>`)
      + sec("ผลงานย้อนหลัง", R.n?`30 วัน เข้า ${R.won}/${R.n} · ${Math.round(R.won/R.n*100)}%`:"")
      + (R.list.length?`<div class="list">${R.list.slice(0,30).map(x=>`<div class="lrow"><span class="main"><div>${esc(x.label)} <span class="ptype">${TYPE_LABEL[x.type]||""}</span></div><div class="sub">${relLabel(x.d)} · ${esc(x.match)} · โมเดล ${pct(x.prob)}</div></span><span class="r"><span class="tag ${x.res==="win"||x.res==="half"?"value":x.res==="push"?"":"warn"}">${RES_LABEL[x.res]}</span></span></div>`).join("")}</div>`
        :`<div class="card muted">ยังไม่มีผล ระบบจะเก็บผลฟันธงทุกคู่หลังจบเกมไว้ในเครื่องนี้ เปิดแอปก่อนเตะเพื่อให้ฟันธงถูกบันทึก</div>`)
      + `<p class="note">ใช้อ่านประกอบการดูบอล ไม่ใช่คำแนะนำให้เดิมพัน</p>`;
  } else if(S.mode==="edge"){
    const rows=[]; ms.filter(m=>m.st==="pre").forEach(m=>edgeRows(m).forEach(r=>{ if((S.edgeKind==="all"||r.kind===S.edgeKind)&&r.edge!=null) rows.push({m,r}); }));
    rows.sort((a,b)=>b.r.edge-a.r.edge);
    body = `<div style="margin-bottom:12px">${seg("edgeKind",[["all","ทุกตลาด"],["ah","แฮนดิแคป"],["ou","สูงต่ำ"],["1x2","ผลการแข่งขัน"]],S.edgeKind)}</div>`
      + (rows.length?`<div class="list">${rows.slice(0,60).map(({m,r})=>`<button class="lrow${liveCls(m)}" data-open="${m.id}">
          <span class="main"><div>${esc(r.label)}</div><div class="sub">${timeCell(m)} · ${esc(m.h.short)} – ${esc(m.a.short)}${m.st!=="pre"?` · ${m.h.score??0}–${m.a.score??0}`:""} · ราคา ${fmtPrice(r.dec,S.style)}</div></span>
          <span class="r num"><div>โมเดล <b>${pct(r.model)}</b> · ตลาด ${pct(r.fair)}</div><span class="tag ${r.edge>=VALUE_EDGE?"value":""}">${pts(r.edge)} จุด</span></span></button>`).join("")}</div>`
        :`<div class="card empty"><p>ยังไม่มีราคาของคู่ที่ยังไม่เตะในหมวดนี้</p></div>`)
      + `<p class="note">เฉพาะคู่ที่ยังไม่เตะ · ตลาดหักน้ำแบบสัดส่วนแล้ว · "มีค่า" คือโมเดลสูงกว่าตลาดอย่างน้อย 4 จุด ไม่ใช่คำแนะนำให้เดิมพัน</p>`;
  } else {
    const list=[...ms].sort((a,b)=>(b.lh+b.la)-(a.lh+a.la));
    body = `<p class="pagelead">เรียงจากคู่ที่โมเดลคาดว่าจะมีประตูมากไปน้อย พร้อมสกอร์ที่มีโอกาสสูงสุด 3 อันดับ</p>
      <div class="list">${list.map(m=>`<button class="lrow${liveCls(m)}" data-open="${m.id}">
        <span class="main"><div>${esc(m.h.short)} – ${esc(m.a.short)}${m.st!=="pre"?` <b class="num">${m.h.score??0}–${m.a.score??0}</b>`:""}</div><div class="sub num">${timeCell(m)} · คาด ${(m.lh+m.la).toFixed(2)} ประตู · สูง 2.5 ${pct(m.sum.over25)}</div></span>
        <span class="r num">${m.sum.top.slice(0,3).map(c=>`${c.h}-${c.a} <span class="faint">${pct(c.p)}</span>`).join("<br>")}</span></button>`).join("")}</div>`;
  }
  return `<div style="margin-bottom:12px">${seg("mode",[["picks","ฟันธง"],["edge","เทียบราคา"],["goals","สกอร์และประตู"]],S.mode)}</div>${body}`;
}
function viewSaved(){
  const ids=Object.keys(S.favs);
  if(!ids.length) return `<h1 class="pagetitle">ทีมโปรด</h1><div class="card empty"><h3>ยังไม่มีทีมโปรด</h3><p>แตะรูปดาวบนการ์ดคู่แข่ง ทีมทั้งสองฝั่งจะถูกเก็บไว้ในเครื่องนี้</p><button class="btn ghost" data-goto="schedule:all">ไปที่โปรแกรม</button></div>`;
  const dates=[...new Set([...Object.keys(SNAPSHOT||{}),...Object.keys(S.days)])].sort();
  const all=[]; dates.forEach(d=>getDay(d).matches.forEach(m=>{ if(isFav(m)) all.push({d,m}); }));
  const live=all.filter(x=>x.m.st==="in"), next=all.filter(x=>x.m.st==="pre"), past=all.filter(x=>x.m.st==="post").reverse().slice(0,8);
  const rows=list=>`<div class="list">${list.map(({d,m})=>matchRow(m,{date:d,label:relLabel(d)})).join("")}</div>`;
  return `<h1 class="pagetitle">ทีมโปรด</h1><p class="pagelead">เก็บไว้ในเครื่องนี้ แตะชื่อทีมเพื่อเอาออก</p>
    <div class="row" style="margin-bottom:8px">${ids.map(id=>`<button class="tag gold" style="height:30px;font-size:13px" data-unfav="${id}">${esc(S.favs[id])} ✕</button>`).join("")}</div>
    ${live.length?sec("กำลังแข่ง")+rows(live):""}
    ${sec("โปรแกรมถัดไป")}${next.length?rows(next):`<div class="card muted">ยังไม่มีโปรแกรมของทีมโปรดในข้อมูลที่โหลดไว้</div>`}
    ${past.length?sec("ผลล่าสุด")+rows(past):""}`;
}
function viewMore(){
  const day=getDay(S.date);
  const ex=day.matches.find(m=>m.mk?.spread&&m.steps.length>1)||day.matches[0];
  return `<h1 class="pagetitle">เพิ่มเติม</h1><p class="pagelead">ตั้งค่า ข้อมูล และคู่มือการอ่านตัวเลข</p>
  ${sec("การแสดงผล")}
  <div class="group"><div class="gitem"><div class="lbl">รูปแบบราคา</div>${seg("style",Object.entries(PRICE_STYLES),S.style)}
    <p class="note">ราคา 1.85 แสดงเป็น ทศนิยม ${fmtPrice(1.85,"decimal")} · มาเลย์ ${fmtPrice(1.85,"malay")} · ฮ่องกง ${fmtPrice(1.85,"hongkong")}</p></div></div>
  ${sec("ข้อมูล")}
  <div class="group">
    <div class="gitem"><div class="lbl">สถานะ</div><div class="desc row" style="gap:6px">${statusText()}</div>
      <p class="note">${S.liveOk?"ใช้ฟีดสด อัปเดตเองทุกนาทีระหว่างแข่ง และทุก 10 นาทีเมื่อไม่มีคู่เตะ":"หน้านี้ต่อฟีดสดไม่ได้ จึงใช้ชุดที่บันทึกไว้ เปิดที่ goal-club.vercel.app เพื่อดูสด"}</p></div>
    <div class="gitem"><div class="lbl">ข้อมูลร่วมทุกเครื่อง</div><div class="desc">${Shared.on?`<span class="green">เปิดอยู่</span> · ฟันธง ผลงานย้อนหลัง บทวิเคราะห์ และสิ่งที่โมเดลเรียนรู้ ใช้ชุดเดียวกันทุกเครื่อง · สะสมผลแล้ว ${Shared.histN} นัด`:window.claude?"ใช้ได้ในเว็บที่ติดตั้ง":"ยังไม่ได้ต่อฐานข้อมูล ข้อมูลเก็บแยกในแต่ละเครื่อง (ตั้งได้ที่ Vercel → Storage → Upstash Redis)"}</div></div>
    <div class="gitem row"><button class="btn ghost small" data-act="refresh">ดึงข้อมูลใหม่</button><button class="btn ghost small" data-act="clear">ล้างข้อมูลในเครื่อง</button></div>
    <div class="gitem"><div class="lbl">แหล่งข้อมูล</div><div class="desc">โปรแกรม สกอร์ ตารางคะแนน และราคา DraftKings จาก ESPN · หัวข่าวจาก BBC Sport, The Guardian และ ESPN · ราคาเป็นของตลาดต่างประเทศ ไม่ใช่ราคาเว็บไทย</div></div>
  </div>
  ${sec("คู่มือ")}
  <div class="group">
    <details class="acc"><summary>วิธีอ่านความน่าจะเป็น</summary><div class="body stack" style="gap:8px">
      <div><b class="gold">ชนะ เสมอ แพ้</b> รวมกันได้ 100% เช่น เจ้าบ้าน 55% หมายถึงถ้าเล่นแบบนี้ 100 ครั้ง โมเดลคาดว่าชนะราว 55 ครั้ง</div>
      <div><b class="gold">ครอบเส้น</b> คือโอกาสได้ผลเมื่อไม่นับกรณีคืนทุน เส้นครึ่งลูก เช่น 0/0.5 แบ่งเงินเป็นสองเส้น</div>
      <div><b class="gold">ตลาด</b> คือราคาที่หักน้ำแล้ว เทียบตรงกับโมเดลได้ ส่วนต่างบวกคือโมเดลมองสูงกว่าตลาด</div>
      <div class="faint" style="font-size:13px">ไม่มีโมเดลไหนแม่นทุกนัด ตัวเลขเป็นค่าประมาณจากสถิติที่มี</div></div></details>
    ${ex?`<details class="acc"><summary>โมเดลทำงานอย่างไร</summary><div class="body"><p class="muted" style="margin:0 0 10px;font-size:13px">ตัวอย่างจริง ${esc(ex.h.short)} – ${esc(ex.a.short)}</p><ol class="steps">
      ${ex.steps.map(s=>`<li>${esc(s.text)} → λ เจ้าบ้าน <b class="num">${s.lh.toFixed(2)}</b> เยือน <b class="num">${s.la.toFixed(2)}</b></li>`).join("")}
      <li>ทำตารางสกอร์ปัวซง 0–10 ประตู ปรับสกอร์ต่ำด้วยดิกสัน-โคลส์ (rho −0.08) → ชนะ <b class="num">${pct(ex.sum.home)}</b> เสมอ <b class="num">${pct(ex.sum.draw)}</b> แพ้ <b class="num">${pct(ex.sum.away)}</b></li>
      <li>ช่องที่สูงสุดคือ <b class="num">${ex.sum.top[0].h}-${ex.sum.top[0].a}</b> (${pct(ex.sum.top[0].p)}) · สูง 2.5 <b class="num">${pct(ex.sum.over25)}</b></li>
      ${ex.mk?.spread?`<li>เส้นตลาด ${esc(ahPhrase(ex.h.short,ex.a.short,ex.mk.spread.line))} โมเดลให้ ${esc(ex.h.short)} ครอบ <b class="num">${pct(cover(hdpSplit(ex.g,ex.mk.spread.line)))}</b></li>`:""}
    </ol></div></details>`:""}
    <details class="acc"><summary>รูปแบบราคาต่างกันอย่างไร</summary><div class="body stack" style="gap:6px">
      <div><b class="gold">ทศนิยม</b> ราคารวมทุน เช่น 1.90 แทง 100 ได้คืน 190</div>
      <div><b class="gold">ฮ่องกง</b> ราคาไม่รวมทุน เช่น 0.90 แทง 100 ได้กำไร 90</div>
      <div><b class="gold">มาเลย์</b> ค่าบวกเหมือนฮ่องกง ค่าลบหมายถึงต้องวางเท่านั้นเพื่อได้ 1 หน่วย เช่น -0.80</div></div></details>
    <details class="acc"><summary>ติดตั้งเป็นแอปบนมือถือ</summary><div class="body stack" style="gap:6px">
      <div><b class="gold">iPhone</b> เปิดใน Safari → ปุ่มแชร์ → เพิ่มไปยังหน้าจอโฮม</div>
      <div><b class="gold">Android</b> เปิดใน Chrome → เมนู ⋮ → เพิ่มลงในหน้าจอหลัก</div></div></details>
  </div>
  <p class="note" style="text-align:center;margin:28px 0 0">Goal Club ไม่ใช่เว็บพนัน ตัวเลขทั้งหมดใช้ประกอบการดูบอลเท่านั้น</p>`;
}

/* ---------- match sheet ---------- */
function midHtml(m){ return `${m.st==="pre"?kickTime(m.ko):`${m.h.score??"–"}–${m.a.score??"–"}`}<small>${m.st==="pre"?"เวลาไทย":m.st==="in"?`สด ${esc(m.clock||"")}`:m.st==="pp"?"เลื่อน/ยกเลิก":"จบแล้ว"}</small>`; }
/* ---------- belief layer: Thai ทักษา + Chinese zodiac (shown beside the numbers, never inside them) ---------- */
const TAKSA_SEQ=[1,2,3,4,7,5,8,6]; // อาทิตย์ จันทร์ อังคาร พุธ เสาร์ พฤหัส ราหู ศุกร์
const TAKSA_ROLE=["บริวาร","อายุ","เดช","ศรี","มูละ","อุตสาหะ","มนตรี","กาลกิณี"];
const TAKSA_SCORE={"เดช":1,"ศรี":1,"มนตรี":1,"กาลกิณี":-1};
const THAI_DAY=["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
const ANIMALS=["ชวด (หนู)","ฉลู (วัว)","ขาล (เสือ)","เถาะ (กระต่าย)","มะโรง (มังกร)","มะเส็ง (งู)","มะเมีย (ม้า)","มะแม (แพะ)","วอก (ลิง)","ระกา (ไก่)","จอ (สุนัข)","กุน (หมู)"];
const SIX_HARMONY={0:1,1:0,2:11,11:2,3:10,10:3,4:9,9:4,5:8,8:5,6:7,7:6};
function taksa(birthIso, matchIso){
  const b=TAKSA_SEQ.indexOf(weekday(birthIso)+1), t=TAKSA_SEQ.indexOf(weekday(matchIso)+1);
  const role=TAKSA_ROLE[(t-b+8)%8]; return {role, score:TAKSA_SCORE[role]||0};
}
function yearBranch(iso){ const [y,mo,d]=iso.split("-").map(Number); const yy=(mo<2||(mo===2&&d<4))?y-1:y; return ((yy-4)%12+12)%12; }
function dayBranch(iso){ const [y,m,d]=iso.split("-").map(Number); const n=Math.round((Date.UTC(y,m-1,d)-Date.UTC(1949,9,1))/864e5); return ((n%12)+12)%12; } // 1 ต.ค. 1949 = วันชวด (甲子)
function zodiacRel(b,d){
  if((b-d+12)%12===6) return {rel:"ชง ปะทะกับวัน",score:-1};
  if(SIX_HARMONY[b]===d) return {rel:"คู่มิตรกับวัน",score:1};
  if(b!==d&&b%4===d%4) return {rel:"สามประสานกับวัน",score:1};
  if(b===d) return {rel:"ปีเดียวกับวัน",score:.5};
  return {rel:"เป็นกลาง",score:0};
}
function personLuck(dob, matchIso){
  if(!dob||!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const t=taksa(dob,matchIso), yb=yearBranch(dob), z=zodiacRel(yb,dayBranch(matchIso));
  return {bornDay:THAI_DAY[weekday(dob)], taksa:t.role, animal:ANIMALS[yb], zodiac:z.rel, score:(t.score+z.score)/2};
}
function teamLuck(m){
  const ext=S.ext[m.id]; if(!ext?.people) return null;
  const day=bkkDateOf(m.ko); const out={h:[],a:[]};
  ext.people.players.forEach(p=>{ const l=personLuck(p.dob,day); out[p.side].push({name:p.name,role:"นักเตะ",dob:p.dob,luck:l}); });
  ["h","a"].forEach(s=>{ const c=ext.people.coaches[s]; if(c) out[s].unshift({name:c.name,role:"ผู้จัดการทีม",dob:c.dob,luck:personLuck(c.dob,day)}); });
  const avg=list=>{ const v=list.filter(x=>x.luck).map(x=>x.luck.score); return v.length?v.reduce((a,b)=>a+b,0)/v.length:null; };
  return {...out, hs:avg(out.h), as:avg(out.a)};
}

/* ---------- written analysis (built from the numbers, no invented facts) ---------- */
function formWord(f){ const p=formPPG(f); if(p==null) return null; return p>=2.2?"ฟอร์มร้อนแรง":p>=1.6?"ฟอร์มกำลังมา":p>=1?"ฟอร์มกลาง ๆ":"ฟอร์มสะดุด"; }
function sideStyle(s){
  if(!s||s.n<3) return "";
  const bits=[];
  if(s.gf/s.n>=2) bits.push("เกมรุกคมกริบ ยิงเฉลี่ยเกิน 2 ลูก"); else if(s.blank>=2) bits.push(`ปลายทางยังฝืด ยิงไม่ได้ ${s.blank} จาก ${s.n} นัด`);
  if(s.clean>=2) bits.push(`เกมรับเหนียว คลีนชีต ${s.clean} นัด`); else if(s.ga/s.n>=2) bits.push("แนวรับรั่วเสียเฉลี่ย 2 ลูกขึ้นไป");
  return bits.join(" และ");
}
function leanOf(m){
  const ph=m.sum.home, pa=m.sum.away, fav=ph>=pa?m.h.short:m.a.short, d=Math.abs(ph-pa);
  if(d>=.30) return {title:`${fav} เต็งหนึ่งชัด`,tone:"strong",fav};
  if(d>=.15) return {title:`${fav} ภาษีดีกว่า`,tone:"lean",fav};
  if(m.sum.draw>=.28) return {title:"สูสี ลุ้นเสมอสูง",tone:"even",fav:null};
  return {title:`สูสี ${fav} เหนือกว่าเล็กน้อย`,tone:"even",fav};
}
function analysisParas(m){
  const P=[], L=leanOf(m), hp=pct(m.sum.home), ap=pct(m.sum.away), dp=pct(m.sum.draw);
  const when = m.st==="pre" ? `เตะ ${kickTime(m.ko)} น.` : m.st==="in" ? `ขณะนี้กำลังแข่ง สกอร์ ${m.h.score}–${m.a.score}` : `จบเกมที่ ${m.h.score}–${m.a.score}`;
  P.push({h:"ภาพรวม", t:`${m.h.name} เปิดบ้านรับ ${m.a.name} ศึก${lg(m)} ${when} ${m.h.rank&&m.a.rank?`อันดับตารางตอนนี้ ${m.h.rank} ปะทะ ${m.a.rank} `:""}โมเดลให้เจ้าบ้านชนะ ${hp} เสมอ ${dp} ทีมเยือนชนะ ${ap} ภาพรวมจึงเป็นเกมที่ "${L.title}"`});
  const fh=formWord(m.h.form), fa=formWord(m.a.form);
  const hsS=sideStyle(m.hs), asS=sideStyle(m.as);
  if(fh||fa||hsS||asS){
    P.push({h:"ฟอร์มและสไตล์", t:[
      fh?`${m.h.short} ${fh} (${m.h.form})${m.hs?` 5 นัดหลังยิง ${m.hs.gf} เสีย ${m.hs.ga}`:""}${hsS?` ${hsS}`:""}`:"",
      fa?`ฝั่ง ${m.a.short} ${fa} (${m.a.form})${m.as?` ยิง ${m.as.gf} เสีย ${m.as.ga}`:""}${asS?` ${asS}`:""}`:""
    ].filter(Boolean).join(" ส่วน")});
  }
  if(m.meets.length){
    const w=m.meets.filter(x=>x.f>x.a).length, d=m.meets.filter(x=>x.f===x.a).length, l=m.meets.length-w-d;
    const avg=m.meets.reduce((s,x)=>s+x.f+x.a,0)/m.meets.length;
    P.push({h:"สถิติพบกัน", t:`${m.meets.length} นัดหลังสุด ${m.h.short} ชนะ ${w} เสมอ ${d} แพ้ ${l} เฉลี่ย ${avg.toFixed(1)} ประตูต่อนัด${avg>=3?" เจอกันทีไรยิงกันมันส์":avg<=2?" มักเป็นเกมปิดไม่ค่อยมีประตู":""}${m.meets.length>=3?" ผลส่วนนี้ถูกผสมเข้าโมเดลแล้ว":""}`});
  }
  const extra=(m.factors||[]).filter(f=>["venue","rest","lineup","weather","news","newsOld","trend","calib"].includes(f.k));
  if(extra.length) P.push({h:"ปัจจัยหน้างาน", list:extra.map(f=>`${f.label}: ${f.text}`)});
  const tot=m.lh+m.la, top=m.sum.top;
  P.push({h:"เกมรุกและประตู", t:`โมเดลคาด ${m.h.short} ยิง ${m.lh.toFixed(2)} ลูก ${m.a.short} ยิง ${m.la.toFixed(2)} ลูก รวม ${tot.toFixed(2)} ${tot>=3?"มีลุ้นเกมเปิดหน้าแลกกัน":tot<=2.2?"น่าจะเป็นเกมแน่นกลางสนาม ประตูไม่มาก":"จำนวนประตูน่าจะอยู่ระดับกลาง"} โอกาสสูง 2.5 ${pct(m.sum.over25)} ทั้งสองทีมยิงได้ ${pct(m.sum.btts)} สกอร์ที่โมเดลให้น้ำหนักที่สุดคือ ${top.slice(0,3).map(c=>`${c.h}-${c.a}`).join(", ")}`});
  if(m.mk?.spread){
    const s=hdpSplit(m.g,m.mk.spread.line), hc=cover(s);
    const side=hc>=.5?`${m.h.short} ${signed(m.mk.spread.line)}`:`${m.a.short} ${signed(-m.mk.spread.line)}`;
    const v=valueRow(m);
    P.push({h:"มุมราคา", t:`ตลาด ${m.mk.book} เปิด ${ahPhrase(m.h.short,m.a.short,m.mk.spread.line)} โมเดลเอียงฝั่ง ${side} ครอบเส้น ${pct(Math.max(hc,1-hc))}${m.mk.total?` เส้นสูงต่ำ ${ballLabel(m.mk.total.line)} โมเดลให้สูง ${pct(cover(totSplit(m.g,m.mk.total.line).over))}`:""}${v?` จุดที่โมเดลมองสูงกว่าตลาดชัดสุดคือ ${v.label} (${pts(v.edge)} จุด)`:" ราคาตลาดใกล้เคียงกับโมเดล ยังไม่เห็นจุดต่างชัด"}`});
  }
  P.push({h:"สรุป", t:`${L.title} ทายสกอร์ ${top[0].h}-${top[0].a} เอน${m.sum.over25>=.5?"สูง":"ต่ำ"} 2.5 ${m.sum.btts>=.5?"และมีลุ้นทั้งสองทีมยิงได้":"และมีโอกาสที่บางฝั่งจะยิงไม่ได้"} ตัวเลขทั้งหมดเป็นค่าประมาณจากสถิติ ใช้ประกอบการดูบอล ไม่ใช่คำแนะนำให้เดิมพัน`});
  return P;
}
function factorRows(m){
  const pctChg=r=>{ const v=Math.round((r-1)*100); return v===0?`<span class="faint">0%</span>`:`<span class="${v>0?"green":"lossc"}">${v>0?"+":""}${v}%</span>`; };
  const used=(m.factors||[]).map(f=>`<div class="frow"><div class="fl"><div class="fn">${esc(f.label)}</div><div class="ft">${esc(f.text)}</div></div>
    ${f.base?`<div class="fe faint">ฐาน</div>`:`<div class="fe num"><div>${esc(m.h.short)} ${pctChg(f.h)}</div><div>${esc(m.a.short)} ${pctChg(f.a)}</div></div>`}</div>`).join("");
  const have=new Set((m.factors||[]).map(f=>f.k));
  const missing=[];
  if(!have.has("h2h")) missing.push(["ผลที่เคยเจอกัน", m.ds?"เคยเจอกันไม่ถึง 3 นัด":"ยังไม่ได้ดึงสถิติเชิงลึก"]);
  if(!have.has("venue")) missing.push(["ฟอร์มในบ้าน/นอกบ้าน","ฟีดยังไม่ระบุสนามของ 5 นัดหลัง"]);
  if(!have.has("rest")) missing.push(["วันพักและความล้า","ยังไม่มีวันที่ของนัดก่อนหน้า"]);
  if(!have.has("lineup")) missing.push(["ตัวจริงที่ประกาศ","มักประกาศราว 1 ชั่วโมงก่อนเตะ"]);
  if(!have.has("weather")) missing.push(["สภาพอากาศและสนาม", window.claude?"ดูได้ในเว็บที่ติดตั้ง":"มีเฉพาะคู่ใน 14 วันข้างหน้าที่รู้เมืองของสนาม"]);
  if(!have.has("news")) missing.push(["ข่าววันนี้","กดวิเคราะห์วันนี้ที่หน้าหลักเพื่ออ่านข่าว"]);
  if(!have.has("trend")) missing.push(["แนวโน้มลีก 14 วัน", window.claude?"ดูได้ในเว็บที่ติดตั้ง":"ต้องมีผลในลีกอย่างน้อย 8 นัดและค่าเฉลี่ยทั้งฤดูกาล"]);
  if(!have.has("calib")){ const c=S.calib?.[m.lg]; missing.push(["เรียนรู้จากผลที่ผ่านมา",`สะสมผลเทียบคำทำนายในลีกนี้แล้ว ${c?.n||0} นัด ต้องครบ 10 นัด`]); }
  missing.push(["เสียงเชียร์และโซเชียลมีเดีย","ไม่มีฟีดสาธารณะที่วัดได้จริง จึงไม่เอามาคำนวณ"]);
  return `<div class="list">${used}${missing.map(([a,b])=>`<div class="frow off"><div class="fl"><div class="fn">${a}</div><div class="ft">${b}</div></div><div class="fe faint">ไม่ได้ใช้</div></div>`).join("")}</div>`;
}
function sheetOverview(m){
  const L=leanOf(m), conf=Math.max(m.sum.home,m.sum.away);
  const ai=store.get("ana:"+m.id,null);
  const luck=teamLuck(m);
  return `<div class="verdict">
      <div class="vk">${m.st==="pre"?"มุมมองก่อนเกม":m.st==="in"?"มุมมองก่อนเกม · กำลังแข่ง":"มุมมองก่อนเกม · จบแล้ว"}</div>
      <div class="vt">${esc(L.title)}</div>
      <div class="vm"><div class="meter wide"><i style="width:${Math.round(conf*100)}%"></i></div><span class="num">${pct(conf)}</span></div>
      <div class="vchips">
        <span><em>แฮนดิแคป</em>${m.mk?.spread?esc(ahPhrase(m.h.short,m.a.short,m.mk.spread.line)):"ยังไม่มีราคา"}</span>
        <span><em>ทายสกอร์</em><b class="num">${m.sum.top[0].h}-${m.sum.top[0].a}</b></span>
        <span><em>สูง 2.5</em><b class="num">${pct(m.sum.over25)}</b></span>
        <span><em>ยิงทั้งคู่</em><b class="num">${pct(m.sum.btts)}</b></span>
      </div>
      <div class="scorechips">${m.sum.top.map((c,i)=>`<span class="${i===0?"top":""}"><b class="num">${c.h}-${c.a}</b><small class="num">${pct(c.p)}</small></span>`).join("")}</div>
    </div>
    ${sec("บทวิเคราะห์")}
    <div class="card article">${analysisParas(m).map(p=>`<h4>${esc(p.h)}</h4>${p.list?`<ul>${p.list.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:`<p>${esc(p.t)}</p>`}`).join("")}
      ${ai?`<h4>Claude วิเคราะห์เพิ่ม <span class="faint" style="font-weight:400;font-size:12px">${stampTime(ai.at)}</span></h4>${ai.paras.map(t=>`<p>${esc(t)}</p>`).join("")}`:""}
      ${S.anaErr?`<p style="color:var(--loss);font-size:13px">${esc(S.anaErr)}</p>`:""}
      <div class="row" style="margin-top:12px"><button class="btn small ghost" id="btnAna" ${S.anaBusy?"disabled":""}>${S.anaBusy?"กำลังเขียน…":ai?"ให้ Claude เขียนใหม่":"ให้ Claude เขียนบทวิเคราะห์เต็ม"}</button></div>
    </div>
    ${sec("ปัจจัยที่ใช้คำนวณ","ผลต่อประตูที่คาดของแต่ละทีม")}
    ${factorRows(m)}
    <p class="note">ดวงและโหราศาสตร์อยู่ในแท็บดวง แสดงคู่กับตัวเลข แต่ไม่ผสมใน % เพราะยังไม่มีหลักฐานว่าช่วยทายผลได้${luck&&(luck.hs!=null||luck.as!=null)?` · วันนี้ดวงหนุน ${luck.hs!=null&&luck.as!=null?(Math.abs(luck.hs-luck.as)<.1?"ใกล้เคียงกัน":(luck.hs>luck.as?m.h.short:m.a.short)):"ข้อมูลไม่ครบ"}`:""}</p>`;
}
function sheetBelief(m){
  const L=teamLuck(m);
  const bar=v=>v==null?`<span class="faint">ไม่มีวันเกิด</span>`:`<span class="lbar"><i style="left:50%;width:${Math.abs(v)*50}%;${v<0?"transform:translateX(-100%);background:var(--loss)":""}"></i></span><b class="num ${v>0?"green":v<0?"lossc":""}">${v>0?"+":""}${v.toFixed(2)}</b>`;
  const people=(list)=>list.length?list.map(p=>`<div class="frow"><div class="fl"><div class="fn">${esc(p.name)} <span class="faint" style="font-weight:400">· ${p.role}</span></div>
      <div class="ft">${p.luck?`เกิดวัน${p.luck.bornDay} ${p.dob} · ทักษาวันแข่งเป็น <b>${p.luck.taksa}</b> · ปี${p.luck.animal} ${p.luck.zodiac}`:"ไม่พบวันเกิดในแหล่งข้อมูล"}</div></div>
      <div class="fe num">${p.luck?`<b class="${p.luck.score>0?"green":p.luck.score<0?"lossc":"faint"}">${p.luck.score>0?"+":""}${p.luck.score.toFixed(1)}</b>`:"–"}</div></div>`).join(""):`<div class="frow off"><div class="ft">ยังไม่มีรายชื่อ</div></div>`;
  return `<div style="height:16px"></div>${omen(m)}
    ${sec("ดวงของทีม","ทักษาไทย + นักษัตรจีน จากวันเกิด")}
    ${L?`<div class="card stack" style="gap:10px">
        <div class="row" style="flex-wrap:nowrap"><span style="min-width:0;flex:1;font-weight:600">${esc(m.h.short)}</span>${bar(L.hs)}</div>
        <div class="row" style="flex-wrap:nowrap"><span style="min-width:0;flex:1;font-weight:600">${esc(m.a.short)}</span>${bar(L.as)}</div></div>
      ${sec(esc(m.h.short))}<div class="list">${people(L.h)}</div>
      ${sec(esc(m.a.short))}<div class="list">${people(L.a)}</div>`
    :`<div class="card muted" id="luckLoading">${window.claude?"ดวงรายบุคคลต้องใช้วันเกิดจากฟีด ESPN และ Wikipedia ซึ่งเปิดได้ในเว็บที่ติดตั้ง":S.liveOk?"กำลังดึงวันเกิดนักเตะและโค้ช…":"ยังเชื่อมฟีดไม่ได้"}</div>`}
    <div class="card" style="margin-top:12px;font-size:13.5px">
      <b class="gold">อ่านค่าอย่างไร</b>
      <p style="margin:6px 0 0">ทักษา: วันแข่งตกเป็น <b>เดช ศรี มนตรี</b> ของคนนั้น +1 · <b>กาลกิณี</b> −1 · อื่น ๆ 0</p>
      <p style="margin:4px 0 0">นักษัตรจีน: ปีเกิดเป็น <b>คู่มิตร</b> หรือ <b>สามประสาน</b> กับวันแข่ง +1 · <b>ชง</b> −1</p>
      <p class="note">ค่าของแต่ละคนคือค่าเฉลี่ยของสองระบบ ค่าทีมคือค่าเฉลี่ยของโค้ชและนักเตะเด่น เป็นความเชื่อ ไม่เข้าโมเดลความน่าจะเป็น</p>
    </div>`;
}

function sheetMarket(m){
  const rows=edgeRows(m);
  return `${sec("เทียบตลาด", m.mk?esc(m.mk.book)+" · ไม่ใช่ราคาเว็บไทย":"")}
    ${rows.length?`<div class="card scroll-x"><table class="tbl num"><thead><tr><th>ตลาด</th><th>ราคา</th><th>โมเดล</th><th>ตลาด*</th><th>ต่าง</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${esc(r.label)}</td><td>${fmtPrice(r.dec,S.style)}</td><td>${pct(r.model)}</td><td>${r.fair!=null?pct(r.fair):"–"}</td><td>${r.edge!=null?`<span class="tag ${r.edge>=VALUE_EDGE?"value":""}">${pts(r.edge)}</span>`:"–"}</td></tr>`).join("")}
    </tbody></table><p class="note">*หักน้ำแบบสัดส่วน · แฮนดิแคปและสูงต่ำคิดแบบครอบเส้น (ไม่นับคืนทุน)${m.st!=="pre"?" · เป็นตัวเลขก่อนเตะ ไม่รวมสกอร์ระหว่างเกม":""}</p></div>`
    :`<div class="card muted">ฟีดยังไม่มีราคาของคู่นี้ ใส่ราคาเองด้านล่างได้</div>`}
    ${sec("ใส่ราคาเอง", PRICE_STYLES[S.style])}${calcBlock(m)}`;
}
function sheetStats(m){
  const ds=m.ds;
  const loading = !ds ? `<div class="card muted" id="dsLoading">${S.liveOk?"กำลังดึงสถิติเชิงลึก…":"ข้อมูลชุดนี้ยังไม่มีสถิติเชิงลึกของคู่นี้"}</div>` : "";
  return `${sec("ฟอร์ม 5 นัดหลัง")}
    <div class="card">
      <div class="row"><span style="font-weight:600">${esc(m.h.short)}</span><span class="spacer"></span>${formPills(m.h.form)}</div>
      ${ds?.hf?.lines?.length?`<div class="form-lines num">${ds.hf.lines.map(l=>`<span>${l}</span>`).join("")}</div>`:""}
      <div class="row" style="margin-top:12px"><span style="font-weight:600">${esc(m.a.short)}</span><span class="spacer"></span>${formPills(m.a.form)}</div>
      ${ds?.af?.lines?.length?`<div class="form-lines num">${ds.af.lines.map(l=>`<span>${l}</span>`).join("")}</div>`:""}
      ${ds&&(m.hs||m.as)?`<div style="margin-top:14px">${statRows(m)}</div>`:""}
    </div>
    ${loading}
    ${ds?`${sec("เคยเจอกัน",esc(ds.h2h||""))}
    <div class="card">${m.meets.length?`<div class="stack" style="gap:6px">${ds.meet.map(x=>`<div class="row num" style="font-size:13.5px;flex-wrap:nowrap"><span class="faint">${x[0]}</span><span class="spacer"></span><span style="text-align:right;min-width:0">${esc(x[5])} <b>${x[3]}–${x[4]}</b> ${esc(x[6])}</span></div>`).join("")}</div>
      <p class="note">เฉลี่ย ${(m.meets.reduce((s,x)=>s+x.f+x.a,0)/m.meets.length).toFixed(1)} ประตูต่อนัด · ${m.meets.length>=3?"ผสมเข้าโมเดล 18%":"น้อยกว่า 3 นัด ยังไม่ผสมเข้าโมเดล"}</p>`:`<span class="muted">ยังไม่เคยเจอกันในบันทึกของฟีด</span>`}</div>
    ${sec("สนามและทีมงาน")}
    <div class="card stack" style="gap:6px;font-size:14px">
      <div><span class="faint">สนาม</span> ${ds.venue?esc(ds.venue)+(ds.city?` · ${esc(ds.city)}`:""):"ยังไม่มีข้อมูล"}</div>
      <div><span class="faint">ผู้จัดการ ${esc(m.h.short)}</span> ${ds.hc?esc(ds.hc):"ยังไม่มีข้อมูล"}</div>
      <div><span class="faint">ผู้จัดการ ${esc(m.a.short)}</span> ${ds.ac?esc(ds.ac):"ยังไม่มีข้อมูล"}</div></div>
    ${ds.players?.length?sec("นักเตะเด่น","ตามที่ฟีดมี")+`<div class="list">${ds.players.map(p=>`<div class="lrow"><span class="main"><div>${esc(p.name)}</div><div class="sub">${esc(p.team)}</div></span><span class="r num">${p.goals!=null?`ยิง ${p.goals}`:""}${p.assists!=null?` · แอส ${p.assists}`:""}${p.apps!=null?`<div class="faint">${p.apps} นัด</div>`:""}</span></div>`).join("")}</div>`:""}
    ${ds.marks?.length?`<div class="card" style="margin-top:12px"><ul style="margin:0;padding-left:18px;font-size:13.5px">${ds.marks.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`:""}`:""}`;
}
function statRows(m){
  const r=(label,f)=>`<span>${label}</span><span class="num">${f(m.hs)}</span><span class="num">${f(m.as)}</span>`;
  const fr=(s,k)=>s?`${s[k]}/${s.n}`:"–";
  const meet=m.meets; const mm=meet.length?{n:meet.length,btts:meet.filter(x=>x.f>0&&x.a>0).length,over:meet.filter(x=>x.f+x.a>=3).length}:null;
  return `<div class="statgrid"><span class="h">5 นัดหลัง</span><span class="h">${esc(m.h.short)}</span><span class="h">${esc(m.a.short)}</span>
    ${r("ทั้งยิงทั้งเสีย",s=>fr(s,"btts"))}${r("สูง 2.5",s=>fr(s,"over"))}${r("คลีนชีต",s=>fr(s,"clean"))}${r("ยิงไม่ได้",s=>fr(s,"blank"))}${r("ยิง / เสีย",s=>s?`${s.gf} / ${s.ga}`:"–")}</div>
    ${mm?`<p class="note">นัดที่เคยเจอ ${mm.n} นัด: ทั้งยิงทั้งเสีย ${mm.btts} นัด · สูง 2.5 ${mm.over} นัด</p>`:""}`;
}
function omen(m){
  const d=bkkDateOf(m.ko), wd=weekday(d);
  const COL=[["แดง","#c8463a"],["เหลือง","#e3c24b"],["ชมพู","#e59ab4"],["เขียว","#4f9a5f"],["ส้ม","#e08a3c"],["ฟ้า","#5d9bd6"],["ม่วง","#8a64b8"]];
  const DAY=["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"], ELEM=["ไฟ","ดิน","ไฟ","น้ำ","ดิน","น้ำ","ดิน"];
  let n=d.replaceAll("-","").split("").map(Number).reduce((a,b)=>a+b,0); while(n>9) n=String(n).split("").map(Number).reduce((a,b)=>a+b,0);
  return `<div class="omen"><div class="row"><b style="font-family:var(--font-display);font-weight:500;font-size:16px" class="gold">ดวงและฮวงจุ้ยของวันแข่ง</b><span class="spacer"></span><span class="tag">ความเชื่อ ไม่เข้าโมเดล</span></div>
    <p style="margin:8px 0 0;font-size:14px">วัน${DAY[wd]}ตามเวลาไทย · ธาตุ${ELEM[wd]} · <span class="swatch" style="background:${COL[wd][1]}"></span>สีประจำวัน${COL[wd][0]} · เลขมงคล <b class="num">${n}</b></p>
    <p class="note">คำนวณจากวันแข่งตามตำราสีประจำวันแบบไทย ใช้อ่านเล่นเท่านั้น</p></div>`;
}
function calcBlock(m){
  const lines=[]; for(let x=-2.5;x<=2.5001;x+=0.25) lines.push(Math.round(x*100)/100);
  const c=S.calc[m.id]||{}; const def=c.line??m.mk?.spread?.line??0; const tdef=c.tline??m.mk?.total?.line??2.5;
  const tl=[1.5,1.75,2,2.25,2.5,2.75,3,3.25,3.5];
  const ph=S.style==="decimal"?["1.90","1.95"]:S.style==="hongkong"?["0.90","0.95"]:["0.90","-0.95"];
  return `<div class="card"><p class="note" style="margin:0 0 10px">ใส่ราคาจากที่คุณดูอยู่ โมเดลจะคิดโอกาสครอบเส้นและส่วนต่างให้</p>
    <div class="calc">
      <label class="f">เส้นเจ้าบ้าน<select id="cLine">${lines.map(l=>`<option value="${l}" ${Math.abs(l-def)<.01?"selected":""}>${signed(l)}</option>`).join("")}</select></label>
      <label class="f">ราคาเจ้าบ้าน<input id="cHome" inputmode="decimal" placeholder="${ph[0]}" value="${esc(c.home||"")}"></label>
      <label class="f">ราคาเยือน<input id="cAway" inputmode="decimal" placeholder="${ph[1]}" value="${esc(c.away||"")}"></label>
    </div><div class="out" id="cOut"></div>
    <div class="calc" style="margin-top:14px">
      <label class="f">เส้นสูงต่ำ<select id="tLine">${tl.map(l=>`<option value="${l}" ${Math.abs(l-tdef)<.01?"selected":""}>${ballLabel(l)}</option>`).join("")}</select></label>
      <label class="f">ราคาสูง<input id="tOver" inputmode="decimal" placeholder="${ph[0]}" value="${esc(c.over||"")}"></label>
      <label class="f">ราคาต่ำ<input id="tUnder" inputmode="decimal" placeholder="${ph[1]}" value="${esc(c.under||"")}"></label>
    </div><div class="out" id="tOut"></div></div>`;
}
function runCalc(){
  const m=S.open; if(!m||!$("#cLine")) return;
  S.calc[m.id]={line:parseFloat($("#cLine").value),home:$("#cHome").value,away:$("#cAway").value,tline:parseFloat($("#tLine").value),over:$("#tOver").value,under:$("#tUnder").value};
  const num=id=>{ const v=parseFloat(($("#"+id)?.value||"").replace(",",".")); return Number.isFinite(v)?toDecimal(v,S.style):null; };
  const line=parseFloat($("#cLine").value), hs=hdpSplit(m.g,line), as={win:hs.lose,lose:hs.win,push:hs.push};
  const hd=num("cHome"), ad=num("cAway");
  let out=`โมเดล: ${esc(m.h.short)} ${signed(line)} ครอบ <b class="num">${pct(cover(hs))}</b> · ${esc(m.a.short)} ${signed(-line)} ครอบ <b class="num">${pct(cover(as))}</b>${hs.push>0.005?` · คืนทุน ${pct(hs.push)}`:""}`;
  if(hd&&ad){ const f=devig([hd,ad]); out+=`<br>ตลาดหักน้ำ ${pct(f[0])} / ${pct(f[1])} · ส่วนต่าง <b class="num">${pts(cover(hs)-f[0])}</b> / <b class="num">${pts(cover(as)-f[1])}</b> จุด`; }
  else if($("#cHome").value||$("#cAway").value) out+=`<br><span style="color:var(--loss)">ราคาไม่ถูกรูปแบบ${PRICE_STYLES[S.style]} ดูตัวอย่างในช่อง หรือเปลี่ยนรูปแบบในเพิ่มเติม</span>`;
  $("#cOut").innerHTML=out;
  const tl=parseFloat($("#tLine").value), ts=totSplit(m.g,tl), od=num("tOver"), ud=num("tUnder");
  let t=`โมเดล: สูง ${ballLabel(tl)} <b class="num">${pct(cover(ts.over))}</b> · ต่ำ <b class="num">${pct(cover(ts.under))}</b>`;
  if(od&&ud){ const f=devig([od,ud]); t+=`<br>ตลาดหักน้ำ ${pct(f[0])} / ${pct(f[1])} · ส่วนต่าง <b class="num">${pts(cover(ts.over)-f[0])}</b> / <b class="num">${pts(cover(ts.under)-f[1])}</b> จุด`; }
  $("#tOut").innerHTML=t;
}
function sheetHtml(m){
  const tab=S.sheetTab;
  const body = tab==="market" ? sheetMarket(m) : tab==="stats" ? sheetStats(m) : tab==="luck" ? sheetBelief(m) : sheetOverview(m);
  return `<div class="bar"><div class="wrap"><button class="iconbtn" id="btnBack" aria-label="กลับ"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg></button>
    <span class="lg">${esc(lg(m))}</span>${starBtn(m)}</div></div>
  <div class="wrap body">
    <div class="face">
      <div>${badge(m.h,"lg")}<div class="nm">${esc(m.h.name)}</div><div class="meta">${m.h.rank?`อันดับ ${m.h.rank}`:""}${m.h.rank&&m.h.points!=null?" · ":""}${m.h.points!=null?`${m.h.points} แต้ม`:""}</div></div>
      <div class="mid num${m.st==="in"?" live":""}">${midHtml(m)}</div>
      <div>${badge(m.a,"lg")}<div class="nm">${esc(m.a.name)}</div><div class="meta">${m.a.rank?`อันดับ ${m.a.rank}`:""}${m.a.rank&&m.a.points!=null?" · ":""}${m.a.points!=null?`${m.a.points} แต้ม`:""}</div></div>
    </div>
    <div class="probbar" style="height:8px;margin-top:18px"><i class="h" style="width:${m.sum.home*100}%"></i><i class="d" style="width:${m.sum.draw*100}%"></i><i class="a" style="width:${m.sum.away*100}%"></i></div>
    <div class="problabels num"><span>เจ้าบ้าน <b>${pct(m.sum.home)}</b></span><span>เสมอ <b>${pct(m.sum.draw)}</b></span><span>เยือน <b>${pct(m.sum.away)}</b></span></div>
    ${seg("sheetTab",[["overview","วิเคราะห์"],["market","ราคา"],["stats","สถิติ"],["luck","ดวง"]],tab)}
    <div id="sheetBody">${body}</div>
  </div>`;
}
function paintSheet(){ const m=S.open; if(!m) return; const sh=$("#sheet"); const y=sh.scrollTop; sh.innerHTML=sheetHtml(m); sh.scrollTop=y; runCalc(); }
async function openMatch(id, date){
  if(date && date!==S.date) S.date=date;
  const day=getDay(S.date); let m=day.matches.find(x=>x.id===id);
  if(!m){ for(const d of Object.keys(S.days)){ m=S.days[d].matches.find(x=>x.id===id); if(m) break; } }
  if(!m) return;
  S.open=m; S.sheetTab="overview"; S.anaErr="";
  const sh=$("#sheet"); sh.innerHTML=sheetHtml(m); sh.hidden=false; sh.scrollTop=0; document.body.style.overflow="hidden"; runCalc();
  try{ if(location.hash==="#match-"+id || S.pushed) history.replaceState({sheet:1},"","#match-"+id); else { history.pushState({sheet:1},"","#match-"+id); S.pushed=true; } }catch{}
  enrichOpen(m, day);
}
/* deeper data for the open match: ESPN summary, then weather and birthdays in parallel */
async function enrichOpen(m, day){
  const id=m.id;
  const swap=()=>{ const cur=S.open; if(!cur||cur.id!==id) return; const base={...cur.raw}; const nm=refine(base); const idx=day.matches.findIndex(x=>x.id===id); if(idx>=0) day.matches[idx]=nm; S.open=nm; paintSheet(); };
  if(!m.ds && S.liveOk){
    const ds=await loadLiveDossier(m);
    if(S.open?.id!==id) return;
    if(ds){ m.raw.ds=ds; swap(); } else { const el=$("#dsLoading"); if(el) el.textContent="ดึงสถิติเชิงลึกไม่สำเร็จ"; }
  }
  if(window.claude || S.liveOk===false) return;
  if(Shared.on && !store.get("ana:"+id,null)){ getJson(`/api/analysis?id=${id}`,5000).then(a=>{ if(a?.paras?.length){ store.set("ana:"+id,a); if(S.open?.id===id) paintSheet(); } }).catch(()=>{}); }
  const cur=S.open; if(!cur||cur.id!==id) return;
  S.ext[id]=S.ext[id]||{};
  const [wx,people]=await Promise.all([S.ext[id].wx?S.ext[id].wx:loadWeather(cur), S.ext[id].people?S.ext[id].people:loadPeople(cur)]);
  if(wx) S.ext[id].wx=wx; if(people) S.ext[id].people=people;
  swap();
}
function hideSheet(){ $("#sheet").hidden=true; $("#sheet").innerHTML=""; S.open=null; document.body.style.overflow=""; render(); }
function closeSheet(){
  if(S.pushed){ S.pushed=false; try{ history.back(); return; }catch{} }
  hideSheet(); try{ history.replaceState(null,"","#"+S.tab); }catch{}
}
window.addEventListener("popstate",()=>{ if(S.open && !location.hash.startsWith("#match-")){ S.pushed=false; hideSheet(); } });

/* ---------- AI: long analysis for one match ---------- */
async function runAnalysis(){
  const m=S.open; if(!m) return;
  S.anaBusy=true; S.anaErr=""; paintSheet();
  const data={id:m.id,match:`${m.h.name} - ${m.a.name}`,league:lg(m),kickoffThai:kickTime(m.ko),state:m.st,score:m.st!=="pre"?`${m.h.score}-${m.a.score}`:null,
    ranks:[m.h.rank,m.a.rank],form:[m.h.form,m.a.form],model:{home:pct(m.sum.home),draw:pct(m.sum.draw),away:pct(m.sum.away),over25:pct(m.sum.over25),btts:pct(m.sum.btts),lambda:[+m.lh.toFixed(2),+m.la.toFixed(2)],topScores:m.sum.top.slice(0,3).map(c=>`${c.h}-${c.a}`)},
    handicap:m.mk?.spread?ahPhrase(m.h.short,m.a.short,m.mk.spread.line):null,factors:(m.factors||[]).map(f=>`${f.label}: ${f.text}`),
    h2h:m.meets.map(x=>`${x.date} ${x.f}-${x.a}`),players:(m.ds?.players||[]).map(p=>`${p.name} (${p.team}) ยิง ${p.goals??"-"} แอส ${p.assists??"-"}`)};
  try{
    let paras;
    const sample = window.claude ? await window.claude.use("sample") : null;
    if(sample){
      const out=await sample.json(`เขียนบทวิเคราะห์ฟุตบอลภาษาไทย สำนวนนักข่าวกีฬาปัจจุบัน กระชับแต่มีสีสัน 5-7 ย่อหน้า ใช้เฉพาะข้อมูลที่ให้ ห้ามแต่งชื่อนักเตะ อาการบาดเจ็บ หรือข่าวที่ไม่มี ห้ามชวนเดิมพัน ห้ามอ้างว่าชัวร์ ตอบ JSON {"paras":["ย่อหน้า",...]} ข้อมูล: ${JSON.stringify(data)}`,{modelTier:"default"});
      paras=out?.paras;
    } else {
      const out=await getJson("/api/analysis",60000,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
      if(out?.error) throw {message:out.error}; paras=out?.paras;
    }
    if(!Array.isArray(paras)||!paras.length) throw {message:"เขียนบทวิเคราะห์ไม่สำเร็จ ลองอีกครั้ง"};
    store.set("ana:"+m.id,{at:new Date().toISOString(),paras:paras.slice(0,8).map(t=>String(t).slice(0,900))});
  }catch(e){ S.anaErr=e?.code==="not_granted"?"ยังไม่ได้อนุญาตให้หน้านี้ถาม Claude":e?.message&&!/fetch|abort|\d{3}/i.test(e.message)?e.message:"ยังเรียก Claude ไม่ได้ ตรวจว่าใส่ ANTHROPIC_API_KEY ใน Vercel แล้ว"; }
  S.anaBusy=false; paintSheet();
}
/* news-based adjustments returned by the daily brief */
function applyBriefAdj(date){
  const b=store.get("brief:"+date,null), day=S.days[date]; if(!day?.matches?.length) return;
  let changed=false;
  for(const m of day.matches) if(S.newsAdj[m.id]){ delete S.newsAdj[m.id]; changed=true; }
  for(const a of b?.adjust||[]){
    const key=String(a.match||"").toLowerCase();
    const m=day.matches.find(x=>key.includes(x.h.short.toLowerCase())&&key.includes(x.a.short.toLowerCase())); if(!m) continue;
    const e=Math.max(-.05,Math.min(.03,Number(a.effect)||0)); if(!e) continue;
    const cur=S.newsAdj[m.id]||{h:0,a:0,reason:""}; cur[a.team==="away"?"a":"h"]+=e; cur.reason=[cur.reason,String(a.reason||"").slice(0,140)].filter(Boolean).join(" · ");
    S.newsAdj[m.id]=cur; changed=true;
    const tid=a.team==="away"?m.a.id:m.h.id; S.newsTeam[tid]={e,reason:String(a.reason||"").slice(0,120),d:date}; store.set("newsTeam",S.newsTeam);
  }
  if(changed) S.days[date]=prepare({...day, matches:day.matches.map(x=>x.raw||x)});
}

/* ---------- AI brief ---------- */
async function runBrief(){
  const day=getDay(S.date); if(!day.matches.length) return;
  S.briefBusy=true; S.briefErr=""; render();
  try{
    const sample = window.claude ? await window.claude.use("sample") : null;
    const data=day.matches.slice(0,30).map(m=>({match:`${m.h.short} - ${m.a.short}`,teams:[m.h.name,m.a.name],homeId:m.h.id,awayId:m.a.id,league:lg(m),kickoffThai:kickTime(m.ko),state:m.st,
      model:{home:+m.sum.home.toFixed(3),draw:+m.sum.draw.toFixed(3),away:+m.sum.away.toFixed(3),over25:+m.sum.over25.toFixed(3),likely:`${m.sum.top[0].h}-${m.sum.top[0].a}`,lambda:[+m.lh.toFixed(2),+m.la.toFixed(2)]},
      handicap:m.mk?.spread?ahPhrase(m.h.short,m.a.short,m.mk.spread.line):null, bestEdge:(b=>b?{label:b.label,points:+(b.edge*100).toFixed(1)}:null)(bestEdge(m)),
      form:[m.h.form,m.a.form], h2hMeetings:m.meets.length}));
    if(!sample){
      let out;
      try{ out=await getJson("/api/brief",60000,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({date:S.date,matches:data})}); }
      catch{ S.briefErr="ยังเรียกบทวิเคราะห์ไม่ได้ ตรวจว่าใส่ ANTHROPIC_API_KEY ใน Vercel แล้ว"; return; }
      if(out?.error){ S.briefErr=out.error; return; }
      store.set("brief:"+S.date,{at:new Date().toISOString(),summary:String(out.summary||"").slice(0,900),notes:(out.notes||[]).slice(0,6),players:(out.players||[]).slice(0,7),headlines:(out.headlines||[]).slice(0,12),adjust:(out.adjust||[]).slice(0,10)});
      applyBriefAdj(S.date);
      return;
    }
    const prompt=`คุณคือนักวิเคราะห์สถิติฟุตบอลของแอป Goal Club เขียนภาษาไทยทั้งหมด
ข้อมูลด้านล่างคือผลโมเดลปัวซง/ดิกสัน-โคลส์และราคาตลาดของวันที่ ${S.date} ใช้เฉพาะตัวเลขในข้อมูลนี้ ห้ามแต่งข่าว ชื่อนักเตะ อาการบาดเจ็บ หรือตัวเลขที่ไม่มีในข้อมูล ห้ามชวนเดิมพัน ห้ามอ้างว่าแม่นหรือชัวร์
ตอบเป็น JSON เท่านั้น รูปแบบ {"summary": "ภาพรวมของวัน 2-3 ประโยค", "notes": [{"match": "ทีม - ทีม", "text": "หนึ่งประโยคว่าตัวเลขบอกอะไร"}]} ใส่ notes 3-5 คู่ที่น่าสนใจที่สุด
ข้อมูล: ${JSON.stringify(data)}`;
    const out=await sample.json(prompt,{modelTier:"default"});
    if(!out||typeof out.summary!=="string") throw {message:"bad"};
    store.set("brief:"+S.date,{at:new Date().toISOString(),summary:out.summary.slice(0,600),notes:(Array.isArray(out.notes)?out.notes:[]).slice(0,5).map(n=>({match:String(n.match||"").slice(0,60),text:String(n.text||"").slice(0,240)}))});
  }catch(e){
    S.briefErr = e?.code==="not_granted" ? "ยังไม่ได้อนุญาตให้หน้านี้ถาม Claude" : e?.code==="rate_limited" ? "เรียกบ่อยเกินไป รอสักครู่แล้วลองใหม่" : "วิเคราะห์ไม่สำเร็จ ลองอีกครั้ง";
  }finally{ S.briefBusy=false; render(); }
}

/* ---------- chrome: status, dates, tabs ---------- */
const TABS=[["home","หน้าหลัก",'<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>'],["schedule","โปรแกรม",'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'],["analyze","วิเคราะห์",'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],["saved","ทีมโปรด",'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'],["more","เพิ่มเติม",'<path d="M4 6h16M4 12h16M4 18h16"/>']];
const DATED_TABS=new Set(["home","schedule","analyze"]);
function statusText(){
  const day=getDay(S.date);
  if(S.loading===S.date) return `<span class="dot live pulse"></span><span>กำลังอัปเดตข้อมูลสด…</span>`;
  if(S.err && day.source!=="snapshot") return `<span class="dot bad"></span><span>เชื่อมต่อไม่ได้ · ข้อมูลเมื่อ ${kickTime(day.fetchedAt||S.err)} · จะลองใหม่เอง</span>`;
  if(day.source==="live") return `<span class="dot live"></span><span>สดจาก ESPN · อัปเดต ${kickTime(day.fetchedAt)}${S.nextMs?` · ทุก ${S.nextMs>=600e3?"10 นาที":"1 นาที"}`:""}</span>`;
  if(day.source==="cache") return `<span class="dot"></span><span>ข้อมูลที่ดึงไว้ · ${stampTime(day.fetchedAt)}${S.liveOk===null?" · กำลังเชื่อมฟีดสด…":""}</span>`;
  if(day.source==="snapshot") return `<span class="dot"></span><span>ข้อมูลชุดที่บันทึกไว้ · ${stampTime(day.fetchedAt)}</span>`;
  return `<span class="dot"></span><span>ยังไม่มีข้อมูลของ${relLabel(S.date)}</span>`;
}
function paintStatus(){ const el=$("#status"); if(el) el.innerHTML=statusText(); }
function paintDates(){
  const el=$("#dates"); const show=DATED_TABS.has(S.tab);
  el.hidden=!show; $("#status").hidden=!show;
  if(!show) return;
  const t=bkkToday(); const set=new Set([shiftDate(t,-1),t,shiftDate(t,1),shiftDate(t,2),S.date]);
  Object.keys(SNAPSHOT||{}).filter(d=>d>=shiftDate(t,-1)).forEach(d=>set.add(d));
  const html=[...set].sort().map(d=>{
    const day=S.days[d]||((SNAPSHOT||{})[d]?getDay(d):null); const n=day?.matches?.length||0; const live=day?.matches?.some(m=>m.st==="in");
    const rel=relLabel(d), lbl=dayLabel(d);
    return `<button class="dchip ${d===S.date?"on":""}${live?" has-live":""}" role="tab" aria-selected="${d===S.date}" data-date="${d}"><span class="d1">${rel===lbl?lbl.split(" ")[0]:rel}</span><span class="d2 num">${rel===lbl?lbl.split(" ").slice(1).join(" "):lbl.split(" ").slice(1).join(" ")}${n?` · ${n}`:""}</span></button>`;
  }).join("");
  if(el.dataset.html!==html){ el.innerHTML=html; el.dataset.html=html; el.querySelector(".on")?.scrollIntoView({inline:"center",block:"nearest"}); }
}
function paintTabs(){
  const liveN=(S.days[S.date]?.matches||[]).filter(m=>m.st==="in").length;
  $("#tabs").innerHTML=TABS.map(([k,l,ic])=>`<a href="#${k}" class="${S.tab===k?"on":""}" data-tab="${k}" ${S.tab===k?'aria-current="page"':""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${ic}</svg>${l}${k==="schedule"&&liveN?`<span class="badge-n num">${liveN}</span>`:""}</a>`).join("");
}
function render(){
  if(S.adjFor!==S.date+":"+(S.days[S.date]?.fetchedAt||"")){ S.adjFor=S.date+":"+(S.days[S.date]?.fetchedAt||""); applyBriefAdj(S.date); }
  paintStatus(); paintDates(); paintTabs();
  if(S.recFor!==S.adjFor){ S.recFor=S.adjFor; recordDay(S.date); }
  if(S.open) return; // board refreshes after the sheet closes
  const v={home:viewHome,schedule:viewSchedule,analyze:viewAnalyze,saved:viewSaved,more:viewMore}[S.tab]||viewHome;
  $("#view").innerHTML=v();
}
function goTab(tab){ S.tab=tab; try{ history.replaceState(null,"","#"+tab); }catch{} render(); window.scrollTo({top:0}); }
function setDate(d){ S.date=d; S.league=""; if(Shared.on && !Shared.pulled[d]) syncPull(d).then(ok=>{ if(ok&&!S.open) render(); }); render(); window.scrollTo({top:0}); const day=S.days[d]; if(S.liveOk && (day?.source!=="live" || Date.now()-Date.parse(day.fetchedAt)>60e3)) refresh(d,false); else if(S.liveOk) scheduleNext(); }
function toggleFav(id){
  const m=(S.open&&S.open.id===id)?S.open:Object.values(S.days).flatMap(d=>d.matches).find(x=>x.id===id); if(!m) return;
  if(isFav(m)){ delete S.favs[m.h.id]; delete S.favs[m.a.id]; toast("เอาออกจากทีมโปรดแล้ว"); }
  else { S.favs[m.h.id]=m.h.short; S.favs[m.a.id]=m.a.short; toast(`เพิ่ม ${m.h.short} และ ${m.a.short} ในทีมโปรดแล้ว`); }
  store.set("favs",S.favs);
  if(S.open) paintSheet();
  render();
}

/* ---------- events ---------- */
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-fav],[data-open],[data-date],[data-set],[data-goto],[data-act],[data-unfav],[data-tab],#btnBrief,#btnAna,#btnBack,#btnSearch,#btnRefresh");
  if(!t) return;
  const d=t.dataset;
  if(d.fav){ e.stopPropagation(); e.preventDefault(); return toggleFav(d.fav); }
  if(t.id==="btnBack") return closeSheet();
  if(d.open) return openMatch(d.open, d.day);
  if(d.date) return setDate(d.date);
  if(d.set){
    const [k,v]=d.set.split(":"); S[k]=v;
    if(k==="style") store.set("style",v);
    if(k==="sheetTab"||(S.open&&k==="style")) return paintSheet();
    return render();
  }
  if(d.goto){ const [tab,sub]=d.goto.split(":"); if(tab==="schedule"&&sub) S.status=sub; if(tab==="analyze"&&sub) S.mode=sub; return goTab(tab); }
  if(d.unfav){ delete S.favs[d.unfav]; store.set("favs",S.favs); return render(); }
  if(d.tab){ e.preventDefault(); return goTab(d.tab); }
  if(d.act==="refresh"){ S.liveOk=null; return refresh(S.date,true); }
  if(d.act==="clear"){ try{ Object.keys(localStorage).filter(k=>k.startsWith("gc:day:")||k.startsWith("gc:brief:")).forEach(k=>localStorage.removeItem(k)); }catch{} toast("ล้างข้อมูลที่เก็บไว้แล้ว ทีมโปรดยังอยู่"); S.liveOk=null; return refresh(S.date,false); }
  if(t.id==="btnBrief") return runBrief();
  if(t.id==="btnAna") return runAnalysis();
  if(t.id==="btnSearch"){ const r=$("#searchRow"); r.hidden=!r.hidden; if(!r.hidden) $("#q").focus(); else { S.q=""; $("#q").value=""; render(); } return; }
  if(t.id==="btnRefresh"){ S.liveOk=null; return refresh(S.date,true); }
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && S.open) return closeSheet();
  if((e.key==="Enter"||e.key===" ") && e.target.matches?.(".mcard[role=button]")){ e.preventDefault(); openMatch(e.target.dataset.open); }
});
document.addEventListener("input",e=>{
  if(e.target.id==="q"){ clearTimeout(S.qT); S.qT=setTimeout(()=>{ S.q=e.target.value.trim(); render(); },160); }
  if(["cHome","cAway","tOver","tUnder"].includes(e.target.id)) runCalc();
});
document.addEventListener("change",e=>{
  if(e.target.id==="leagueSel"){ S.league=e.target.value; render(); }
  if(["cLine","tLine"].includes(e.target.id)) runCalc();
});
function fromHash(){
  const h=(location.hash||"").slice(1);
  if(TABS.some(([k])=>k===h)) S.tab=h;
  if(h.startsWith("match-")){ const id=h.slice(6); const d=[...Object.keys(S.days),...Object.keys(SNAPSHOT||{})].find(d=>getDay(d).matches.some(m=>m.id===id)); if(d){ render(); openMatch(id,d); return true; } }
  return false;
}
window.addEventListener("hashchange",()=>{ if(S.open) return; if(!fromHash()) render(); });

/* ---------- boot ---------- */
(function start(){
  const t=bkkToday(); S.today=t; S.calib=computeCalib();
  if(!getDay(t).matches.length && !store.get("day:"+t,null)){ const ds=Object.keys(SNAPSHOT||{}).sort(); const near=ds.find(d=>d>=t)||ds[ds.length-1]; if(near) S.date=near; }
  if(!fromHash()) render();
  probeLive().then(async ok=>{ if(ok && S.date!==t && !getDay(t).matches.length) S.date=t; if(ok && await syncPull(S.date)) render(); refresh(S.date,false); });
  if("serviceWorker" in navigator && location.protocol==="https:" && !window.claude){ try{ navigator.serviceWorker.register("/sw.js").catch(()=>{}); }catch{} }
})();
