/* =====================================================================
   UI — helpers, components, views, match sheet, events, boot
   ===================================================================== */
Object.assign(S, {
  status: "all",          // โปรแกรม filter: all | in | pre | post
  mode: "picks",          // วิเคราะห์ mode: picks | edge | goals
  edgeKind: "all",        // all | ah | ou | 1x2
  sheetTab: "overview",   // overview | market | stats
  calc: {},
  drawer: store.get("drawer2",{picks:false,brief:false}),
  picksAll: false,
  filterOpen: false
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
    <span class="meta">${m.st==="post"&&m.h.score!=null?verdictBadges(m,true):m.mk?.spread?`<span><b>${esc(ahPhrase(m.h.short,m.a.short,m.mk.spread.line))}</b></span>`:`<span>ทาย ${m.sum.top[0].h}-${m.sum.top[0].a}</span>`}<span>สูง 2.5 ${pct(m.sum.over25)}</span>${v?`<span class="tag value">มีค่า ${pts(v.edge)}</span>`:""}${isGoal(m)?`<span class="tag value">ประตู!</span>`:""}</span>
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
function pickRows(picks, offset=0){
  return picks.map((p,i)=>{ const m=p.m; return `<button class="prow${m?.st==="in"?" is-live":""}" data-open="${p.id}">
    <span class="prank num">${i+1+offset}</span>
    <span class="pmain">
      <span class="pl"><b>${esc(p.label)}</b><span class="ptag">${TYPE_LABEL[p.type]||""}</span></span>
      ${m?`<span class="pteams"><span class="tm num">${timeCell(m)}</span><span class="nm">${esc(m.h.short)} – ${esc(m.a.short)}</span></span>
      <span class="pmeta">${flagOf(m)} ${esc(lg(m))} · ทาย ${p.score}</span>`:""}
      ${pickStatus(p)?`<span class="pst">${pickStatus(p)}</span>`:""}
    </span>
    <span class="pside"><span class="pc num">${pct(p.prob)}</span><small>โอกาสได้ผล</small><span class="pbar"><i style="width:${Math.round(p.prob*100)}%"></i></span></span>
  </button>`; }).join("");
}
function recordPill(){
  const r=pickRecord(14); if(!r.n) return "";
  return `<span class="tag gold num">ย้อนหลัง 14 วัน เข้า ${r.won}/${r.n} (${Math.round(r.won/r.n*100)}%)${r.push?` · คืนทุน ${r.push}`:""}</span>`;
}
function drawer(key, title, sub, meta, body, icon){
  const open=!!S.drawer[key];
  return `<section class="drawer gold${open?" open":""}">
    <button class="dhead" data-drawer="${key}" aria-expanded="${open}">
      <span class="dicon">${icon}</span><span class="dtitle"><span class="dt">${title}</span>${sub?`<small>${sub}</small>`:""}</span>
      <span class="dm">${meta||""}</span><span class="chev" aria-hidden="true"></span>
    </button>
    <div class="dbody"${open?"":" hidden"}>${body}</div>
  </section>`;
}
const ICON_TARGET='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><path d="m15 9 5-5M17 4h3v3"/></svg>';
const ICON_TREND='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V14M9 20v-6M14 20v-9M19 20V8"/><path d="m4 10 5-4 4 3 7-6M16 3h4v4"/></svg>';
function picksHero(day){
  const P=picksFor(S.date), rel=relLabel(S.date);
  const title=`ฟันธงคู่เด็ด${rel==="วันนี้"?"วันนี้":rel}`;
  if(!P.list.length) return drawer("picks",title,day.matches.some(m=>m.st==="pre")?"ยังไม่มีคู่ที่โมเดลให้เกิน 55%":"ทุกคู่เริ่มเตะแล้ว",`<span class="dpill">0</span>`,`<p class="muted" style="margin:0 4px">${recordPill()||"ฟันธงคัดจากคู่ที่ยังไม่เตะเท่านั้น"}</p>`,ICON_TARGET);
  const top=P.list[0];
  const showAll=S.picksAll, list=showAll?P.list:P.list.slice(0,3);
  return drawer("picks",title,`อันดับ 1 ${esc(top.label)} · ${pct(top.prob)}`,`<span class="dpill num">${P.list.length} คู่</span>`,
    `<div class="list">${pickRows(list)}</div>
     ${P.list.length>3?`<button class="morebtn${showAll?" up":""}" data-act="picksAll">${showAll?"ย่อ":`ดูอีก ${P.list.length-3} คู่`} <span class="chev"></span></button>`:""}
     <div class="row" style="margin-top:10px">${recordPill()}<span class="spacer"></span><button class="act" data-goto="analyze:picks" style="font-size:13px;color:var(--gold)">ดูทั้งหมด ›</button></div>
     <p class="note">คัด ${P.list.length} จาก ${P.total} คู่ · เส้นที่แรงที่สุดของแต่ละคู่ · % คือโอกาสได้ผลไม่นับคืนทุน · คู่ที่เตะแล้วล็อกไว้ · ไม่ใช่คำแนะนำให้เดิมพัน</p>`,ICON_TARGET);
}
const PITCH_ART=`<svg class="brief-art" viewBox="0 0 120 80" aria-hidden="true"><defs><linearGradient id="pa" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9c47a"/><stop offset="1" stop-color="#8a6326"/></linearGradient></defs>
  <g transform="skewX(-14) translate(14 0)"><rect x="6" y="10" width="96" height="60" rx="4" fill="url(#pa)" opacity=".9"/><g fill="none" stroke="#3a2a10" stroke-width="1.2" opacity=".55"><rect x="10" y="14" width="88" height="52" rx="2"/><path d="M54 14v52"/><circle cx="54" cy="40" r="9"/><rect x="10" y="28" width="12" height="24"/><rect x="86" y="28" width="12" height="24"/></g>
  <g stroke="#7a2412" stroke-width="1.3" fill="none" opacity=".75"><path d="M28 50 C40 30 52 52 70 30"/><path d="m66 28 5 1-2 5"/></g><g fill="#7a2412" opacity=".8"><circle cx="28" cy="50" r="1.8"/><circle cx="46" cy="40" r="1.8"/><circle cx="62" cy="36" r="1.8"/></g></g>
  <circle cx="100" cy="58" r="13" fill="url(#pa)"/><path d="M100 58 V45 A13 13 0 0 1 112 53 Z" fill="#f6dfa6"/></svg>`;
function homeBrief(day){
  const c=writeDaily(day);
  const first=c?c.summary.split(" · ").slice(0,2).join(" · "):"";
  return drawer("brief","บทวิเคราะห์วันนี้", c?esc(first.slice(0,110))+(c.summary.length>first.length?"…":""):"ยังไม่มีคู่ของวันนี้", `<span class="faint">ระบบปิด</span>`,
    briefCard(day,true), ICON_TREND);
}
function briefCard(day, inner){
  const b=store.get("brief:"+S.date,null), c=writeDaily(day);
  return `<div class="${inner?"":"card gold "}brief">
    ${inner?"":`<div class="row"><h3>บทวิเคราะห์วันนี้</h3></div>`}
    ${c?`<p>${esc(c.summary)}</p>${c.notes.length?`<ul>${c.notes.map(n=>`<li><b>${esc(n.match)}</b> — ${esc(n.text)}</li>`).join("")}</ul>`:""}`:`<p class="muted">ยังไม่มีคู่ของวันนี้</p>`}
    ${b?.players?.length?`<div style="margin-top:10px"><b style="font-size:13px" class="gold">นักเตะในข่าว</b><ul>${b.players.map(p=>`<li><b>${esc(p.name)}</b>${p.club?` (${esc(p.club)})`:""} — ${esc(p.detail)}</li>`).join("")}</ul></div>`:""}
    ${b?.headlines?.length?`<details><summary>ข่าวที่ใช้ ${b.headlines.length} ชิ้น</summary><ul style="font-size:13px">${b.headlines.map(h=>`<li><span class="faint">${esc(h.source)}</span> ${h.url?`<a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a>`:esc(h.title)}</li>`).join("")}</ul></details>`:""}
    <p class="note">บอทระบบปิดสรุปจากสถิติและราคาของทุกคู่ในวันนี้ อัปเดตเองเมื่อข้อมูลเปลี่ยน · ไม่ใช่คำแนะนำให้เดิมพัน</p>
  </div>`;
}

/* ---------- views ---------- */
const FLAG={tha:"🇹🇭",eng:"🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",esp:"🇪🇸",ger:"🇩🇪",ita:"🇮🇹",fra:"🇫🇷",uefa:"🇪🇺",ned:"🇳🇱",por:"🇵🇹",bel:"🇧🇪",sco:"🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",tur:"🇹🇷",usa:"🇺🇸",mex:"🇲🇽",bra:"🇧🇷",arg:"🇦🇷",ksa:"🇸🇦",jpn:"🇯🇵",chn:"🇨🇳",aus:"🇦🇺"};
const flagOf=m=>FLAG[m.lg.split(".")[0]]||"⚽";
function progCard(m){
  const v=valueRow(m);
  const side=(t,sc)=>`<div class="pc-team">${badge(t)}<span class="nm">${esc(t.short)}${t.rank?`<small>#${t.rank}</small>`:""}</span>${m.st==="pre"?formPills(t.form):`<span class="sc num">${sc??"–"}</span>`}</div>`;
  return `<div class="pcard${liveCls(m)}" role="button" tabindex="0" data-open="${m.id}">
    <div class="pc-head"><span class="flag" aria-hidden="true">${flagOf(m)}</span><span class="lg">${esc(lg(m))}</span>${isGoal(m)?`<span class="tag value">ประตู!</span>`:""}${m.st==="pre"?`<span class="time num">${kickTime(m.ko)}</span>`:stateTag(m)}${starBtn(m)}</div>
    ${side(m.h,m.h.score)}${side(m.a,m.a.score)}
    <div class="pc-foot">${m.st==="post"&&m.h.score!=null?verdictBadges(m):""}${m.live?`<span class="num" style="color:var(--win)">ตอนนี้ ${esc(m.h.short)} ${pct(m.live.ph)} · เสมอ ${pct(m.live.pd)} · ${esc(m.a.short)} ${pct(m.live.pa)} · ทายจบ ${m.live.final.h}-${m.live.final.a}</span>`:m.st==="post"?"":`<span class="num">${esc(m.h.short)} ${pct(m.sum.home)} · เสมอ ${pct(m.sum.draw)} · ${esc(m.a.short)} ${pct(m.sum.away)}</span>`}${m.mk?.spread?`<span><b>${esc(ahPhrase(m.h.short,m.a.short,m.mk.spread.line))}</b></span>`:""}${v?`<span class="tag value">มีค่า ${pts(v.edge)}</span>`:""}</div>
  </div>`;
}
function spark(vals, color){
  if(!vals.length||Math.max(...vals)<=0) return "";
  const max=Math.max(...vals), n=vals.length, pts_=vals.map((v,i)=>`${(i/(n-1||1))*100},${28-(v/max)*22}`).join(" ");
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,30 ${pts_} 100,30" fill="${color}" opacity=".14"/><polyline points="${pts_}" fill="none" stroke="${color}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}
function homeTiles(ms){
  const t0=Math.min(...ms.map(m=>Date.parse(m.ko))), bins=12, span=24*3600e3/bins;
  const kick=Array(bins).fill(0), playing=Array(bins).fill(0);
  ms.forEach(m=>{ const k=Math.floor((Date.parse(m.ko)-t0)/span); if(k>=0&&k<bins){ kick[k]++; for(let j=k;j<Math.min(bins,k+2);j++) playing[j]++; } });
  const R=pickRecord(7); const days={}; R.list.forEach(x=>{ const d=days[x.d]=days[x.d]||{w:0,n:0}; if(x.res!=="push"){ d.n++; if(x.res==="win"||x.res==="half") d.w++; } });
  const acc=Object.keys(days).sort().map(d=>days[d].n?days[d].w/days[d].n:0);
  const live=ms.filter(m=>m.st==="in").length;
  return `<div class="tiles">
    <button class="tile c-green" data-goto="schedule:all"><div class="tt"><span class="ti">${'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>'}</span><span class="k">คู่ทั้งหมด</span></div><span class="v num">${ms.length}</span><span class="u">คู่${relLabel(S.date)}</span>${spark(kick,"#8fc79a")}</button>
    <button class="tile c-blue" data-goto="schedule:in"><div class="tt"><span class="ti">${'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V12M10 20V6M16 20v-9M22 20H2"/></svg>'}</span><span class="k">กำลังแข่งขัน</span></div><span class="v num">${live}</span><span class="u">คู่</span>${spark(playing,"#8fb0f0")}</button>
    <button class="tile c-gold" data-goto="analyze:picks"><div class="tt"><span class="ti">${'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>'}</span><span class="k">ฟันธงเข้า</span></div><span class="v num">${R.n?Math.round(R.won/R.n*100)+"%":"–"}</span><span class="u">${R.n?`เฉลี่ย 7 วัน · ${R.won}/${R.n}`:"ยังไม่มีผล"}</span>${spark(acc,"#f0cc86")}</button>
  </div>`;
}
function viewHome(){
  const day=getDay(S.date);
  if(!day.matches.length) return emptyDay();
  const ms=filtered(day).filter(m=>S.status==="all"||m.st===S.status);
  const live=ms.filter(m=>m.st==="in"), upcoming=ms.filter(m=>m.st==="pre"||m.st==="pp"), done=ms.filter(m=>m.st==="post"||m.st==="unk");
  const favs=ms.filter(isFav);
  return `<div class="hdrawers">${picksHero(day)}${homeBrief(day)}</div>
  <div style="height:12px"></div>${homeTiles(day.matches)}
  ${live.length?sec(`<span class="dot live pulse" style="vertical-align:4px;margin-right:8px"></span>กำลังแข่ง`,`${live.length} คู่ · อัปเดตทุกนาที`)+`<div class="stack">${live.map(progCard).join("")}</div>`:""}
  ${favs.length&&!S.q?sec("ทีมโปรดวันนี้")+`<div class="list">${favs.map(m=>matchRow(m)).join("")}</div>`:""}
  ${sec(live.length?"โปรแกรมถัดไป":"โปรแกรม",`เวลาไทย · ${upcoming.length} คู่`,`<button class="act" data-goto="schedule:all">ดูตามลีก</button>`)}
  ${upcoming.length?`<div class="stack">${upcoming.map(progCard).join("")}</div>`:`<div class="card muted" style="text-align:center">${ms.length?"ไม่มีคู่ที่ยังไม่เตะในตัวกรองนี้":"ไม่มีคู่ที่ตรงกับตัวกรอง"}</div>`}
  ${done.length?sec("ผลการแข่งขัน",(()=>{ const vs=done.map(verdict).filter(Boolean); if(!vs.length) return `จบแล้ว ${done.length} คู่`; const c=k=>vs.filter(v=>v[k]?.ok).length; const hd=vs.filter(v=>v.hdp&&!v.hdp.push); return `ทายผลชนะถูก ${c("res")}/${vs.length} · สูงต่ำ ${c("ou")}/${vs.length}${hd.length?` · แฮนดิแคป ${hd.filter(v=>v.hdp.ok).length}/${hd.length}`:""} · สกอร์ตรง ${c("exact")}`; })())+`<div class="list">${done.slice().reverse().map(m=>matchRow(m)).join("")}</div>`:""}`;
}
function viewSchedule(){
  const day=getDay(S.date);
  if(!day.matches.length) return emptyDay();
  const base=filtered(day);
  const cnt=k=>base.filter(m=>k==="all"||m.st===k).length;
  const ms=base.filter(m=>S.status==="all"||m.st===S.status);
  const groups={}; ms.forEach(m=>(groups[m.lg]=groups[m.lg]||[]).push(m));
  const keys=Object.keys(groups).sort((a,b)=>(LEAGUE_ORDER[a]??99)-(LEAGUE_ORDER[b]??99));
  return `${S.filterOpen?"":`<div class="toolbar">${seg("status",[["all","ทั้งหมด",cnt("all")],["in","สด",cnt("in")],["pre","ยังไม่เตะ",cnt("pre")],["post","จบแล้ว",cnt("post")]],S.status)}</div>`}
  ${keys.length?`<div class="stack">${keys.map(k=>`<div class="list"><div class="lhead"><span>${FLAG[k.split(".")[0]]||"⚽"} ${esc(LEAGUE_NAME[k]||k)}</span><span class="n num">${groups[k].length} คู่</span></div>${groups[k].map(m=>matchRow(m)).join("")}</div>`).join("")}</div>`
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
  if(S.mode==="acc") body=accuracyView();
  return `<div style="margin-bottom:12px">${seg("mode",[["picks","ฟันธง"],["edge","เทียบราคา"],["goals","สกอร์"],["acc","ความแม่น"]],S.mode)}</div>${body}`;
}
const FACTOR_NAME={h2h:"ผลที่เคยเจอกัน",pace:"เกมรุก-รับ 5 นัด",venue:"ฟอร์มในบ้าน/นอกบ้าน",rest:"วันพัก",lineup:"ตัวจริง",weather:"สภาพอากาศ",news:"ข่าววันนี้",newsOld:"ข่าวที่ผ่านมา",trend:"แนวโน้มลีก",rating:"ความแข็งของทีม",calib:"เรียนรู้จากผลจริง"};
function learningBlock(){
  const W=S.weights||{}, L=S.lessons;
  const fac=Object.entries(W.factors||{});
  return `${sec("ระบบเรียนรู้อะไรแล้ว", `${MEDUSA.name}${W.n?` · จากผลจริง ${W.n} นัด`:""}`)}
    <div class="card">
      ${fac.length?`<div class="statgrid" style="grid-template-columns:minmax(0,1fr) auto auto"><span class="h">ปัจจัย</span><span class="h">น้ำหนัก</span><span class="h"></span>
        ${fac.map(([k,v])=>`<span>${esc(FACTOR_NAME[k]||k)}</span><span class="num">×${v}</span><span class="${v>1?"green":v<1?"lossc":"faint"}" style="font-size:12px">${v===0?"ปิด":v>1?"เพิ่ม":v<1?"ลด":"คงเดิม"}</span>`).join("")}</div>`
        :`<p class="muted" style="margin:0;font-size:13.5px">ยังไม่ได้ปรับน้ำหนักปัจจัย ระบบจะเริ่มเองเมื่อมีผลจริงครบ 120 นัด และปรับซ้ำทุก 2–3 วัน</p>`}
      ${Object.keys(W.marketLg||{}).length?`<p class="note">น้ำหนักราคาตลาดรายลีก: ${Object.entries(W.marketLg).map(([lg,w])=>`${esc(LEAGUE_NAME[lg]||lg)} ${Math.round(w*100)}%`).join(" · ")}</p>`:""}
      ${Object.keys(W.pickCal||{}).length?`<p class="note">ปรับความมั่นใจฟันธง: ${Object.entries(W.pickCal).map(([t,c])=>`${TYPE_LABEL[t]||t} ×${c}`).join(" · ")}</p>`:""}
    </div>
    ${L?.items?.length?`${sec("บทเรียนล่าสุด",stampTime(L.at))}<div class="card"><ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.6">${L.items.map(x=>`<li>${esc(x.replace(/\b([a-z]{3}\.[a-z0-9._]+)\b/g,(m0)=>LEAGUE_NAME[m0]||m0))}</li>`).join("")}</ul></div>`:""}`;
}
function accuracyView(){
  const E=S.evals||{}, days=Object.keys(E).sort().reverse(), R=pickRecord(30);
  const tot=days.reduce((a,d)=>{ const e=E[d]; for(const k in e) a[k]=(a[k]||0)+(e[k]||0); return a; },{});
  const avg=(x,n)=>n?(x/n):null, f2=x=>x==null?"–":x.toFixed(3);
  const llM=avg(tot.llM,tot.n), llK=avg(tot.llK,tot.nK);
  const verdict = llM==null||llK==null ? "ยังมีผลไม่พอเทียบ" : llM<llK ? "โมเดลทายแม่นกว่าราคาตลาด" : "ราคาตลาดยังแม่นกว่าโมเดล";
  if(!Shared.on) return `<div class="card empty"><h3>ยังวัดผลไม่ได้</h3><p>การวัดความแม่นต้องเปิดข้อมูลร่วมทุกเครื่อง (ฐานข้อมูล Upstash) ซึ่งเปิดได้ในเว็บที่ติดตั้ง</p></div>`;
  return `<p class="pagelead">ทุกวันระบบเก็บผลจริงของทุกคู่ เทียบกับที่โมเดลและราคาตลาดทายไว้ก่อนเตะ แล้วใช้ผลนี้ปรับโมเดลเอง</p>
    <div class="tiles">
      <div class="tile c-gold"><div class="tt"><span class="k">คู่ที่วัดผลแล้ว</span></div><span class="v num">${tot.n||0}</span><span class="u">${days.length} วัน</span></div>
      <div class="tile c-green"><div class="tt"><span class="k">ทายผลถูก (โมเดล)</span></div><span class="v num">${tot.n?Math.round(tot.hitM/tot.n*100)+"%":"–"}</span><span class="u">ตลาด ${tot.nK?Math.round(tot.hitK/tot.nK*100)+"%":"–"}</span></div>
      <div class="tile c-blue"><div class="tt"><span class="k">ฟันธงเข้า 30 วัน</span></div><span class="v num">${R.n?Math.round(R.won/R.n*100)+"%":"–"}</span><span class="u">${R.won}/${R.n}</span></div>
    </div>
    ${sec("โมเดลเทียบราคาตลาด","log loss ยิ่งต่ำยิ่งแม่น")}
    <div class="card"><div class="row"><b>${verdict}</b><span class="spacer"></span></div>
      <div class="statgrid" style="margin-top:8px"><span class="h">ตัวชี้วัด</span><span class="h">โมเดล</span><span class="h">ตลาด</span>
        <span>log loss เฉลี่ย</span><span class="num">${f2(llM)}</span><span class="num">${f2(llK)}</span>
        <span>Brier score เฉลี่ย</span><span class="num">${f2(avg(tot.brM,tot.n))}</span><span class="num">${f2(avg(tot.brK,tot.nK))}</span>
        <span>ทายผลถูก (เลือกฝั่งที่ % สูงสุด)</span><span class="num">${tot.n?pct(tot.hitM/tot.n):"–"}</span><span class="num">${tot.nK?pct(tot.hitK/tot.nK):"–"}</span></div>
      <p class="note">น้ำหนักราคาตลาดในโมเดลตอนนี้ ${Math.round((S.weights?.market??.35)*100)}%${S.weights?.n?` ปรับเองล่าสุด ${stampTime(S.weights.at)} จากผลจริง ${S.weights.n} นัด`:" (ค่าเริ่มต้น ระบบจะปรับเองเมื่อสะสมครบ 120 นัด)"}</p></div>
    ${learningBlock()}
    ${sec("รายวัน")}
    ${days.length?`<div class="list">${days.map(d=>{ const e=E[d]; return `<div class="lrow"><span class="main"><div>${relLabel(d)}</div><div class="sub num">${e.n} คู่ · ทายถูก ${pct(e.hitM/e.n)} · ตลาด ${e.nK?pct(e.hitK/e.nK):"–"}</div></span><span class="r num">${f2(e.llM/e.n)}<div class="faint">${e.nK?f2(e.llK/e.nK):"–"}</div></span></div>`; }).join("")}</div>`
      :`<div class="card muted">ยังไม่มีผล ระบบจะวัดผลครั้งแรกหลังงานประจำวันรอบเที่ยง (เวลาไทย) ของวันพรุ่งนี้</div>`}
    <p class="note">ตัวเลขขวาบน = log loss ของโมเดล ล่าง = ของตลาด · ยิ่งต่ำยิ่งแม่น</p>`;
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
function factorRows(m){
  const pctChg=r=>{ const v=Math.round((r-1)*100); return v===0?`<span class="faint">0%</span>`:`<span class="${v>0?"green":"lossc"}">${v>0?"+":""}${v}%</span>`; };
  const used=(m.factors||[]).map(f=>`<div class="frow"><div class="fl"><div class="fn">${esc(f.label)}</div><div class="ft">${esc(f.text)}</div></div>
    ${f.base?`<div class="fe faint">ฐาน</div>`:`<div class="fe num"><div>${esc(m.h.short)} ${pctChg(f.h)}</div><div>${esc(m.a.short)} ${pctChg(f.a)}</div></div>`}</div>`).join("");
  const have=new Set((m.factors||[]).map(f=>f.k));
  const missing=[];
  if(!have.has("h2h")) missing.push(["ผลที่เคยเจอกัน", m.ds?"เคยเจอกันไม่ถึง 3 นัด":"ยังไม่ได้ดึงสถิติเชิงลึก"]);
  if(!have.has("venue")) missing.push(["ฟอร์มในบ้าน/นอกบ้าน","ฟีดยังไม่ระบุสนามของ 5 นัดหลัง"]);
  if(!have.has("rest")) missing.push(["วันพักและความล้า","ยังไม่มีวันที่ของนัดก่อนหน้า"]);
  if(!have.has("injury")) missing.push(["ผู้เล่นบาดเจ็บ/ติดโทษ", m.ds?.lineup?.known?"ประกาศตัวจริงแล้ว ใช้ปัจจัยตัวจริงแทน":m.ds?.inj?"ไม่มีดาวยิงหลักในรายชื่อเจ็บ":"ฟีดยังไม่มีรายชื่อผู้เล่นบาดเจ็บของคู่นี้"]);
  if(!have.has("lineup")) missing.push(["ตัวจริงที่ประกาศ","มักประกาศราว 1 ชั่วโมงก่อนเตะ"]);
  if(!have.has("weather")) missing.push(["สภาพอากาศและสนาม", window.claude?"ดูได้ในเว็บที่ติดตั้ง":"มีเฉพาะคู่ใน 14 วันข้างหน้าที่รู้เมืองของสนาม"]);
  if(!have.has("news")) missing.push(["ข่าววันนี้","กดวิเคราะห์วันนี้ที่หน้าหลักเพื่ออ่านข่าว"]);
  if(!have.has("trend")) missing.push(["แนวโน้มลีก 14 วัน", window.claude?"ดูได้ในเว็บที่ติดตั้ง":"ต้องมีผลในลีกอย่างน้อย 8 นัดและค่าเฉลี่ยทั้งฤดูกาล"]);
  if(!have.has("calib")){ const c=S.calib?.[m.lg]; missing.push(["เรียนรู้จากผลที่ผ่านมา",`สะสมผลเทียบคำทำนายในลีกนี้แล้ว ${c?.n||0} นัด ต้องครบ 10 นัด`]); }
  if(!have.has("rating")) missing.push(["ความแข็งของทีม (เรียนรู้ทุกวัน)", Shared.on?"ระบบบันทึกผลของทีมใดทีมหนึ่งไม่ถึง 6 นัด":"ต้องเปิดข้อมูลร่วมทุกเครื่อง"]);
  if(!have.has("market")) missing.push(["ราคาตลาด", m.mk?.home?"ราคาผิดรูปจนหาประตูที่คาดไม่ได้":"ฟีดยังไม่มีราคาผลการแข่งขันของคู่นี้"]);
  missing.push(["เสียงเชียร์และโซเชียลมีเดีย","ไม่มีฟีดสาธารณะที่วัดได้จริง จึงไม่เอามาคำนวณ"]);
  missing.push(["xG, ใบเหลือง-แดง, เตะมุม, ผู้ตัดสิน, ระยะเดินทาง","ฟีดฟรีที่ใช้อยู่ไม่มีข้อมูลเหล่านี้ก่อนเกม"]);
  return `<div class="list">${used}${missing.map(([a,b])=>`<div class="frow off"><div class="fl"><div class="fn">${a}</div><div class="ft">${b}</div></div><div class="fe faint">ไม่ได้ใช้</div></div>`).join("")}</div>`;
}
function scorerLuck(m){
  const people=S.ext[m.id]?.people?.players||[], day=bkkDateOf(m.ko), byName={}, list=[];
  for(const s of m.scorers?.list||[]){
    const pp=people.find(x=>x.name===s.name); const l=pp?.dob?personLuck(pp.dob,day):null;
    if(l){ byName[s.name]=l; list.push({...s,luck:l,assistLean:s.pAssist>s.pGoal}); }
  }
  list.sort((a,b)=>b.luck.score-a.luck.score||b.pGoal-a.pGoal);
  return {byName, list, best:list.find(x=>x.luck.score>0)||null};
}
function liveBox(m){
  const L=m.live; if(!L) return `<div id="liveBox"></div>`;
  const st=L.stats;
  const bar=(label,x,y,suf="")=>x==null||y==null?"":`<div class="lsrow"><span class="num">${x}${suf}</span><div class="lsbar"><i style="width:${x+y>0?x/(x+y)*100:50}%"></i></div><span class="num">${y}${suf}</span><small>${label}</small></div>`;
  return `<div class="livebox" id="liveBox">
    <div class="row"><span class="tag live"><span class="dot live pulse"></span>สด นาที ${L.min}</span><span class="spacer"></span><b class="num" style="font-size:20px;color:var(--win)">${m.h.score}–${m.a.score}</b></div>
    ${st?`<div class="lstats">${bar("ยิงเข้ากรอบ",st.h.sot,st.a.sot)}${bar("ยิงทั้งหมด",st.h.shots,st.a.shots)}${bar("ครองบอล",st.h.poss!=null?Math.round(st.h.poss):null,st.a.poss!=null?Math.round(st.a.poss):null,"%")}${bar("เตะมุม",st.h.corners,st.a.corners)}${st.h.red||st.a.red?`<div class="lsrow red"><span class="num">${st.h.red||0}</span><div></div><span class="num">${st.a.red||0}</span><small>ใบแดง</small></div>`:""}</div>`:""}
    <div class="sc-k" style="margin-top:12px;text-align:left">โอกาสตอนนี้ (ขยับตามเกมสด)</div>
    <div class="probbar" style="height:8px;margin-top:8px"><i class="h" style="width:${L.ph*100}%;background:var(--win)"></i><i class="d" style="width:${L.pd*100}%"></i><i class="a" style="width:${L.pa*100}%"></i></div>
    <div class="problabels num"><span>${esc(m.h.short)} <b>${pct(L.ph)}</b></span><span>เสมอ <b>${pct(L.pd)}</b></span><span>${esc(m.a.short)} <b>${pct(L.pa)}</b></span></div>
    <div class="funs" style="margin-top:12px">
      <div><em>ทายสกอร์จบ (สด)</em><b class="num">${L.final.h}-${L.final.a} <span class="faint" style="font-weight:400">${pct(L.final.p)}</span></b></div>
      <div><em>ประตูต่อไป</em><b>${L.pMore<.15?"น่าจะไม่มีแล้ว":`${L.next.h>=L.next.a?esc(m.h.short):esc(m.a.short)} ${pct(Math.max(L.next.h,L.next.a))}`}</b></div>
      <div><em>จบสูง 2.5</em><b class="num">${pct(L.over25)}</b></div>
      <div><em>มีประตูเพิ่ม</em><b class="num">${pct(L.pMore)}</b></div>
    </div>
    <div class="scorechips">${L.top.map((c,i)=>`<span class="${i===0?"best":""}"><b class="num">${c.h}-${c.a}</b><small class="num">${pct(c.p)}</small></span>`).join("")}</div>
    <div class="note" style="margin-top:10px">${liveCommentary(m)}</div></div>`;
}
function liveCommentary(m){
  const L=m.live, lead=m.h.score>m.a.score?m.h.short:m.a.score>m.h.score?m.a.short:null;
  const fav=L.ph>=L.pa?m.h.short:m.a.short, pf=Math.max(L.ph,L.pa);
  const parts=[`นาที ${L.min} ${lead?`${lead} นำอยู่`:"ยังเสมอ"} ${m.h.score}–${m.a.score}`];
  parts.push(...L.notes);
  parts.push(pf>=.75?`${fav} คุมผลไว้แน่น โอกาสชนะ ${pct(pf)}`:pf>=.5?`${fav} ยังมีภาษีกว่า ${pct(pf)}`:`เกมยังเปิด ลุ้นได้ทุกทาง เสมอ ${pct(L.pd)}`);
  parts.push(`ที่เหลือคาด ${m.h.short} ยิงอีก ${L.rh.toFixed(2)} ลูก ${m.a.short} ${L.ra.toFixed(2)} ลูก`);
  return esc(parts.join(" · "));
}
function verdictBadges(m, short){
  const v=verdict(m); if(!v) return "";
  const b=(ok,label,push)=>`<span class="vb ${push?"push":ok?"ok":"no"}">${push?"–":ok?"✓":"✗"} ${label}</span>`;
  const resName=v.res.pred==="h"?m.h.short:v.res.pred==="a"?m.a.short:"เสมอ";
  return `<span class="vbs">${b(v.res.ok,short?"ผลชนะ":`ทาย${v.res.pred==="d"?"เสมอ":resName+" ชนะ"}`)}${b(v.ou.ok,short?"สูงต่ำ":`ทาย${v.ou.pred==="o"?"สูง":"ต่ำ"} 2.5`)}${v.hdp?b(v.hdp.ok,short?"แฮนดิแคป":`แฮนดิแคป ${v.hdp.side==="h"?m.h.short:m.a.short}`,v.hdp.push):""}${v.exact.ok?b(true,`สกอร์ตรง ${v.exact.pred}`):short?"":b(false,`สกอร์ ${v.exact.pred}`)}</span>`;
}
function verdictCard(m){
  const v=verdict(m); if(!v) return "";
  const row=(label,pred,ok,extra="",push=false)=>`<div class="vrow"><span>${label}</span><span>${pred}</span><span class="vb ${push?"push":ok?"ok":"no"}">${push?"คืนทุน":ok?"✓ ถูก":"✗ ผิด"}</span></div>${extra}`;
  const resName=v.res.pred==="h"?m.h.short:v.res.pred==="a"?m.a.short:"เสมอ";
  const n=[v.res.ok,v.ou.ok,v.exact.ok,v.btts.ok,v.hdp?.ok].filter(x=>x===true).length, tot=v.hdp?5:4;
  return `<div class="verdictcard"><div class="row"><b>ผลการทายคู่นี้</b><span class="spacer"></span><span class="tag ${n>=tot/2?"value":"warn"}">ถูก ${n}/${tot}</span></div>
    <div class="vrows">
      ${row("ผลการแข่งขัน",`${v.res.pred==="d"?"เสมอ":resName+" ชนะ"} <small class="num">${pct(v.res.p)}</small>`,v.res.ok)}
      ${row("สูง/ต่ำ 2.5",`${v.ou.pred==="o"?"สูง":"ต่ำ"} <small class="num">${pct(v.ou.p)}</small>`,v.ou.ok)}
      ${v.hdp?row("แฮนดิแคป",`${v.hdp.side==="h"?esc(m.h.short)+" "+signed(v.hdp.line):esc(m.a.short)+" "+signed(-v.hdp.line)}`,v.hdp.ok,"",v.hdp.push):""}
      ${row("ทั้งสองทีมยิง",v.btts.pred?"ยิงทั้งคู่":"ไม่ยิงทั้งคู่",v.btts.ok)}
      ${row("ทายสกอร์",`<span class="num">${v.exact.pred}</span>`,v.exact.ok)}
    </div>
    <p class="note">จบจริง ${m.h.score}–${m.a.score} · ${v.frozen?"เทียบกับที่ทายไว้ก่อนเตะ (บันทึกตอนเตะ)":"ไม่ได้บันทึกตอนก่อนเตะในเครื่องนี้ ใช้ตัวเลขของโมเดลตอนนี้แทน"}</p></div>`;
}
const HTFT_NAME=(m,k)=>{ const n=c=>c==="h"?m.h.short:c==="a"?m.a.short:"เสมอ"; return `${n(k[0])} / ${n(k[1])}`; };
function scoreCard(m){
  const top=m.sum.top[0], S_=m.scorers, X=m.extra;
  const line=(s)=>{ const st=S_?.story?.[s]||[]; return st.length?st.map(g=>`<span class="goal-l">⚽ ${esc(g.name)}${g.assist?` <small>ส่ง ${esc(g.assist)}</small>`:""}</span>`).join(""):`<span class="faint">ไม่ยิง</span>`; };
  return `<div class="scorecard">
    <div class="sc-k">${m.st==="pre"?"ทายสกอร์ตามโมเดล":"ทายสกอร์ก่อนเกม"}</div>
    <div class="sc-row"><div class="sc-t">${badge(m.h)}<b>${esc(m.h.short)}</b></div><div class="sc-n num">${top.h} – ${top.a}</div><div class="sc-t r"><b>${esc(m.a.short)}</b>${badge(m.a)}</div></div>
    <div class="sc-p num">โอกาสสกอร์นี้ ${pct(top.p)} · สกอร์อื่นที่ใกล้เคียง ${m.sum.top.slice(1,4).map(c=>`${c.h}-${c.a}`).join(", ")}</div>
    ${S_?`<div class="sc-story"><div>${line("h")}</div><div class="r">${line("a")}</div></div>`:""}
  </div>
  ${(()=>{ if(!S_) return ""; const lk=scorerLuck(m); if(!lk.list.length) return ""; const star=lk.best;
    return `${sec("ดาวยิงตามดวง","เพื่อความสนุก ไม่เข้า %")}<div class="card luckcard">
      ${star?`<div class="lk-star">✦ ดวงหนุนสุดวันนี้ <b>${esc(star.name)}</b> <span class="faint">(${esc(star.team)})</span><div class="ft">ทักษาวันแข่งเป็น<b>${star.luck.taksa}</b> · ปี${star.luck.animal} ${star.luck.zodiac} · ถ้าเชื่อดวง ชื่อนี้น่าลุ้นเป็นคน${star.assistLean?"ส่ง":"ยิง"}</div></div>`:`<div class="ft">วันนี้ไม่มีดาวยิงคนไหนดวงหนุนเด่น</div>`}
      <div class="lk-list">${lk.list.map(p=>`<span class="lk ${p.luck.score>0?"up":p.luck.score<0?"down":""}">${esc(p.name)} <b class="num">${p.luck.score>0?"+":""}${p.luck.score.toFixed(1)}</b> <small>${p.luck.taksa} · ${p.luck.zodiac.replace("กับวัน","")}</small></span>`).join("")}</div>
      <p class="note">คำนวณจากวันเกิดนักเตะเทียบกับวันแข่ง (ทักษาไทย + นักษัตรจีน) ใช้อ่านเล่น ตัวเลข % ยิงและส่งด้านล่างมาจากสถิติอย่างเดียว</p></div>`; })()}
  ${S_?`${sec("คนยิงและคนส่ง","จากสัดส่วนประตูในฤดูกาล")}<div class="list scorers"><div class="srow sh"><span>นักเตะ</span><span>ยิง</span><span>ส่ง</span><span>ยิงแรก</span></div>
    ${S_.list.slice(0,8).map(p=>`<div class="srow"><span class="sn"><b>${esc(p.name)}${(()=>{ const l=scorerLuck(m).byName[p.name]; return l?` <span class="lkdot ${l.score>0?"up":l.score<0?"down":""}" title="ดวงวันนี้">${l.score>0?"✦":l.score<0?"✕":"·"}</span>`:""; })()}</b><small>${esc(p.team)} · ${p.goals??0} ประตู${p.assists!=null?` · ${p.assists} แอสซิสต์`:""}${S_.known&&p.play<1?" · ไม่ได้เป็นตัวจริง":""}${p.news?` · <span class="lossc">ข่าว: ${p.news.status==="out"?"ไม่ได้ลง":"ไม่แน่ว่าได้ลง"} ${esc(p.news.reason||"")}</span>`:""}</small></span><span class="num">${pct(p.pGoal)}</span><span class="num">${pct(p.pAssist)}</span><span class="num">${pct(p.pFirst)}</span></div>`).join("")}</div>
    <p class="note">ยิง/ส่ง = โอกาสยิงหรือแอสซิสต์อย่างน้อย 1 ครั้งในเกมนี้ คิดจากประตูที่คาดของทีม × สัดส่วนผลงานของนักเตะ${S_.known?" × ลงตัวจริงหรือไม่":" (ยังไม่ประกาศตัวจริง คิดเวลาลงสนาม 85%)"} · ฟีดให้รายชื่อเฉพาะดาวเด่นของแต่ละทีม</p>`
    :`<div class="card muted" style="margin-top:12px;font-size:13.5px">${m.ds?"ฟีดยังไม่มีรายชื่อดาวยิงของคู่นี้":"รายชื่อคนยิงจะขึ้นเมื่อโหลดสถิติเชิงลึกของคู่นี้"}</div>`}
  ${sec("ตลาดสนุก ๆ","จากประตูที่คาดชุดเดียวกัน")}
  <div class="funs">
    <div><em>ครึ่งแรกมีประตู</em><b class="num">${pct(X.goal1H)}</b></div>
    <div><em>ทีมยิงก่อน</em><b>${X.first.h>=X.first.a?esc(m.h.short):esc(m.a.short)} <span class="num">${pct(Math.max(X.first.h,X.first.a))}</span></b></div>
    <div><em>ผลครึ่งแรก</em><b>${X.h1.h>=X.h1.a&&X.h1.h>=X.h1.d?esc(m.h.short)+" นำ":X.h1.a>=X.h1.d?esc(m.a.short)+" นำ":"เสมอ"} <span class="num">${pct(Math.max(X.h1.h,X.h1.d,X.h1.a))}</span></b></div>
    <div><em>ครึ่ง/จบ ที่น่าจะเป็น</em><b>${esc(HTFT_NAME(m,X.htftTop[0][0]))} <span class="num">${pct(X.htftTop[0][1])}</span></b></div>
    <div><em>${esc(m.h.short)} ชนะไม่เสียประตู</em><b class="num">${pct(X.nilH)}</b></div>
    <div><em>${esc(m.a.short)} ชนะไม่เสียประตู</em><b class="num">${pct(X.nilA)}</b></div>
    <div><em>สูง 1.5 / สูง 3.5</em><b class="num">${pct(X.over15)} / ${pct(X.over35)}</b></div>
    <div><em>ประตูรวม คี่ / คู่</em><b class="num">${pct(X.odd)} / ${pct(X.even)}</b></div>
    <div><em>${esc(m.h.short)} ชนะห่าง 2+</em><b class="num">${pct((X.margin.h2||0)+(X.margin.h3||0))}</b></div>
    <div><em>${esc(m.a.short)} ชนะห่าง 2+</em><b class="num">${pct((X.margin.a2||0)+(X.margin.a3||0))}</b></div>
  </div>`;
}
function sheetOverview(m){
  const L=leanOf(m), conf=Math.max(m.sum.home,m.sum.away);
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
      <div class="scorechips">${m.sum.top.map((c,i)=>`<span class="${i===0?"best":""}"><b class="num">${c.h}-${c.a}</b><small class="num">${pct(c.p)}</small></span>`).join("")}</div>
    </div>
    ${verdictCard(m)}
    ${liveBox(m)}
    ${botCard(m)}
    ${scoreCard(m)}
    ${sec("ปัจจัยที่ใช้คำนวณ",`อัลกอริทึม${MEDUSA.name} · ผลต่อประตูที่คาดของแต่ละทีม`)}
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
    if(ds){ m.raw.ds=ds; swap(); const pids=(ds.players||[]).map(p=>p.id).filter(Boolean); if(await syncPlayers(pids)) swap(); } else { const el=$("#dsLoading"); if(el) el.textContent="ดึงสถิติเชิงลึกไม่สำเร็จ"; }
  }
  if(window.claude || S.liveOk===false) return;
  if(Shared.on && !store.get("bot:"+id,null)){ getJson(`/api/analysis?id=${id}`,5000).then(a=>{ if(a?.text){ store.set("bot:"+id,a); if(S.open?.id===id&&!S.bot[id]) paintSheet(); } }).catch(()=>{}); }
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
/* ---------- บอท Goal Club: research + full analysis + ทัศนะบอล ---------- */
S.bot={};
function mdLite(t){
  t=String(t); const k=t.indexOf("## "); if(k>0) t=t.slice(k);   // drop the bot's "let me search" preamble
  const out=[]; let list=false;
  for(const raw of String(t).split("\n")){
    const l=raw.trim(); if(!l){ if(list){ out.push("</ul>"); list=false; } continue; }
    if(l.startsWith("## ")){ if(list){ out.push("</ul>"); list=false; } out.push(`<h4>${esc(l.slice(3))}</h4>`); }
    else if(/^[-•] /.test(l)){ if(!list){ out.push("<ul>"); list=true; } out.push(`<li>${esc(l.slice(2))}</li>`); }
    else { if(list){ out.push("</ul>"); list=false; } out.push(`<p>${esc(l.replace(/\*\*/g,""))}</p>`); }
  }
  if(list) out.push("</ul>"); return out.join("");
}
function botBody(m){
  const st=S.bot[m.id], saved=store.get("bot:"+m.id,null);
  if(st?.busy) return `<div class="botstatus">${st.status.slice(-3).map(s=>`<span><span class="dot live pulse"></span>${esc(s)}</span>`).join("")}</div><div class="article bottext">${mdLite(st.text)}<span class="caret"></span></div>`;
  return `<div class="article bottext">${mdLite(writeTasana(m))}</div>
    <p class="note">เขียนสดจากตัวเลขล่าสุดของแอป อัปเดตเองเมื่อข้อมูลเปลี่ยน · ไม่ใช้ AI ภายนอก ไม่ต้องมีคีย์</p>
    ${saved?`<details class="botsrc"><summary>ฉบับ AI ค้นเว็บ · ${stampTime(saved.at)}</summary><div class="article bottext">${mdLite(saved.text)}</div>${saved.sources?.length?`<ul>${saved.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join("")}</ul>`:""}</details>`:""}
    ${st?.err?`<p style="color:var(--loss);font-size:13px;margin:8px 0 0">${esc(st.err)}</p>`:""}`;
}
function botCard(m){
  const st=S.bot[m.id];
  return `<div class="botcard">
    <div class="bothead"><span class="botav" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="7" width="16" height="12" rx="4"/><path d="M12 3v4M9 12h.01M15 12h.01M9.5 15.5h5"/></svg></span>
      <div class="bt"><b>บอท Goal Club</b><small>ระบบปิด · ใช้สถิติของแอป · เขียนทัศนะบอล</small></div></div>
    <div id="botBody">${botBody(m)}</div>
    <button class="linkbtn" id="btnBot" style="margin-top:10px" ${st?.busy?"disabled":""}>${st?.busy?"AI กำลังค้นเว็บ…":"เสริมด้วย AI ค้นข่าวเว็บ (ต้องตั้งคีย์ AI)"}</button>
  </div>`;
}
function botPayload(m){
  const luck=typeof scorerLuck==="function"?scorerLuck(m):null;
  return {id:m.id,lg:m.lg,match:`${m.h.name} - ${m.a.name}`,league:lg(m),kickoffThai:`${relLabel(bkkDateOf(m.ko))} ${kickTime(m.ko)}`,state:m.st,score:m.st!=="pre"?`${m.h.score}-${m.a.score}`:null,
    table:{home:{rank:m.h.rank,points:m.h.points,played:m.h.played,gf:m.h.gf,ga:m.h.ga,form:m.h.form},away:{rank:m.a.rank,points:m.a.points,played:m.a.played,gf:m.a.gf,ga:m.a.ga,form:m.a.form}},
    model:{home:pct(m.sum.home),draw:pct(m.sum.draw),away:pct(m.sum.away),over25:pct(m.sum.over25),btts:pct(m.sum.btts),expectedGoals:[+m.lh.toFixed(2),+m.la.toFixed(2)],topScores:m.sum.top.map(c=>`${c.h}-${c.a} ${pct(c.p)}`),lean:leanOf(m).title},
    factors:(m.factors||[]).map(f=>`${f.label}: ${f.text}${f.base?"":` (เจ้าบ้าน ${Math.round((f.h-1)*100)}%, เยือน ${Math.round((f.a-1)*100)}%)`}`),
    market:m.mk?{book:m.mk.book,handicap:m.mk.spread?ahPhrase(m.h.short,m.a.short,m.mk.spread.line):null,total:m.mk.total?.line??null,edges:edgeRows(m).map(r=>`${r.label}: โมเดล ${pct(r.model)} ตลาด ${r.fair!=null?pct(r.fair):"-"}`)}:null,
    pickCover:m.mk?.spread?(()=>{ const c=cover(hdpSplit(m.g,m.mk.spread.line)); return c>=.5?`${m.h.short} ${signed(m.mk.spread.line)} ${pct(c)}`:`${m.a.short} ${signed(-m.mk.spread.line)} ${pct(1-c)}`; })():null,
    scorers:(m.scorers?.list||[]).slice(0,6).map(p=>`${p.name} (${p.team}) ยิง ${pct(p.pGoal)} ส่ง ${pct(p.pAssist)} ยิงแรก ${pct(p.pFirst)}`),scoreStory:m.scorers?.story||null,
    funMarkets:{firstHalfGoal:pct(m.extra.goal1H),firstToScore:m.extra.first.h>=m.extra.first.a?`${m.h.short} ${pct(m.extra.first.h)}`:`${m.a.short} ${pct(m.extra.first.a)}`,htft:m.extra.htftTop.map(([k,p])=>`${HTFT_NAME(m,k)} ${pct(p)}`)},
    live:m.live?{minute:m.live.min,home:pct(m.live.ph),draw:pct(m.live.pd),away:pct(m.live.pa)}:null,
    h2h:m.meets.map(x=>`${x.date} ${m.h.short} ${x.f}-${x.a}`),weather:S.ext[m.id]?.wx||null,
    lessons:S.lessons?.items||null,
    trackRecord:(()=>{ const r=pickRecord(30); return r.n?`ฟันธง 30 วัน เข้า ${r.won}/${r.n}`:null; })(),
    learnedWeights:S.weights?{market:S.weights.marketLg?.[m.lg]??S.weights.market,factors:S.weights.factors||null,pickCal:S.weights.pickCal||null}:null,
    playerNews:Object.values(S.newsPlayer||{}).filter(n=>[m.h.name,m.a.name,m.h.short,m.a.short].some(t=>String(n.team||"").toLowerCase().includes(String(t).toLowerCase().split(" ")[0]))).slice(0,8),
    luckForFun:luck?.list?.length?luck.list.map(p=>`${p.name}: ทักษา${p.luck.taksa} ปี${p.luck.animal} ${p.luck.zodiac} คะแนน ${p.luck.score}`):null};
}
async function runBot(){
  const m=S.open; if(!m) return; const id=m.id;
  S.bot[id]={busy:true,status:["กำลังเตรียมข้อมูลของคู่นี้"],text:""}; paintSheet();
  const paint=()=>{ if(S.open?.id!==id) return; const el=$("#botBody"); if(el) el.innerHTML=botBody(S.open); };
  const st=S.bot[id], data=botPayload(m);
  try{
    const sample = window.claude ? await window.claude.use("sample") : null;
    if(sample){
      st.status.push("หน้านี้ค้นเว็บไม่ได้ บอทเขียนจากข้อมูลในแอป"); paint();
      const r=await sample(`${"คุณคือบอท Goal Club เขียนทัศนะบอลภาษาไทย สำนวนนักข่าวกีฬาปัจจุบัน ใช้หัวข้อ ## และรายการ - ห้ามแต่งข้อมูล ห้ามชวนเดิมพัน หัวข้อ: ทัศนะบอล, สถานการณ์ล่าสุด, สถิติที่ต้องรู้, ตัวเลขจากโมเดล Goal Club, วิเคราะห์เกม, ทัศนะ (ทิศทางเกม แฮนดิแคปที่โมเดลเอียง สูงต่ำ ทายสกอร์ ดาวยิง ความมั่นใจเป็นดาว), ดวงวันนี้ (เพื่อความสนุก) ปิดท้ายว่าใช้ประกอบการดูบอล ไม่ใช่คำแนะนำให้เดิมพัน"}\nข้อมูล: ${JSON.stringify(data)}`,{modelTier:"default",onText:({text})=>{ st.text=text; paint(); }});
      st.text=r.text; store.set("bot:"+id,{at:new Date().toISOString(),text:r.text,sources:[],bot:false});
    } else {
      const resp=await fetch("/api/analysis",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
      if(!resp.ok||!resp.body) throw {message:"เรียกบอทไม่สำเร็จ ลองใหม่อีกครั้ง"};
      const reader=resp.body.getReader(), dec=new TextDecoder(); let buf="", src=[], err="";
      for(;;){
        const {done,value}=await reader.read(); if(done) break;
        buf+=dec.decode(value,{stream:true}); let i;
        while((i=buf.indexOf("\n"))>=0){
          const line=buf.slice(0,i); buf=buf.slice(i+1); let ev; try{ ev=JSON.parse(line); }catch{ continue; }
          if(ev.t==="text"){ st.text+=ev.d; paint(); }
          else if(ev.t==="status"){ st.status.push(ev.d); paint(); }
          else if(ev.t==="src") src=ev.d||[];
          else if(ev.t==="error") err=ev.d;
        }
      }
      if(!st.text.trim()) throw {message:err||"บอทไม่ได้ส่งบทวิเคราะห์กลับมา ลองใหม่อีกครั้ง"};
      store.set("bot:"+id,{at:new Date().toISOString(),text:st.text.trim(),sources:src,bot:true});
    }
    delete S.bot[id];
  }catch(e){ S.bot[id]={err:e?.code==="not_granted"?"ยังไม่ได้อนุญาตให้หน้านี้ถาม Claude":e?.message||"บอททำงานไม่สำเร็จ ลองใหม่อีกครั้ง"}; }
  if(S.open?.id===id) paintSheet();
}

/* ---------- บอทระบบปิด: เขียนทัศนะบอลจากสถิติของแอปเอง ไม่เรียก AI ภายนอก ---------- */
function hashStr(s){ let h=2166136261; for(const c of String(s)){ h^=c.charCodeAt(0); h=Math.imul(h,16777619); } return h>>>0; }
function phraser(seed){ return (arr,salt="")=>arr[hashStr(seed+"|"+salt)%arr.length]; }
function starsOf(p){ const n=p>=.70?5:p>=.64?4:p>=.58?3:p>=.53?2:1; return {n,txt:"★".repeat(n)+"☆".repeat(5-n)}; }
function rec5(lines){ const s=linesStats(lines); return s; }
function newsFor(m){
  const keys=[m.h.name,m.a.name,m.h.short,m.a.short].map(t=>String(t||"").toLowerCase().split(" ")[0]).filter(x=>x.length>2);
  return Object.values(S.newsPlayer||{}).filter(n=>keys.some(k=>String(n.team||"").toLowerCase().includes(k))).slice(0,8);
}
function writeTasana(m){
  const pk=phraser(m.id), H=m.h.short, A=m.a.short, L=leanOf(m), top=m.sum.top[0], out=[];
  const fav=m.sum.home>=m.sum.away?"h":"a", favN=fav==="h"?H:A, dogN=fav==="h"?A:H, pf=Math.max(m.sum.home,m.sum.away);
  const tot=m.lh+m.la, W=(...x)=>out.push(...x);
  /* 1. headline */
  const hook = L.tone==="strong" ? pk([`${favN} ได้เปรียบชัดทั้งบนกระดาษและในตัวเลข`,`ตัวเลขชี้ทางเดียว ${favN} คือฝั่งที่คุมเกม`,`งานนี้ ${favN} ถือไพ่เหนือกว่าเห็น ๆ`],"hk")
    : L.tone==="lean" ? pk([`${favN} มีภาษีกว่า แต่ ${dogN} ก็ไม่ได้มาแค่เป็นไม้ประดับ`,`ดูเผิน ๆ ${favN} น่าเชื่อกว่า แต่ช่องว่างไม่ได้กว้างอย่างที่คิด`,`${favN} เหนือกว่าครึ่งก้าว เกมนี้ต้องดูกันที่รายละเอียด`],"hk")
    : pk([`สูสีจนแทบแยกไม่ออก ผลอาจตัดสินกันที่จังหวะเดียว`,`เกมวัดใจที่ตัวเลขยังไม่กล้าฟันธงข้างใด`,`สองทีมสูสี ใครพลาดน้อยกว่าคนนั้นได้ไป`],"hk");
  W("## ทัศนะบอล", `${lg(m)} · ${m.h.name} พบ ${m.a.name} · ${m.st==="pre"?`${relLabel(bkkDateOf(m.ko))} เตะ ${kickTime(m.ko)} น.`:m.st==="in"?`กำลังแข่ง ${m.h.score}–${m.a.score}`:`จบแล้ว ${m.h.score}–${m.a.score}`}`, hook, "");
  /* 2. situation */
  W("## สถานการณ์ล่าสุด");
  const tline=t=>t.rank?`- ${t.short} อันดับ ${t.rank}${t.points!=null?` ${t.points} แต้ม`:""}${t.played?` จาก ${t.played} นัด`:""}${t.gf!=null&&t.ga!=null?` ยิง ${t.gf} เสีย ${t.ga}`:""}${t.form?` ฟอร์มล่าสุด ${t.form} (${formWord(t.form)||"ข้อมูลน้อย"})`:""}`:t.form?`- ${t.short} ฟอร์มล่าสุด ${t.form} (${formWord(t.form)||"ข้อมูลน้อย"})`:`- ${t.short} ฟีดยังไม่มีตารางคะแนนและฟอร์ม`;
  W(tline(m.h), tline(m.a));
  if(m.h.rank&&m.a.rank){ const gap=Math.abs(m.h.rank-m.a.rank); W(gap>=8?`ห่างกัน ${gap} อันดับ ${pk(["คนละระดับบนตาราง","ช่องว่างบนตารางชัดเจน","ระดับทีมต่างกันพอสมควร"],"gap")}`:gap<=2?`อันดับติดกัน ${pk(["เกมนี้มีผลต่อตารางตรง ๆ","แพ้ไม่ได้ทั้งคู่","เป็นเกมแย่งตำแหน่งกันจริง ๆ"],"gap")}`:`ห่างกัน ${gap} อันดับ`); }
  if(m.st==="in"&&m.live) W(`ตอนนี้นาที ${m.live.min} ${m.h.score}–${m.a.score} · ${liveCommentary(m).replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&")}`);
  W("");
  /* 3. news */
  W("## ข่าวทีมและตัวผู้เล่น");
  const nb=[]; const lu=m.ds?.lineup;
  if(lu?.known){ nb.push(`- ตัวจริงประกาศแล้ว`); if(lu.hMiss?.length) nb.push(`- ${H} ไม่มีชื่อ ${lu.hMiss.join(", ")} ในตัวจริง`); if(lu.aMiss?.length) nb.push(`- ${A} ไม่มีชื่อ ${lu.aMiss.join(", ")} ในตัวจริง`); }
  const inj=m.ds?.inj;
  if(inj) for(const [side,t] of [["h",H],["a",A]]){ const L_=inj[side]||[]; if(!L_.length) continue;
    const out_=L_.filter(i=>i.status==="out"), dbt=L_.filter(i=>i.status!=="out"), fmt=i=>`${i.name}${i.detail?` (${i.detail})`:""}`;
    nb.push(`- ${t} บาดเจ็บ/ติดโทษ ${L_.length} คน${out_.length?` · ไม่ได้ลง: ${out_.slice(0,6).map(fmt).join(", ")}`:""}${dbt.length?` · ไม่แน่นอน: ${dbt.slice(0,5).map(fmt).join(", ")}`:""}`); }
  const fi=(m.factors||[]).find(f=>f.k==="injury"); if(fi) nb.push(`- ผลต่อโมเดล: ${H} ${signedPct(fi.h)} · ${A} ${signedPct(fi.a)} ประตูที่คาด`);
  for(const n of newsFor(m)) nb.push(`- ${n.name}${n.team?` (${n.team})`:""}: ${n.status==="out"?"ไม่ได้ลง":n.status==="doubtful"?"ยังไม่แน่ว่าได้ลง":"กลับมาพร้อม"}${n.reason?` · ${n.reason}`:""}${n.d?` · ข่าววันที่ ${n.d}`:""}`);
  const na=S.newsAdj?.[m.id]; if(na?.reason) nb.push(`- ข่าวของวันที่ระบบบันทึกไว้: ${na.reason}`);
  W(...(nb.length?nb:[`- ฟีดยังไม่มีรายชื่อผู้เล่นบาดเจ็บหรือข่าวตัวผู้เล่นของคู่นี้${lu?.known?"":" ตัวจริงมักประกาศราว 1 ชั่วโมงก่อนเตะ เปิดดูอีกครั้งตอนนั้นตัวเลขจะขยับตาม"}`]),"");
  /* 4. stats */
  W("## สถิติที่ต้องรู้");
  const sb=[];
  if(m.meets.length){ const w=m.meets.filter(x=>x.f>x.a).length, d=m.meets.filter(x=>x.f===x.a).length, l=m.meets.length-w-d, avg=m.meets.reduce((s,x)=>s+x.f+x.a,0)/m.meets.length;
    sb.push(`- เจอกัน ${m.meets.length} นัดหลัง ${H} ชนะ ${w} เสมอ ${d} แพ้ ${l} เฉลี่ย ${avg.toFixed(1)} ประตูต่อนัด${(x=>x?` (ล่าสุด ${x.date} ${H} ${x.f}-${x.a})`:"")(m.meets.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0])}`); }
  for(const [t,s] of [[H,m.hs],[A,m.as]]) if(s?.n) sb.push(`- ${t} ${s.n} นัดหลัง ยิง ${s.gf} เสีย ${s.ga} · สูง 2.5 ${s.over} นัด · ยิงทั้งคู่ ${s.btts} นัด · คลีนชีต ${s.clean} · ยิงไม่ได้ ${s.blank}`);
  for(const f of (m.factors||[]).filter(f=>["venue","rest","trend","weather"].includes(f.k))) sb.push(`- ${f.label}: ${f.text}`);
  W(...(sb.length?sb:["- ฟีดยังไม่มีสถิติเชิงลึกของคู่นี้ ตัวเลขด้านล่างคิดจากตารางคะแนนและค่าเฉลี่ยลีก"]),"");
  /* 5. model numbers */
  W("## ตัวเลขจากโมเดล Goal Club",
    `- ผลการแข่งขัน: ${H} ${pct(m.sum.home)} · เสมอ ${pct(m.sum.draw)} · ${A} ${pct(m.sum.away)}`,
    `- ประตูที่คาด: ${H} ${m.lh.toFixed(2)} · ${A} ${m.la.toFixed(2)} (รวม ${tot.toFixed(2)})`,
    `- สูง 2.5 ${pct(m.sum.over25)} · ทั้งสองทีมยิง ${pct(m.sum.btts)} · ครึ่งแรกมีประตู ${pct(m.extra.goal1H)}`,
    `- สกอร์ที่เป็นไปได้มากสุด: ${m.sum.top.slice(0,4).map(c=>`${c.h}-${c.a} (${pct(c.p)})`).join(", ")}`);
  const big=(m.factors||[]).filter(f=>!f.base).map(f=>({f,w:Math.abs(f.h-1)+Math.abs(f.a-1)})).filter(x=>x.w>=.03).sort((a,b)=>b.w-a.w).slice(0,3);
  if(big.length) W(`- ปัจจัยที่ขยับตัวเลขมากสุด: ${big.map(({f})=>`${f.label} (${H} ${signedPct(f.h)} / ${A} ${signedPct(f.a)})`).join(" · ")}`);
  const mw=S.weights?.marketLg?.[m.lg]??S.weights?.market; if(mw!=null&&(m.factors||[]).some(f=>f.k==="market")) W(`- ผสมราคาตลาด ${Math.round(mw*100)}% ตามน้ำหนักที่ระบบเรียนรู้เองของลีกนี้`);
  W("");
  /* 6. game read */
  W("## วิเคราะห์เกม");
  const atk=m.lh>=m.la?H:A, sty=tot>=3.1?pk(["เกมเปิดหน้าแลก มีลุ้นประตูเยอะ","คาดว่าจะเป็นเกมรุกใส่กันสนุก","สองทีมมีของในแดนหน้า เกมไม่น่าจืด"],"st"):tot<=2.2?pk(["เกมน่าจะแน่นกลางสนาม ประตูไม่มาก","คาดว่าจะเป็นเกมรัดกุม เล่นหาจังหวะ","มีแนวโน้มเป็นเกมปิด ใครได้ก่อนได้เปรียบมาก"],"st"):pk(["จังหวะเกมน่าจะอยู่ระดับกลาง","ประตูน่าจะมาแบบพอดี ๆ","เกมไม่ปิดแต่ก็ไม่ได้เปิดสุด"],"st");
  const para=[`${sty} โมเดลมองว่า ${atk} สร้างโอกาสได้มากกว่า (${Math.max(m.lh,m.la).toFixed(2)} ต่อ ${Math.min(m.lh,m.la).toFixed(2)})`];
  const hS=sideStyle(m.hs), aS=sideStyle(m.as); if(hS) para.push(`${H} ${hS}`); if(aS) para.push(`ฝั่ง ${A} ${aS}`);
  const X=m.extra; para.push(`ทีมที่น่าจะได้ประตูแรกคือ ${X.first.h>=X.first.a?H:A} (${pct(Math.max(X.first.h,X.first.a))}) ส่วนครึ่ง/จบที่ออกบ่อยสุดคือ ${HTFT_NAME(m,X.htftTop[0][0])}`);
  const ed=bestEdge(m); if(m.mk) para.push(ed&&ed.edge>=.03?`มุมราคา ตลาด ${m.mk.book} กับโมเดลเห็นต่างชัดสุดที่ ${ed.label} (โมเดล ${pct(ed.model)} ตลาด ${pct(ed.fair)})`:`ราคาตลาด ${m.mk.book} ใกล้กับโมเดล ยังไม่เห็นจุดต่างที่ชัด`);
  if(m.mk?.spread&&L.fav){ const hc=cover(hdpSplit(m.g,m.mk.spread.line)), ahSide=hc>=.5?H:A; if(ahSide!==L.fav) para.push(pk([`แม้ ${L.fav} จะเป็นต่อ แต่ตัวเลขมองว่าราคาต่อที่ตลาดให้ไว้หนักเกินไปนิด ฝั่งรองอย่าง ${ahSide} จึงน่าสนใจกว่าในแง่แฮนดิแคป`,`${L.fav} น่าจะได้ผลดีกว่าก็จริง แต่การชนะห่างตามเส้นต่อไม่ง่าย ตัวเลขเลยเอียงไปทาง ${ahSide}`],"ah")); }
  W(para.join(" "),"");
  /* 7. verdict */
  W("## ทัศนะ");
  const c=bestCall(m), live=m.st==="in"&&m.live, LV=m.live;
  if(live){
    const lf=LV.ph>=LV.pa?H:A, lp=Math.max(LV.ph,LV.pa);
    W(`- ทิศทางเกมตอนนี้: ${lp>=.5?`${lf} คุมเกม ${pct(lp)}`:`ยังเปิด เสมอ ${pct(LV.pd)}`}`,`- ทายสกอร์จบ (สด): ${LV.final.h}-${LV.final.a}`,`- จบสูง 2.5: ${pct(LV.over25)} · มีประตูเพิ่ม ${pct(LV.pMore)}`);
  } else {
    W(`- ทิศทางเกม: ${L.title}`);
    if(m.mk?.spread){ const hc=cover(hdpSplit(m.g,m.mk.spread.line)); W(`- แฮนดิแคป ${ahPhrase(H,A,m.mk.spread.line)}: โมเดลเอียง ${hc>=.5?`${H} ${signed(m.mk.spread.line)}`:`${A} ${signed(-m.mk.spread.line)}`} ครอบเส้น ${pct(Math.max(hc,1-hc))}`); }
    if(m.mk?.total){ const oc=cover(totSplit(m.g,m.mk.total.line).over); W(`- สูงต่ำ ${ballLabel(m.mk.total.line)}: เอน${oc>=.5?"สูง":"ต่ำ"} ${pct(Math.max(oc,1-oc))}`); }
    else W(`- สูงต่ำ 2.5: เอน${m.sum.over25>=.5?"สูง":"ต่ำ"} ${pct(Math.max(m.sum.over25,1-m.sum.over25))}`);
    W(`- ทายสกอร์: ${top.h}-${top.a}`);
  }
  const sl=(m.scorers?.list||[]).filter(p=>!(m.scorers.known&&p.play<1));
  if(sl.length){ const s=sl[0], s2=sl[1]; W(`- ดาวยิงที่น่าจับตา: ${s.name} (${s.team}) ${pct(s.pGoal)}${s2?` · ${s2.name} (${s2.team}) ${pct(s2.pGoal)}`:""}`); }
  if(c&&!live){ const st=starsOf(c.prob); W(`- ตัวเลือกที่ตัวเลขมั่นใจสุด: ${c.label} ${pct(c.prob)} · ความมั่นใจ ${st.txt}`); }
  const rec=pickRecord(30); if(rec.n) W(`- สถิติฟันธงของระบบ 30 วัน: เข้า ${rec.won} จาก ${rec.n} (${pct(rec.won/rec.n)})`);
  const les=(S.lessons?.items||[]).filter(x=>x.startsWith(m.lg+":")); if(les.length) W(`- ระบบเรียนรู้ของลีกนี้: ${les[0].slice(m.lg.length+1).trim()}`);
  if(m.st==="post"&&m.h.score!=null){ const v=verdict(m); if(v){ const n=[v.res.ok,v.ou.ok,v.exact.ok,v.btts.ok,v.hdp?.ok].filter(x=>x===true).length; W(`- ผลจริง ${m.h.score}–${m.a.score}: ระบบทายถูก ${n} จาก ${v.hdp?5:4} ตลาด${v.exact.ok?" รวมสกอร์ตรงเป๊ะ":""}`); } }
  W("");
  /* 8. luck, for fun */
  const lk=scorerLuck(m), tl=teamLuck(m);
  if(lk.best||(tl&&(tl.hs!=null||tl.as!=null))){
    W("## ดวงวันนี้ (เพื่อความสนุก)");
    if(lk.best) W(`- ดาวยิงดวงหนุนสุด: ${lk.best.name} (${lk.best.team}) ทักษาวันแข่งเป็น${lk.best.luck.taksa} ปี${lk.best.luck.animal} ${lk.best.luck.zodiac}`);
    if(tl&&tl.hs!=null&&tl.as!=null) W(`- ภาพรวมดวงทีม: ${Math.abs(tl.hs-tl.as)<.1?"ใกล้เคียงกัน":`${tl.hs>tl.as?H:A} ดวงดีกว่า`}`);
    W("- ดวงใช้อ่านเล่น ไม่ได้ผสมในตัวเลข %","");
  }
  W(`ทัศนะนี้เขียนโดยบอทระบบปิดของ Goal Club ด้วยอัลกอริทึม${MEDUSA.name} จากสถิติในแอปเท่านั้น ใช้ประกอบการดูบอล ไม่ใช่คำแนะนำให้เดิมพัน`);
  return out.join("\n");
}
function signedPct(r){ const v=Math.round((r-1)*100); return (v>0?"+":"")+v+"%"; }
function writeDaily(day){
  const ms=day.matches; if(!ms.length) return null;
  const pk=phraser(S.date), pre=ms.filter(m=>m.st==="pre"), live=ms.filter(m=>m.st==="in"), post=ms.filter(m=>m.st==="post");
  const lgs=new Set(ms.map(m=>m.lg)).size, fav=ms.slice().sort((a,b)=>Math.max(b.sum.home,b.sum.away)-Math.max(a.sum.home,a.sum.away))[0];
  const open=ms.slice().sort((a,b)=>(b.lh+b.la)-(a.lh+a.la))[0], tight=ms.slice().sort((a,b)=>b.sum.draw-a.sum.draw)[0];
  const favSide=m=>m.sum.home>=m.sum.away?m.h.short:m.a.short;
  const parts=[`${relLabel(S.date)}มี ${ms.length} คู่ใน ${lgs} รายการ${live.length?` กำลังแข่ง ${live.length} คู่`:""}${post.length?` จบไปแล้ว ${post.length} คู่`:""}`];
  parts.push(`${pk(["ทีมที่ตัวเลขหนุนแรงสุดคือ","เต็งหนักของวันคือ","ฝั่งที่โมเดลเชื่อมือที่สุดคือ"],"f")} ${favSide(fav)} (${fav.h.short} - ${fav.a.short}) ${pct(Math.max(fav.sum.home,fav.sum.away))}`);
  if(open!==fav) parts.push(`${pk(["คู่ที่น่าจะยิงกันมันส์สุดคือ","เกมเปิดหน้าแลกที่สุดของวันคือ","ถ้าอยากดูประตูต้อง"],"o")} ${open.h.short} - ${open.a.short} คาดรวม ${(open.lh+open.la).toFixed(1)} ประตู`);
  if(tight!==fav&&tight!==open) parts.push(`ส่วน ${tight.h.short} - ${tight.a.short} ${pk(["สูสีสุด ลุ้นเสมอ","เป็นเกมวัดใจ เสมอ","แทบแยกไม่ออก เสมอ"],"t")} ${pct(tight.sum.draw)}`);
  const vals=ms.map(m=>({m,e:bestEdge(m)})).filter(x=>x.e&&x.e.edge>=.04).sort((a,b)=>b.e.edge-a.e.edge);
  const notes=[];
  for(const m of [fav,open,tight].filter((x,i,a)=>a.indexOf(x)===i)) notes.push({match:`${m.h.short} - ${m.a.short}`,text:`${leanOf(m).title} · ทายสกอร์ ${m.sum.top[0].h}-${m.sum.top[0].a} · สูง 2.5 ${pct(m.sum.over25)}`});
  for(const {m,e} of vals.slice(0,2)) if(!notes.some(n=>n.match===`${m.h.short} - ${m.a.short}`)) notes.push({match:`${m.h.short} - ${m.a.short}`,text:`โมเดลมองต่างจากตลาดที่ ${e.label} (${pts(e.edge)} จุด)`});
  if(vals.length) parts.push(`มี ${vals.length} คู่ที่โมเดลกับราคาตลาดเห็นต่างเกิน 4 จุด`);
  const rec=pickRecord(14); if(rec.n) parts.push(`ฟันธง 14 วันหลังเข้า ${rec.won}/${rec.n}`);
  return {summary:parts.join(" · "),notes};
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
const CAL_ICON='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
function paintDates(){
  const show=DATED_TABS.has(S.tab);
  $("#dateRow").hidden=!show; $("#statusRow").hidden=!show; $("#filterPanel").hidden=!show||!S.filterOpen;
  if(!show) return;
  const el=$("#dates");
  const t=bkkToday(); const set=new Set([shiftDate(t,-1),t,shiftDate(t,1),shiftDate(t,2),shiftDate(t,3),S.date]);
  Object.keys(SNAPSHOT||{}).filter(d=>d>=shiftDate(t,-1)).forEach(d=>set.add(d));
  const TH_DAY=["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัส","ศุกร์","เสาร์"];
  const html=[...set].sort().map(d=>{
    const day=S.days[d]||((SNAPSHOT||{})[d]?getDay(d):null); const n=day?.matches?.length||0; const live=day?.matches?.some(m=>m.st==="in");
    const rel=relLabel(d), lbl=dayLabel(d).split(" ").slice(1).join(" ");
    const top=["วันนี้","พรุ่งนี้","เมื่อวาน"].includes(rel)?rel:TH_DAY[weekday(d)];
    return `<button class="dchip ${d===S.date?"on":""}${live?" has-live":""}" role="tab" aria-selected="${d===S.date}" data-date="${d}"><span class="d1">${CAL_ICON}${top}</span><span class="d2 num">${lbl}${n?` · ${n} คู่`:""}</span></button>`;
  }).join("");
  if(el.dataset.html!==html){ el.innerHTML=html; el.dataset.html=html; el.querySelector(".on")?.scrollIntoView({inline:"center",block:"nearest"}); }
  $("#datePick").value=S.date;
  const fb=$("#btnFilter"); fb.setAttribute("aria-expanded",String(S.filterOpen)); fb.querySelector(".fdot").hidden=!(S.league||S.status!=="all");
  if(S.filterOpen){
    const day=getDay(S.date), base=filtered({matches:day.matches}), cnt=k=>base.filter(m=>k==="all"||m.st===k).length;
    $("#filterPanel").innerHTML=seg("status",[["all","ทั้งหมด",cnt("all")],["in","สด",cnt("in")],["pre","ยังไม่เตะ",cnt("pre")],["post","จบแล้ว",cnt("post")]],S.status)+leagueSelect(day);
  }
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
  const t=e.target.closest("#btnFilter,[data-drawer],[data-fav],[data-open],[data-date],[data-set],[data-goto],[data-act],[data-unfav],[data-tab],#btnBrief,#btnBot,#btnBack,#btnSearch,#btnRefresh");
  if(!t) return;
  const d=t.dataset;
  if(t.id==="btnFilter"){ S.filterOpen=!S.filterOpen; return render(); }
  if(d.drawer){ S.drawer[d.drawer]=!S.drawer[d.drawer]; store.set("drawer2",S.drawer); return render(); }
  if(d.act==="picksAll"){ S.picksAll=!S.picksAll; return render(); }
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
  if(t.id==="btnBot") return runBot();
  if(t.id==="btnSearch"){ const r=$("#searchRow"); r.hidden=!r.hidden; if(!r.hidden) $("#q").focus(); else { S.q=""; $("#q").value=""; render(); } return; }
  if(t.id==="btnRefresh"){ S.liveOk=null; return refresh(S.date,true); }
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && S.open) return closeSheet();
  if((e.key==="Enter"||e.key===" ") && e.target.matches?.(".mcard[role=button],.pcard[role=button]")){ e.preventDefault(); openMatch(e.target.dataset.open); }
});
document.addEventListener("input",e=>{
  if(e.target.id==="q"){ clearTimeout(S.qT); S.qT=setTimeout(()=>{ S.q=e.target.value.trim(); render(); },160); }
  if(["cHome","cAway","tOver","tUnder"].includes(e.target.id)) runCalc();
});
document.addEventListener("change",e=>{
  if(e.target.id==="datePick"&&/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) return setDate(e.target.value);
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
