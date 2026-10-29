
/* ---------- embedded snapshot (ESPN feed, saved by the original app) ---------- */
const SNAPSHOT = /*__SNAPSHOT__*/null;

/* ---------- leagues ---------- */
const LEAGUES = [["tha.1","ไทยลีก 1"],["eng.1","พรีเมียร์ลีก"],["esp.1","ลาลีกา"],["ger.1","บุนเดสลีกา"],["ita.1","เซเรียอา"],["fra.1","ลีกเอิง"],["uefa.champions","แชมเปียนส์ลีก"],["uefa.europa","ยูโรปาลีก"],["uefa.europa.conf","คอนเฟอเรนซ์ลีก"],["eng.2","แชมเปียนชิป"],["eng.league_cup","คาราบาวคัพ"],["ned.1","เอเรดิวิซี"],["por.1","ปรีไมราลีกา"],["bel.1","ลีกเบลเยียม"],["sco.1","สกอตติชพรีเมียร์"],["tur.1","ซูเปอร์ลีกตุรกี"],["usa.1","MLS"],["mex.1","ลีกาเอ็มเอ็กซ์"],["bra.1","บราซิลซีรีออา"],["arg.1","ลีกาอาร์เจนตินา"],["ksa.1","ซาอุดีโปรลีก"],["jpn.1","เจลีก"],["chn.1","ซูเปอร์ลีกจีน"],["aus.1","เอลีกออสเตรเลีย"]];
const LEAGUE_NAME = Object.fromEntries(LEAGUES);
const LEAGUE_ORDER = Object.fromEntries(LEAGUES.map(([s],i)=>[s,i]));

/* ---------- storage (per-viewer conveniences only) ---------- */
const store = {
  get(k, d){ try{ const v = localStorage.getItem("gc:"+k); return v==null ? d : JSON.parse(v); }catch{ return d; } },
  set(k, v){ try{ localStorage.setItem("gc:"+k, JSON.stringify(v)); }catch{} }
};

/* ---------- dates (all Thai time) ---------- */
/* "วันนี้" = the feed's match day. ESPN days follow US Eastern time, so a Thai match day runs from late morning
   (11:00 in summer time, 12:00 in winter) to the next late morning, matching how Thai fans read "คืนนี้". */
const bkkToday = () => new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const shiftDate = (iso,n) => { const [y,m,d]=iso.split("-").map(Number); return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10); };
const weekday = iso => { const [y,m,d]=iso.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)).getUTCDay(); };
const dayLabel = iso => { const [y,m,d]=iso.split("-").map(Number); return new Intl.DateTimeFormat("th-TH",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"}).format(new Date(Date.UTC(y,m-1,d))); };
const kickTime = iso => new Intl.DateTimeFormat("th-TH",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit"}).format(new Date(iso));
const stampTime = iso => new Intl.DateTimeFormat("th-TH",{timeZone:"Asia/Bangkok",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(iso));
const bkkDateOf = iso => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso));
const nextSaturday = from => { const add = (6 - weekday(from) + 7) % 7 || 7; return shiftDate(from, add); };
function relLabel(iso){ const t=bkkToday(); if(iso===t) return "วันนี้"; if(iso===shiftDate(t,1)) return "พรุ่งนี้"; if(iso===shiftDate(t,-1)) return "เมื่อวาน"; return dayLabel(iso); }

/* ---------- model: Poisson + Dixon-Coles (rho -0.08) ---------- */
const RHO = -0.08, MAXG = 10;
const clamp = (n,a,b) => Math.min(b, Math.max(a, n));
function formPPG(form){
  const c = (form||"").toUpperCase().replace(/[^WDL]/g,""); if(!c) return null;
  let w=0,s=0; for(let i=0;i<c.length;i++){ const wt=(i+1)/c.length; w += (c[i]==="W"?3:c[i]==="D"?1:0)*wt; s+=wt; } return w/s;
}
function formNudge(form){ const p=formPPG(form); if(p==null) return 1; return clamp(1+((p-1.4)/1.4)*0.12, 0.82, 1.18); }
function formGoals(form){ const p=formPPG(form); if(p==null) return {score:1.28,concede:1.28}; return {score:0.75+(p/3)*1.3, concede:1.85-(p/3)*0.9}; }
const PRIOR = 8;
const shrunk = (count,played,avg) => (count + avg*PRIOR)/(played + PRIOR);
const hasTable = s => s.played!=null && s.played>=3 && s.gf!=null && s.ga!=null;
function baseLambdas(h, a, avg){
  const ht=hasTable(h), at=hasTable(a); avg = avg && avg>0.4 ? avg : null;
  const att = s => clamp(shrunk(s.gf,s.played,avg)/avg,0.4,2.2)*formNudge(s.form);
  const def = s => clamp(shrunk(s.ga,s.played,avg)/avg,0.4,2.2)/formNudge(s.form);
  if(avg && ht && at) return {lh:clamp(att(h)*def(a)*avg*1.18,0.15,4.2), la:clamp(att(a)*def(h)*avg*0.9,0.15,4.2), basis:"table"};
  if(avg && (ht||at)){
    const fo = s => { const f=formGoals(s.form); return {att:clamp(f.score/avg,0.35,2.6), def:clamp(f.concede/avg,0.35,2.6)}; };
    const H = ht ? {att:att(h),def:def(h)} : fo(h), A = at ? {att:att(a),def:def(a)} : fo(a);
    return {lh:clamp(H.att*A.def*avg*1.18,0.15,4.2), la:clamp(A.att*H.def*avg*0.9,0.15,4.2), basis:"blend"};
  }
  const hf=formGoals(h.form), af=formGoals(a.form);
  return {lh:clamp(hf.score*(af.concede/1.28)*1.1,0.15,4.2), la:clamp(af.score*(hf.concede/1.28)*0.92,0.15,4.2), basis:"form"};
}
function pmf(k,l){ let p=Math.exp(-l); for(let i=1;i<=k;i++) p*=l/i; return p; }
function grid(lh,la){
  const g=[]; let s=0;
  for(let h=0;h<=MAXG;h++){ g[h]=[]; for(let a=0;a<=MAXG;a++){
    let p=pmf(h,lh)*pmf(a,la);
    if(h===0&&a===0) p*=1-lh*la*RHO; else if(h===0&&a===1) p*=1+lh*RHO; else if(h===1&&a===0) p*=1+la*RHO; else if(h===1&&a===1) p*=1-RHO;
    g[h][a]=Math.max(0,p); s+=g[h][a]; } }
  for(const r of g) for(let a=0;a<r.length;a++) r[a]/=s;
  return g;
}
function summarize(g){
  let home=0,draw=0,away=0,over=0,btts=0; const cells=[];
  g.forEach((r,h)=>r.forEach((p,a)=>{ if(h>a) home+=p; else if(h===a) draw+=p; else away+=p; if(h+a>=3) over+=p; if(h>0&&a>0) btts+=p; cells.push({h,a,p}); }));
  cells.sort((x,y)=>y.p-x.p);
  return {home,draw,away,over25:over,under25:1-over,btts,top:cells.slice(0,5)};
}
function atomic(line){ const t=Math.round(line*4); const s=t/4; return t%2===0 ? [{line:s,w:1}] : [{line:(t-1)/4,w:.5},{line:(t+1)/4,w:.5}]; }
function hdpSplit(g, homeLine){
  let win=0,push=0,lose=0;
  for(const part of atomic(homeLine)){ g.forEach((r,h)=>r.forEach((p,a)=>{ const m=h+part.line-a; if(m>1e-9) win+=p*part.w; else if(m<-1e-9) lose+=p*part.w; else push+=p*part.w; })); }
  return {win,push,lose};
}
function totSplit(g, line){
  let over=0,push=0,under=0;
  for(const part of atomic(line)){ g.forEach((r,h)=>r.forEach((p,a)=>{ const t=h+a; if(t>part.line+1e-9) over+=p*part.w; else if(t<part.line-1e-9) under+=p*part.w; else push+=p*part.w; })); }
  return {over:{win:over,push,lose:under}, under:{win:under,push,lose:over}};
}
const cover = s => (s.win+s.lose)>0 ? s.win/(s.win+s.lose) : .5;
function devig(ds){ if(ds.some(d=>!(d>1.01))) return null; const imp=ds.map(d=>1/d), s=imp.reduce((x,y)=>x+y,0); return imp.map(v=>v/s); }
const VALUE_EDGE = 0.04;

/* Thai handicap wording */
const BALL = {"0.25":"0/0.5","0.5":"0.5","0.75":"0.5/1","1":"1","1.25":"1/1.5","1.5":"1.5","1.75":"1.5/2","2":"2","2.25":"2/2.5","2.5":"2.5","2.75":"2.5/3","3":"3","3.25":"3/3.5","3.5":"3.5","3.75":"3.5/4","4":"4"};
const ballLabel = x => { const k=String(Math.round(Math.abs(x)*4)/4); return BALL[k] ?? k; };
const ahPhrase = (home,away,homeLine) => { const abs=Math.round(Math.abs(homeLine)*4)/4; if(abs<0.01) return "เสมอ (ไม่มีต่อ)"; return homeLine<0 ? `${home} ต่อ ${ballLabel(abs)}` : `${away} ต่อ ${ballLabel(abs)}`; };

/* price formats */
const PRICE_STYLES = {decimal:"ทศนิยม (ยุโรป)", malay:"มาเลย์", hongkong:"ฮ่องกง"};
function fmtPrice(dec, style){
  if(!(dec>1.01)) return "–";
  if(style==="hongkong") return (dec-1).toFixed(2);
  if(style==="malay"){ const m = dec>=2 ? -(1/(dec-1)) : dec-1; return (m<0?"-":"")+Math.abs(m).toFixed(2); }
  return dec.toFixed(2);
}
function toDecimal(raw, style){
  if(!Number.isFinite(raw) || raw===0) return null;
  if(style==="decimal") return raw>1.01 ? raw : null;
  if(style==="hongkong") return raw>0 ? raw+1 : null;
  if(raw>0 && raw<=1) return 1+raw;
  if(raw<0 && raw>=-1) return 1+1/Math.abs(raw);
  return null;
}
const pct = n => `${Math.round(n*100)}%`;
const pts = e => { const r=Math.round(e*1000)/10; return (r>0?"+":"")+r.toFixed(1); };

/* ---------- match refinement (the spec's two blends only) ---------- */
function linesStats(lines){
  const rows=(lines||[]).map(s=>s.split("-").map(Number)).filter(x=>x.length===2&&x.every(Number.isFinite));
  if(!rows.length) return null;
  const n=rows.length, c=f=>rows.filter(f).length;
  return {n, gf:rows.reduce((s,r)=>s+r[0],0), ga:rows.reduce((s,r)=>s+r[1],0),
    btts:c(r=>r[0]>0&&r[1]>0), over:c(r=>r[0]+r[1]>=3), clean:c(r=>r[1]===0), blank:c(r=>r[0]===0)};
}
function meetingsFor(m){
  return (m.ds?.meet||[]).map(([date,hid,aid,hs,as])=>{
    if(hid===m.h.id) return {date,f:hs,a:as,venueHome:true};
    if(aid===m.h.id) return {date,f:as,a:hs,venueHome:false};
    return null;
  }).filter(Boolean);
}
function refine(m){
  /* Each factor records how it moves the expected goals (λ) of each side, so the page can show its work. */
  const steps=[], factors=[];
  let lh=m.lh, la=m.la, basis=m.basis;
  if(lh==null||la==null){ const b=baseLambdas(m.h,m.a,null); lh=b.lh; la=b.la; basis=b.basis; }
  /* every factor's push can be strengthened or weakened by the daily job (weights.factors[k]); raw ratios are kept so the job can re-tune */
  const push=(k,label,text,bh,ba)=>{
    const fh=lh/bh, fa=la/ba, st=k==="market"?1:(S?.weights?.factors?.[k]??1);
    if(st!==1){ lh=clamp(bh*fh**st,0.15,4.2); la=clamp(ba*fa**st,0.15,4.2); }
    factors.push({k,label,text:st!==1?`${text} · น้ำหนักปรับเอง ×${st}`:text,h:lh/bh,a:la/ba,rh:fh,ra:fa,st}); steps.push({k,text:`${label}: ${text}`,lh,la}); };
  steps.push({k:"base", text: basis==="table"?"ตารางคะแนน: อัตรายิง/เสียหดเข้าค่าเฉลี่ยลีกด้วย prior 8 นัด แล้วขยับด้วยฟอร์มล่าสุด":basis==="blend"?"ตารางคะแนน: มีครบทีมเดียว อีกทีมใช้ฟอร์ม 5 นัด":"ฟอร์ม: ตารางยังไม่พอ ใช้ผล 5 นัดหลัง", lh, la});
  factors.push({k:"base",label:basis==="form"?"ฟอร์ม 5 นัด":"ตารางคะแนนและฟอร์ม",text:`เริ่มที่ ${lh.toFixed(2)} – ${la.toFixed(2)} ประตูที่คาด`,h:1,a:1,base:true});
  const bH=lh, bA=la;
  const meets=meetingsFor(m);
  if(meets.length>=3){
    const bh=lh, ba=la, hf=meets.reduce((s,x)=>s+x.f,0)/meets.length, af=meets.reduce((s,x)=>s+x.a,0)/meets.length;
    lh=clamp(lh*.82+hf*.18,0.15,4.2); la=clamp(la*.82+af*.18,0.15,4.2); basis="h2h";
    push("h2h","ผลที่เคยเจอกัน",`${meets.length} นัด ยิงเฉลี่ย ${hf.toFixed(1)}–${af.toFixed(1)} ผสม 18%`,bh,ba);
  }
  const hs=linesStats(m.ds?.hf?.lines), as=linesStats(m.ds?.af?.lines);
  if(hs&&as&&hs.n>=3&&as.n>=3){
    const bh=lh, ba=la, tH=(hs.gf/hs.n + as.ga/as.n)/2, tA=(as.gf/as.n + hs.ga/hs.n)/2;
    lh=clamp(lh*.7+tH*.3,0.15,4.2); la=clamp(la*.7+tA*.3,0.15,4.2);
    push("pace","เกมรุก-รับ 5 นัดหลัง",`${m.h.short} ยิง ${(hs.gf/hs.n).toFixed(1)} เสีย ${(hs.ga/hs.n).toFixed(1)} · ${m.a.short} ยิง ${(as.gf/as.n).toFixed(1)} เสีย ${(as.ga/as.n).toFixed(1)} ต่อเกม ผสม 30%`,bh,ba);
  }
  /* home form at home, away form on the road */
  const hv=venueSplit(m.ds?.hf,"H"), av=venueSplit(m.ds?.af,"A");
  if(hv&&av){
    const bh=lh, ba=la;
    lh=clamp(lh*.88+((hv.gf/hv.n+av.ga/av.n)/2)*.12,0.15,4.2); la=clamp(la*.88+((av.gf/av.n+hv.ga/hv.n)/2)*.12,0.15,4.2);
    push("venue","ฟอร์มในบ้าน/นอกบ้าน",`${m.h.short} ในบ้าน ${hv.n} นัด ยิง ${(hv.gf/hv.n).toFixed(1)} · ${m.a.short} นอกบ้าน ${av.n} นัด ยิง ${(av.gf/av.n).toFixed(1)} ผสม 12%`,bh,ba);
  }
  /* rest days since each team's last match */
  const rh=restDays(m.ds?.hf,m.ko), ra=restDays(m.ds?.af,m.ko);
  if(rh!=null&&ra!=null){
    const bh=lh, ba=la;
    if(rh<=3&&ra>=5){ lh=clamp(lh*.95,0.15,4.2); la=clamp(la*1.03,0.15,4.2); }
    else if(ra<=3&&rh>=5){ la=clamp(la*.95,0.15,4.2); lh=clamp(lh*1.03,0.15,4.2); }
    push("rest","วันพักและความล้า",`${m.h.short} พัก ${rh} วัน · ${m.a.short} พัก ${ra} วัน${(rh<=3&&ra>=5)||(ra<=3&&rh>=5)?" ทีมที่พักน้อยถูกลดประตูที่คาด":" ไม่ต่างพอให้ปรับ"}`,bh,ba);
  }
  /* confirmed line-ups: a leading scorer missing from the XI */
  const lu=m.ds?.lineup;
  if(lu?.known){
    const bh=lh, ba=la;
    lh=clamp(lh*(1-.06*Math.min(2,lu.hMiss.length)),0.15,4.2); la=clamp(la*(1-.06*Math.min(2,lu.aMiss.length)),0.15,4.2);
    const miss=[...lu.hMiss.map(n=>`${n} (${m.h.short})`),...lu.aMiss.map(n=>`${n} (${m.a.short})`)];
    push("lineup","ตัวจริงที่ประกาศ",miss.length?`ดาวยิงไม่อยู่ใน 11 ตัวจริง: ${miss.join(", ")}`:"ดาวยิงหลักของทั้งสองทีมลงตัวจริงครบ",bh,ba);
  }
  /* weather and altitude at the ground */
  const wx=S?.ext?.[m.id]?.wx;
  if(wx){
    const bh=lh, ba=la; const notes=[];
    if(wx.rain>=4||wx.wind>=40){ lh*=.94; la*=.94; notes.push(wx.rain>=4?`ฝน ${wx.rain} มม./ชม.`:`ลม ${Math.round(wx.wind)} กม./ชม.`); }
    if(wx.temp>=30){ lh*=.97; la*=.97; notes.push(`ร้อน ${Math.round(wx.temp)}°C`); }
    if(wx.elev>=1500){ lh*=1.05; la*=.95; notes.push(`สนามสูง ${Math.round(wx.elev)} ม. เจ้าบ้านคุ้นกว่า`); }
    lh=clamp(lh,0.15,4.2); la=clamp(la,0.15,4.2);
    push("weather","สภาพอากาศและสนาม",`${Math.round(wx.temp)}°C ฝน ${wx.rain} มม. ลม ${Math.round(wx.wind)} กม./ชม.${notes.length?" · ปรับเพราะ "+notes.join(", "):" · ไม่หนักพอให้ปรับ"}`,bh,ba);
  }
  /* news: confirmed absences named in today's headlines (from the daily brief) */
  const na=S?.newsAdj?.[m.id];
  if(na){
    const bh=lh, ba=la;
    lh=clamp(lh*(1+clamp(na.h||0,-.05,.03)),0.15,4.2); la=clamp(la*(1+clamp(na.a||0,-.05,.03)),0.15,4.2);
    push("news","ข่าววันนี้",na.reason||"มีข่าวตัวผู้เล่นที่กระทบทีม",bh,ba);
  }
  /* news from the last 3 days carried to this match, fading each day */
  if(!na){
    const age=d=>Math.max(0,Math.round((Date.parse(m.ko)-Date.parse(d))/864e5));
    const pick=id=>{ const n=S?.newsTeam?.[id]; if(!n) return null; const a=age(n.d); return a<=3?{e:n.e*(1-a/4),reason:n.reason,a}:null; };
    const nh=pick(m.h.id), nA=pick(m.a.id);
    if(nh||nA){
      const bh=lh, ba=la;
      if(nh) lh=clamp(lh*(1+nh.e),0.15,4.2); if(nA) la=clamp(la*(1+nA.e),0.15,4.2);
      push("newsOld","ข่าวที่ผ่านมา",[nh?`${m.h.short}: ${nh.reason} (${nh.a} วันก่อน)`:"",nA?`${m.a.short}: ${nA.reason} (${nA.a} วันก่อน)`:""].filter(Boolean).join(" · "),bh,ba);
    }
  }
  /* league trend: goals per game over the last 14 days vs the season so far */
  const tr=S?.trends?.[m.lg];
  if(tr?.gpg&&tr.n>=8&&m.lgAvg){
    const bh=lh, ba=la, ratio=tr.gpg/(m.lgAvg*2), k=clamp(1+(ratio-1)*.5*tr.n/(tr.n+20),.92,1.08);
    lh=clamp(lh*k,0.15,4.2); la=clamp(la*k,0.15,4.2);
    push("trend","แนวโน้มลีก 14 วัน",`${tr.n} นัดหลังสุดเฉลี่ย ${tr.gpg.toFixed(2)} ประตู เทียบทั้งฤดูกาล ${(m.lgAvg*2).toFixed(2)}`,bh,ba);
  }
  /* team strength learned from every finished match (daily job): attack/defence ratings */
  const RH=S?.ratings?.[m.h.id], RA=S?.ratings?.[m.a.id], avg=S?.lgavg?.[m.lg];
  if(RH&&RA&&RH.n>=6&&RA.n>=6){
    const mu=avg>0.4?avg:1.35, rlh=mu*1.12*RH.att*RA.def, rla=mu/1.12*RA.att*RH.def, W=Math.min(.3,.12+(Math.min(RH.n,RA.n)-6)*.01);
    const bh=lh, ba=la; lh=clamp(Math.exp(Math.log(lh)*(1-W)+Math.log(rlh)*W),0.15,4.2); la=clamp(Math.exp(Math.log(la)*(1-W)+Math.log(rla)*W),0.15,4.2);
    push("rating","ความแข็งของทีม (เรียนรู้ทุกวัน)",`เกมรุก/รับ ${m.h.short} ${RH.att.toFixed(2)}/${RH.def.toFixed(2)} · ${m.a.short} ${RA.att.toFixed(2)}/${RA.def.toFixed(2)} จาก ${RH.n}/${RA.n} นัดที่บันทึก → ${rlh.toFixed(2)}–${rla.toFixed(2)} ผสม ${Math.round(W*100)}%`,bh,ba);
  }
  /* learned from this app's own past predictions vs real scores */
  const lh0=lh, la0=la;
  const cal=S?.calib?.[m.lg]?.n>=10?S.calib[m.lg]:S?.calib?._all?.n>=30?S.calib._all:null;
  if(cal){
    const bh=lh, ba=la; lh=clamp(lh*cal.hAdj,0.15,4.2); la=clamp(la*cal.aAdj,0.15,4.2);
    push("calib","เรียนรู้จากผลที่ผ่านมา",`เทียบที่ทำนายไว้กับสกอร์จริง ${cal.n} นัด${cal===S.calib._all?" (รวมทุกลีก)":` ใน${LEAGUE_NAME[m.lg]||"ลีกนี้"}`} เจ้าบ้านยิงจริง ${Math.round((cal.hs/cal.lh)*100)}% ของที่คาด ทีมเยือน ${Math.round((cal.as/cal.la)*100)}%`,bh,ba);
  }
  /* market: blend in the expected goals implied by DraftKings prices (bookmaker prices carry
     information the stats miss: injuries, rotation, motivation). Weight 35%, geometric blend. */
  const pH=lh, pA=la;
  const mkt=marketLambdas(m, lh+la);
  if(mkt){
    const bh=lh, ba=la, W=S?.weights?.marketLg?.[m.lg]??S?.weights?.market??.35;
    lh=clamp(Math.exp(Math.log(lh)*(1-W)+Math.log(mkt.lh)*W),0.15,4.2); la=clamp(Math.exp(Math.log(la)*(1-W)+Math.log(mkt.la)*W),0.15,4.2);
    push("market","ราคาตลาด",`ราคา ${m.mk.book} บอกประตูที่คาด ${mkt.lh.toFixed(2)} – ${mkt.la.toFixed(2)}${mkt.fromTotal?"":" (ไม่มีเส้นสูงต่ำ ใช้ผลรวมจากโมเดล)"} ผสม ${Math.round(W*100)}%${S?.weights?.n?` (ปรับเองจากผลจริง ${S.weights.n} นัด)`:""}`,bh,ba);
  }
  const g=grid(lh,la), sum=summarize(g);
  const out={...m, raw:m.raw||m, lh, la, lh0, la0, pH, pA, bH, bA, mkt, basis, g, sum, steps, factors, hs, as, meets};
  out.live=liveModel(out); out.extra=extraMarkets(out); out.scorers=scorerModel(out);
  return out;
}

/* ---------- market-implied expected goals: fit (λh, λa) to de-vigged 1X2 (+ total line) ---------- */
function marketLambdas(m, modelTotal){
  const mk=m.mk; if(!mk?.home||!mk?.draw||!mk?.away) return null;
  const f=devig([mk.home.decimal,mk.draw.decimal,mk.away.decimal]); if(!f) return null;
  let tOver=null, tLine=null;
  if(mk.total){ const t=devig([mk.total.over.decimal,mk.total.under.decimal]); if(t){ tOver=t[0]; tLine=mk.total.line; } }
  const pm=l=>{ const v=[]; let p=Math.exp(-l); for(let k=0;k<=9;k++){ v.push(p); p*=l/(k+1); } return v; };
  const cache=new Map(); const P=l=>{ const k=l.toFixed(3); if(!cache.has(k)) cache.set(k,pm(l)); return cache.get(k); };
  const err=(h,a)=>{
    if(tOver==null && Math.abs(h+a-modelTotal)>.1) return 9;
    const x=P(h), y=P(a); let ph=0,pd=0,pa=0; const tot=Array(19).fill(0);
    for(let i=0;i<10;i++) for(let j=0;j<10;j++){ const p=x[i]*y[j]; if(i>j) ph+=p; else if(i===j) pd+=p; else pa+=p; tot[i+j]+=p; }
    let e=(ph-f[0])**2+(pd-f[1])**2+(pa-f[2])**2;
    if(tOver!=null){ let w=0,l=0; for(const part of atomic(tLine)) tot.forEach((p,t)=>{ if(t>part.line+1e-9) w+=p*part.w; else if(t<part.line-1e-9) l+=p*part.w; }); e+=(((w+l)>0?w/(w+l):.5)-tOver)**2; }
    return e;
  };
  let best={e:9,lh:1,la:1};
  for(let h=.2;h<=3.6;h+=.1) for(let a=.2;a<=3.6;a+=.1){ const e=err(h,a); if(e<best.e) best={e,lh:h,la:a}; }
  const c=best; for(let h=c.lh-.1;h<=c.lh+.1;h+=.02) for(let a=c.la-.1;a<=c.la+.1;a+=.02){ if(h<.1||a<.1) continue; const e=err(h,a); if(e<best.e) best={e,lh:h,la:a}; }
  return best.e<.01 ? {lh:best.lh, la:best.la, fromTotal:tOver!=null} : null;
}

/* ---------- in-play stats: shots, shots on target, possession, red cards (from scoreboard or summary) ---------- */
function statMap(list){ const o={}; for(const x of list||[]){ const k=String(x.name||x.label||"").toLowerCase().replace(/[^a-z]/g,""); const v=parseFloat(String(x.displayValue??x.value??"").replace("%","")); if(k&&Number.isFinite(v)) o[k]=v; } return o; }
function liveStatsOf(comps, details, H, A){
  const pick=t=>{ const o=statMap(t?.statistics); return {shots:o.totalshots??o.shots??null, sot:o.shotsontarget??o.ontargetshots??null, poss:o.possessionpct??o.possession??null, corners:o.woncorners??o.cornerkicks??null, red:0}; };
  const h=pick(H), a=pick(A);
  for(const d of details||[]){ if(d.redCard||/red card/i.test(d.type?.text||"")){ const tid=String(d.team?.id??""); if(tid===String(H?.team?.id)) h.red++; else if(tid===String(A?.team?.id)) a.red++; } }
  const any=[h.shots,h.sot,h.poss,a.shots,a.sot,a.poss].some(v=>v!=null)||h.red||a.red;
  return any?{h,a}:null;
}
function liveStatsFromSummary(p){
  const T=p?.boxscore?.teams||[]; const H=T.find(t=>t.homeAway==="home")||T[0], A=T.find(t=>t.homeAway==="away")||T[1]; if(!H||!A) return null;
  const pick=t=>{ const o=statMap(t.statistics); return {shots:o.totalshots??o.shots??null, sot:o.shotsontarget??null, poss:o.possessionpct??null, corners:o.woncorners??null, red:o.redcards??0}; };
  return {h:pick(H), a:pick(A)};
}

/* ---------- in-play: remaining expected goals on top of the current score ---------- */
function matchMinute(m){
  if(m.st!=="in") return null;
  const c=String(m.clock||"");
  if(/พัก|HT/i.test(c)) return 45;
  const n=c.match(/(\d+)(?:'|\+|$)/); const add=c.match(/\+(\d+)/);
  return n ? Math.min(120, Number(n[1])+(add?Number(add[1]):0)) : null;
}
function liveModel(m){
  const min=matchMinute(m); if(min==null||m.h.score==null) return null;
  const left=Math.max(0,(94-min)/94);
  let rh=m.lh*left, ra=m.la*left; const notes=[];
  /* momentum: who is creating more than the pre-match model expected (shots on target, then shots) */
  const L=m.ls||m.raw?.ls||m.ds?.ls;
  if(L){
    const expShare=m.lh/(m.lh+m.la), k=Math.min(1,min/60)*.5;
    const sh=(L.h.sot!=null&&L.a.sot!=null&&L.h.sot+L.a.sot>=3)?{x:L.h.sot,y:L.a.sot,n:"ยิงเข้ากรอบ"}:(L.h.shots!=null&&L.a.shots!=null&&L.h.shots+L.a.shots>=6)?{x:L.h.shots,y:L.a.shots,n:"ยิง"}:null;
    if(sh){
      const obs=(sh.x+1)/(sh.x+sh.y+2), mh=clamp((obs/expShare)**k,.7,1.4), ma=clamp(((1-obs)/(1-expShare))**k,.7,1.4);
      rh*=mh; ra*=ma;
      if(Math.abs(mh-1)>.05||Math.abs(ma-1)>.05) notes.push(`${sh.n} ${sh.x}–${sh.y} ${mh>ma?m.h.short:m.a.short}คุมเกมกว่าที่คาด ขยับโอกาสยิงที่เหลือ ${m.h.short} ${mh>1?"+":""}${Math.round((mh-1)*100)}% ${m.a.short} ${ma>1?"+":""}${Math.round((ma-1)*100)}%`);
    }
    if(L.h.red||L.a.red){
      const d=(L.h.red||0)-(L.a.red||0);
      if(d>0){ rh*=.7; ra*=1.25; notes.push(`${m.h.short} โดนใบแดง ${L.h.red} ใบ เหลือคนน้อยกว่า`); }
      if(d<0){ ra*=.7; rh*=1.25; notes.push(`${m.a.short} โดนใบแดง ${L.a.red} ใบ เหลือคนน้อยกว่า`); }
    }
    if(L.h.poss!=null&&L.a.poss!=null) notes.push(`ครองบอล ${Math.round(L.h.poss)}–${Math.round(L.a.poss)}%`);
  }
  /* late game: a trailing side pushes, the leader sits back */
  if(min>=70&&m.h.score!==m.a.score){ const lead=m.h.score>m.a.score?"h":"a"; if(lead==="h"){ ra*=1.1; rh*=.95; } else { rh*=1.1; ra*=.95; } }
  const g=grid(Math.max(.01,rh),Math.max(.01,ra));
  let ph=0,pd=0,pa=0,over=0; const cells=[];
  g.forEach((r,i)=>r.forEach((p,j)=>{ const H=m.h.score+i, A=m.a.score+j; if(H>A) ph+=p; else if(H===A) pd+=p; else pa+=p; if(H+A>=3) over+=p; cells.push({h:H,a:A,p}); }));
  cells.sort((a,b)=>b.p-a.p);
  const pMore=1-g[0][0], next={h:pMore*rh/(rh+ra), a:pMore*ra/(rh+ra)};
  return {min, ph, pd, pa, final:cells[0], top:cells.slice(0,4), pMore, over25:over, next, rh, ra, notes, stats:L||null};
}

/* ---------- extra markets from the same expected goals ---------- */
function extraMarkets(m){
  const H1=.45, lh=m.lh, la=m.la;
  const pois=(k,l)=>{ let p=Math.exp(-l); for(let i=1;i<=k;i++) p*=l/i; return p; };
  const res=(lH,lA)=>{ let h=0,d=0,a=0; for(let i=0;i<=8;i++) for(let j=0;j<=8;j++){ const p=pois(i,lH)*pois(j,lA); if(i>j) h+=p; else if(i===j) d+=p; else a+=p; } return {h,d,a}; };
  // half-time / full-time: first-half goals then second-half goals, independent Poisson
  const ht=[], htft={};
  for(let i=0;i<=6;i++) for(let j=0;j<=6;j++) ht.push({i,j,p:pois(i,lh*H1)*pois(j,la*H1)});
  for(const x of ht){
    const hs=x.i>x.j?"h":x.i===x.j?"d":"a";
    for(let k=0;k<=6;k++) for(let l=0;l<=6;l++){ const p=x.p*pois(k,lh*(1-H1))*pois(l,la*(1-H1)); const H=x.i+k, A=x.j+l; const fs=H>A?"h":H===A?"d":"a"; htft[hs+fs]=(htft[hs+fs]||0)+p; }
  }
  const htftTop=Object.entries(htft).sort((a,b)=>b[1]-a[1]).slice(0,3);
  const p00=m.g[0][0];
  const first={h:(1-p00)*lh/(lh+la), a:(1-p00)*la/(lh+la), none:p00};
  let cleanH=0, cleanA=0, nilH=0, nilA=0, odd=0; const margin={};
  m.g.forEach((r,i)=>r.forEach((p,j)=>{ if(j===0) cleanH+=p; if(i===0) cleanA+=p; if(i>j&&j===0) nilH+=p; if(j>i&&i===0) nilA+=p; if((i+j)%2) odd+=p; const d=i-j; const k=d>=3?"h3":d===2?"h2":d===1?"h1":d===0?"d":d===-1?"a1":d===-2?"a2":"a3"; margin[k]=(margin[k]||0)+p; }));
  return {
    h1:res(lh*H1,la*H1), goal1H:1-Math.exp(-(lh+la)*H1), goal2H:1-Math.exp(-(lh+la)*(1-H1)),
    first, cleanH, cleanA, nilH, nilA, odd, even:1-odd, margin, htftTop,
    over15:m.g.reduce((s,r,i)=>s+r.reduce((t,p,j)=>t+(i+j>=2?p:0),0),0),
    over35:m.g.reduce((s,r,i)=>s+r.reduce((t,p,j)=>t+(i+j>=4?p:0),0),0)
  };
}

/* ---------- scorers and assisters: each player's share of his team's season goals ---------- */
function scorerModel(m){
  const ps=m.ds?.players||[]; if(!ps.length) return null;
  const sideOf=p=>p.side||(String(p.team||"").toLowerCase()===m.h.name.toLowerCase()?"h":String(p.team||"").toLowerCase()===m.a.name.toLowerCase()?"a":null);
  const starters=new Set(m.ds?.lineup?.starters||[]); const known=!!m.ds?.lineup?.known;
  const teamGoals=s=>{ const t=s==="h"?m.h:m.a; const fromTable=t.gf; const fromList=ps.filter(p=>sideOf(p)===s).reduce((a,p)=>a+(p.goals||0),0); return Math.max(fromTable||0, fromList*1.6, 1); };
  const out=[];
  for(const p of ps){
    const s=sideOf(p); if(!s) continue;
    const lam=s==="h"?m.lh:m.la, tg=teamGoals(s);
    let play = known ? (p.id&&starters.has(String(p.id))?1:.25) : .85;
    const nw=S?.newsPlayer?.[String(p.name||"").toLowerCase()];
    const fresh_=nw&&(Date.parse(m.ko)-Date.parse(nw.d))/864e5<=7;
    if(fresh_&&!known){ if(nw.status==="out") play=.05; else if(nw.status==="doubtful") play=.5; }
    const gShare=clamp((p.goals||0)/tg,0,.6), aShare=clamp((p.assists||0)/tg,0,.5);
    let xg=lam*gShare*play, xa=lam*aShare*play;
    const rec=p.id?S?.players?.[p.id]:null;
    if(rec&&rec.apps>=3){ xg=.5*xg+.5*(rec.g/rec.apps)*play; xa=.5*xa+.5*(rec.a/rec.apps)*play; }
    out.push({name:p.name, side:s, team:s==="h"?m.h.short:m.a.short, goals:p.goals, assists:p.assists, play, news:fresh_?nw:null,
      pGoal:1-Math.exp(-xg), pAssist:1-Math.exp(-xa), pFirst:(s==="h"?m.extra?.first?.h:m.extra?.first?.a)??0, xg, xa, gShare});
  }
  out.forEach(o=>{ o.pFirst = (o.side==="h"?(1-m.g[0][0])*m.lh/(m.lh+m.la):(1-m.g[0][0])*m.la/(m.lh+m.la))*o.gShare*o.play; });
  out.sort((a,b)=>b.pGoal-a.pGoal);
  /* story for the most likely scoreline: hand the predicted goals to the likeliest scorers */
  const top=m.sum.top[0], story={h:[],a:[]};
  for(const s of ["h","a"]){
    const n=s==="h"?top.h:top.a; const pool=out.filter(o=>o.side===s&&o.xg>0).map(o=>({...o,left:o.xg}));
    for(let k=0;k<n;k++){
      pool.sort((a,b)=>b.left-a.left); const pick=pool[0];
      if(!pick||pick.left<.05){ story[s].push({name:"ผู้เล่นคนอื่น"}); continue; }
      const helper=out.filter(o=>o.side===s&&o.name!==pick.name&&o.xa>0).sort((a,b)=>b.xa-a.xa)[k%2]||null;
      story[s].push({name:pick.name, assist:helper?.name||null}); pick.left/=2.2;
    }
  }
  return {list:out, story, known};
}
function venueSplit(f, side){
  if(!f?.ha?.length) return null;
  const rows=(f.lines||[]).map((s,i)=>({s:s.split("-").map(Number),v:f.ha[i]})).filter(r=>r.v===side&&r.s.every(Number.isFinite));
  if(rows.length<2) return null;
  return {n:rows.length, gf:rows.reduce((a,r)=>a+r.s[0],0), ga:rows.reduce((a,r)=>a+r.s[1],0)};
}
function restDays(f, ko){
  const d=f?.dates?.[0]; if(!d) return null;
  const days=Math.floor((Date.parse(ko)-Date.parse(d))/864e5);
  return days>0&&days<40?days:null;
}

/* market rows: model vs de-vigged market */
function edgeRows(m){
  if(m._rows) return m._rows;
  const rows=computeRows(m); Object.defineProperty(m,"_rows",{value:rows,enumerable:false}); return rows;
}
function computeRows(m){
  const mk=m.mk, rows=[]; if(!mk) return rows;
  if(mk.home&&mk.draw&&mk.away){
    const fair=devig([mk.home.decimal,mk.draw.decimal,mk.away.decimal]);
    [["1x2-h",`${m.h.short} ชนะ`,m.sum.home,mk.home],["1x2-d","เสมอ",m.sum.draw,mk.draw],["1x2-a",`${m.a.short} ชนะ`,m.sum.away,mk.away]]
      .forEach(([key,label,model,price],i)=>rows.push({key,kind:"1x2",label,model,fair:fair?.[i]??null,edge:fair?model-fair[i]:null,dec:price.decimal}));
  }
  if(mk.spread){
    const s=hdpSplit(m.g,mk.spread.line), aw={win:s.lose,lose:s.win,push:s.push};
    const f=devig([mk.spread.home.decimal,mk.spread.away.decimal]);
    rows.push({key:"ah-h",kind:"ah",label:`${m.h.short} ${signed(mk.spread.line)}`,model:cover(s),fair:f?.[0]??null,edge:f?cover(s)-f[0]:null,dec:mk.spread.home.decimal,split:s});
    rows.push({key:"ah-a",kind:"ah",label:`${m.a.short} ${signed(-mk.spread.line)}`,model:cover(aw),fair:f?.[1]??null,edge:f?cover(aw)-f[1]:null,dec:mk.spread.away.decimal,split:aw});
  }
  if(mk.total){
    const t=totSplit(m.g,mk.total.line), f=devig([mk.total.over.decimal,mk.total.under.decimal]);
    rows.push({key:"ou-o",kind:"ou",label:`สูง ${ballLabel(mk.total.line)}`,model:cover(t.over),fair:f?.[0]??null,edge:f?cover(t.over)-f[0]:null,dec:mk.total.over.decimal});
    rows.push({key:"ou-u",kind:"ou",label:`ต่ำ ${ballLabel(mk.total.line)}`,model:cover(t.under),fair:f?.[1]??null,edge:f?cover(t.under)-f[1]:null,dec:mk.total.under.decimal});
  }
  return rows;
}
function signed(line){ const s=Math.round(line*4)/4; if(Math.abs(s)<.01) return "0"; return (s>0?"+":"-")+ballLabel(Math.abs(s)); }
function bestEdge(m){ return edgeRows(m).filter(r=>r.edge!=null).sort((a,b)=>b.edge-a.edge)[0]||null; }

/* picks: up to 5 market AH lines where the model is most confident */
/* ---------- shared store: one data set for every device (hosted site with Upstash Redis) ---------- */
const Shared={on:false, picks:{}, pickHist:[], histN:0, pulled:{}};
async function syncPull(date){
  if(window.claude || S.liveOk===false) return false;
  try{
    const day=S.days[date]; const teams=[...new Set((day?.matches||[]).flatMap(m=>[m.h.id,m.a.id]))].filter(Boolean).slice(0,200).join(",");
    const j=await getJson(`/api/store?date=${date}${teams?`&teams=${teams}`:""}`,8000);
    if(!j?.enabled) return false;
    Shared.on=true; Shared.picks[date]=j.picks||{}; Shared.pickHist=j.pickHist||[]; Shared.histN=j.histN||0; Shared.pulled[date]=Date.now();
    if(j.calib) S.calib=j.calib;
    if(j.newsPlayer) S.newsPlayer=j.newsPlayer; if(j.lessons) S.lessons=j.lessons;
    S.ratings={...(S.ratings||{}),...(j.ratings||{})}; S.lgavg={...(S.lgavg||{}),...(j.lgavg||{})}; if(j.weights) S.weights=j.weights; if(j.evals) S.evals=j.evals;
    if(day?.matches?.length) S.days[date]=prepare({...day,matches:day.matches.map(x=>x.raw||x)});
    if(j.newsTeam){ S.newsTeam={...S.newsTeam,...j.newsTeam}; }
    if(j.brief && (!store.get("brief:"+date,null) || store.get("brief:"+date).at < j.brief.at)) store.set("brief:"+date,j.brief);
    return true;
  }catch{ return false; }
}
async function syncPlayers(ids){
  if(!Shared.on||!ids.length) return false;
  try{ const j=await getJson(`/api/store?date=${bkkToday()}&players=${ids.slice(0,60).join(",")}`,6000); S.players={...(S.players||{}),...(j.players||{})}; return Object.keys(j.players||{}).length>0; }catch{ return false; }
}
function syncPush(body){
  if(!Shared.on) return Promise.resolve();
  return fetch("/api/store",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).catch(()=>{});
}

/* ---------- picks: one strongest call per match, up to 10 a day, frozen at kickoff ---------- */
function bestCall(m){
  if(m.st!=="pre") return null;
  const top=m.sum.top[0], score=`${top.h}-${top.a}`, c=[];
  if(m.mk?.spread){
    const line=m.mk.spread.line, hc=cover(hdpSplit(m.g,line)), home=hc>=.5;
    c.push({type:"ah",side:home?"h":"a",line,prob:Math.max(hc,1-hc),label:home?`${m.h.short} ${signed(line)}`:`${m.a.short} ${signed(-line)}`,phrase:ahPhrase(m.h.short,m.a.short,line)});
  }
  if(m.mk?.total){
    const line=m.mk.total.line, t=totSplit(m.g,line), oc=cover(t.over), over=oc>=.5;
    c.push({type:"ou",side:over?"o":"u",line,prob:Math.max(oc,1-oc),label:`${over?"สูง":"ต่ำ"} ${ballLabel(line)}`,phrase:`สูงต่ำ ${ballLabel(line)} ตามตลาด`});
  } else {
    const over=m.sum.over25>=.5;
    c.push({type:"ou",side:over?"o":"u",line:2.5,prob:Math.max(m.sum.over25,m.sum.under25),label:`${over?"สูง":"ต่ำ"} 2.5`,phrase:"ยังไม่มีราคา ใช้เส้นมาตรฐาน 2.5"});
  }
  if(!m.mk?.spread){
    const home=m.sum.home>=m.sum.away;
    c.push({type:"1x2",side:home?"h":"a",line:0,prob:Math.max(m.sum.home,m.sum.away),label:`${home?m.h.short:m.a.short} ชนะ`,phrase:"ผลชนะในเวลา 90 นาที"});
  }
  const b=c.sort((x,y)=>y.prob-x.prob)[0];
  return b ? {id:m.id, ...b, score} : null;
}
function picksLimit(n){ return Math.min(10, Math.max(3, Math.ceil(n/3.5))); }
function picksFor(date){
  const day=getDay(date), ms=day.matches; if(!ms.length) return {list:[],limit:0,total:0};
  const limit=picksLimit(ms.length);
  const saved=Shared.on&&Shared.picks[date] ? Object.values(Shared.picks[date]) : store.get("picks:"+date,[]);
  const byId=new Map(ms.map(m=>[m.id,m]));
  const frozen=saved.filter(p=>byId.has(p.id)&&byId.get(p.id).st!=="pre");
  const cal=S?.weights?.pickCal||{};
  const fresh=ms.map(bestCall).filter(Boolean).map(p=>{ const c=cal[p.type]; return c?{...p,raw:p.prob,prob:Math.min(.95,p.prob*c)}:p; })
    .filter(p=>p.prob>=.55&&!frozen.some(z=>z.id===p.id)).sort((a,b)=>b.prob-a.prob);
  const list=[...frozen,...fresh.slice(0,Math.max(0,limit-frozen.length))].sort((a,b)=>b.prob-a.prob);
  if(date>=shiftDate(bkkToday(),-1) && day.source!=="snapshot"){
    store.set("picks:"+date, list);
    if(Shared.on){
      const sig=list.map(p=>p.id+p.label).join("|");
      if(Shared.sig?.[date]!==sig){ (Shared.sig=Shared.sig||{})[date]=sig;
        const send=list.filter(p=>byId.get(p.id)?.st==="pre").map(p=>({...p,ko:byId.get(p.id).ko,match:`${byId.get(p.id).h.short} – ${byId.get(p.id).a.short}`}));
        const next={}; list.forEach(p=>next[p.id]={...p,ko:byId.get(p.id).ko}); Shared.picks[date]=next;
        if(send.length) syncPush({date,picks:send});
      }
    }
  }
  return {list:list.map(p=>({...p,m:byId.get(p.id)})), limit, total:ms.length};
}
function settlePick(p, hs, as){
  let s;
  if(p.type==="1x2"){ s = (p.side==="h"?hs>as:as>hs) ? 1 : -1; }
  else {
    s=0;
    const base = p.type==="ah" ? (p.side==="h" ? hs-as : as-hs) : (p.side==="o" ? hs+as : -(hs+as));
    const ln = p.type==="ah" ? (p.side==="h" ? p.line : -p.line) : (p.side==="o" ? -p.line : p.line);
    for(const part of atomic(ln)){ const v=base+part.line; s += (v>1e-9?1:v<-1e-9?-1:0)*part.w; }
  }
  return s>=1?"win":s>0?"half":s===0?"push":s>-1?"halflose":"lose";
}
const RES_LABEL={win:"เข้า",half:"เข้าครึ่ง",push:"คืนทุน",halflose:"เสียครึ่ง",lose:"ไม่เข้า"};

/* ---------- pre-match calls, frozen at kickoff, and the verdict after full time ---------- */
function preCall(m){
  const top=m.sum.top[0], res=m.sum.home>=m.sum.away&&m.sum.home>=m.sum.draw?"h":m.sum.away>=m.sum.draw?"a":"d";
  const c={d:bkkDateOf(m.ko),res,ph:+m.sum.home.toFixed(3),pd:+m.sum.draw.toFixed(3),pa:+m.sum.away.toFixed(3),ou:m.sum.over25>=.5?"o":"u",o25:+m.sum.over25.toFixed(3),sh:top.h,sa:top.a,btts:m.sum.btts>=.5};
  if(m.mk?.spread){ const hc=cover(hdpSplit(m.g,m.mk.spread.line)); c.line=m.mk.spread.line; c.side=hc>=.5?"h":"a"; c.cv=+Math.max(hc,1-hc).toFixed(3); }
  return c;
}
function freezeCalls(day){
  if(!day?.matches?.length||day.source==="snapshot") return;
  const all=store.get("calls",{}); let dirty=false;
  for(const m of day.matches) if(m.st==="pre"){ const c=preCall(m); if(JSON.stringify(all[m.id])!==JSON.stringify(c)){ all[m.id]=c; dirty=true; } }
  if(!dirty) return;
  const cut=shiftDate(bkkToday(),-6); for(const k in all) if(all[k].d<cut) delete all[k];
  store.set("calls",all);
}
function verdict(m){
  if(m.st!=="post"||m.h.score==null) return null;
  const c=store.get("calls",{})[m.id]||preCall(m), hs=m.h.score, as=m.a.score;
  const actual=hs>as?"h":hs===as?"d":"a";
  const v={frozen:!!store.get("calls",{})[m.id], res:{pred:c.res,ok:c.res===actual,p:c[c.res==="h"?"ph":c.res==="a"?"pa":"pd"]}, ou:{pred:c.ou,ok:(hs+as>=3)===(c.ou==="o"),p:c.ou==="o"?c.o25:1-c.o25},
    exact:{pred:`${c.sh}-${c.sa}`,ok:c.sh===hs&&c.sa===as}, btts:{pred:c.btts,ok:(hs>0&&as>0)===c.btts}};
  if(c.line!=null){ const r=settlePick({type:"ah",side:c.side,line:c.line},hs,as); v.hdp={side:c.side,line:c.line,res:r,ok:r==="win"||r==="half",push:r==="push"}; }
  return v;
}

/* ---------- learning from finished matches ---------- */
const sentPred={}, sentRes={};
function recordDay(date){
  const day=S.days[date]; if(!day?.matches?.length || day.source==="snapshot") return;
  freezeCalls(day);
  if(Shared.on){
    const now=Date.now(), preds=[], results=[];
    for(const m of day.matches){
      if(m.st==="pre" && m.lh0!=null && (!sentPred[m.id] || now-sentPred[m.id]>30*60e3)){ sentPred[m.id]=now; const mk=m.mk?.home&&m.mk.draw&&m.mk.away?devig([m.mk.home.decimal,m.mk.draw.decimal,m.mk.away.decimal]):null;
        preds.push({id:m.id,lg:m.lg,lh0:+m.lh0.toFixed(3),la0:+m.la0.toFixed(3),ph:+m.sum.home.toFixed(3),pa:+m.sum.away.toFixed(3),ko:m.ko,hid:m.h.id,aid:m.a.id,
          pH:+m.pH.toFixed(3),pA:+m.pA.toFixed(3),bH:+m.bH.toFixed(3),bA:+m.bA.toFixed(3),
          fr:Object.fromEntries((m.factors||[]).filter(f=>!f.base&&f.k!=="market"&&f.rh>0&&f.ra>0).map(f=>[f.k,[+Math.log(f.rh).toFixed(4),+Math.log(f.ra).toFixed(4)]])),mkH:m.mkt?+m.mkt.lh.toFixed(3):undefined,mkA:m.mkt?+m.mkt.la.toFixed(3):undefined,mh:mk?.[0],md:mk?.[1],ma:mk?.[2]}); }
      if(m.st==="post" && m.h.score!=null && !sentRes[m.id]){ sentRes[m.id]=1; results.push({id:m.id,hs:m.h.score,as:m.a.score,match:`${m.h.short} ${m.h.score}–${m.a.score} ${m.a.short}`}); }
    }
    if(preds.length||results.length) syncPush({date,preds,results}).then(()=>{ if(results.length) syncPull(date).then(ok=>{ if(ok&&!S.open) render(); }); });
    return;
  }
  const pred=store.get("pred",{}), hist=store.get("hist",[]), seen=new Set(hist.map(h=>h.id));
  let dirty=false;
  for(const m of day.matches){
    if(m.st==="pre" && m.lh0!=null){ pred[m.id]={d:date,lg:m.lg,lh0:+m.lh0.toFixed(3),la0:+m.la0.toFixed(3),ph:+m.sum.home.toFixed(3),pa:+m.sum.away.toFixed(3),ko:m.ko}; dirty=true; }
    else if(m.st==="post" && pred[m.id] && !seen.has(m.id) && m.h.score!=null){
      hist.push({id:m.id,...pred[m.id],hs:m.h.score,as:m.a.score}); delete pred[m.id]; seen.add(m.id); dirty=true;
    }
  }
  /* settle the day's picks */
  const picks=store.get("picks:"+date,[]), ph=store.get("pickHist",[]), done=new Set(ph.map(x=>x.id));
  for(const p of picks){ const m=day.matches.find(x=>x.id===p.id); if(m?.st==="post"&&!done.has(p.id)&&m.h.score!=null){ ph.push({d:date,id:p.id,label:p.label,type:p.type,prob:p.prob,match:`${m.h.short} ${m.h.score}–${m.a.score} ${m.a.short}`,res:settlePick(p,m.h.score,m.a.score)}); dirty=true; } }
  if(!dirty) return;
  const cutoff=shiftDate(bkkToday(),-10); for(const k of Object.keys(pred)) if(pred[k].d<cutoff) delete pred[k];
  store.set("pred",pred); store.set("hist",hist.slice(-600)); store.set("pickHist",ph.slice(-300));
  S.calib=computeCalib();
}
function computeCalib(){
  const hist=store.get("hist",[]); const out={};
  const add=(k,h)=>{ const o=out[k]=out[k]||{n:0,hs:0,as:0,lh:0,la:0}; o.n++; o.hs+=h.hs; o.as+=h.as; o.lh+=h.lh0; o.la+=h.la0; };
  for(const h of hist){ if(h.lh0==null) continue; add(h.lg,h); add("_all",h); }
  for(const k in out){ const o=out[k]; const w=o.n/(o.n+40);
    o.hAdj=clamp(1+(o.hs/o.lh-1)*w,.9,1.1); o.aAdj=clamp(1+(o.as/o.la-1)*w,.9,1.1); }
  return out;
}
function pickRecord(days=14){
  const from=shiftDate(bkkToday(),-days), ph=(Shared.on?Shared.pickHist.slice().reverse():store.get("pickHist",[])).filter(x=>x.d>=from);
  const won=ph.filter(x=>x.res==="win"||x.res==="half").length, lost=ph.filter(x=>x.res==="lose"||x.res==="halflose").length, push=ph.filter(x=>x.res==="push").length;
  return {list:ph.slice().reverse(), won, lost, push, n:won+lost};
}
/* recent league trend: results of the last 14 days, one ESPN request per league */
async function loadTrends(date, slugs){
  const trends=store.get("trends",{}), now=Date.now(), todo=slugs.filter(s=>!trends[s]||now-trends[s].at>6*3600e3);
  if(!todo.length) return false;
  const from=shiftDate(date,-14).replaceAll("-",""), to=shiftDate(date,-1).replaceAll("-","");
  const pred=store.get("pred",{}), hist=store.get("hist",[]), seen=new Set(hist.map(h=>h.id)); let settled=false;
  await pool(todo,4,async slug=>{
    try{
      const b=await espn(`site/v2/sports/soccer/${slug}/scoreboard?dates=${from}-${to}`,8000);
      let n=0,g=0,hg=0;
      for(const ev of b.events||[]){
        const c=ev.competitions?.[0]; if(c?.status?.type?.state!=="post") continue;
        const H=c.competitors?.find(x=>x.homeAway==="home"), A=c.competitors?.find(x=>x.homeAway==="away");
        const hs=Number(H?.score), as=Number(A?.score); if(!Number.isFinite(hs)||!Number.isFinite(as)) continue;
        n++; g+=hs+as; hg+=hs;
        if(pred[ev.id]&&!seen.has(ev.id)){ hist.push({id:ev.id,...pred[ev.id],hs,as}); delete pred[ev.id]; seen.add(ev.id); settled=true; }
      }
      trends[slug]={at:now,n,gpg:n?g/n:null,home:g?hg/g:null};
    }catch{}
  });
  store.set("trends",trends); S.trends=trends;
  if(settled&&!Shared.on){ store.set("pred",pred); store.set("hist",hist.slice(-600)); S.calib=computeCalib(); }
  return true;
}

/* ---------- live ESPN (works when the page is hosted where the feed is reachable) ---------- */
async function getJson(url, ms=6000, opts={}){
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),ms);
  try{ const r=await fetch(url,{...opts,signal:ctl.signal}); if(!r.ok) throw new Error(r.status); return await r.json(); } finally{ clearTimeout(t); }
}
/* ESPN routes: first our own server proxy (/api/espn on Vercel), then ESPN directly. Whichever answers first is remembered. */
const ESPN_ROUTES=[
  p=>`/api/espn?path=${encodeURIComponent(p.split("?")[0])}${p.includes("?")?"&"+p.split("?")[1]:""}`,
  p=>`https://site.api.espn.com/apis/${p}`
];
let espnRoute=null;
async function espnCore(path){
  try{ return await getJson(`/api/espn?host=core&path=${encodeURIComponent(path)}`,6000); }
  catch{ return getJson(`https://sports.core.api.espn.com/${path}`,6000); }
}
async function espn(path, ms=6000){
  if(espnRoute) return getJson(espnRoute(path), ms);
  let last;
  for(const route of ESPN_ROUTES){ try{ const j=await getJson(route(path), ms); espnRoute=route; return j; }catch(e){ last=e; } }
  throw last||new Error("feed");
}
function readAmerican(v){ const n=typeof v==="number"?v:Number(String(v??"").replace("+","").trim()); return Number.isFinite(n)&&n!==0?n:null; }
function amToDec(a){ if(a==null) return null; const d=a>0?1+a/100:1+100/Math.abs(a); return d>1.01?d:null; }
function priceOf(side){ const n=side?.close?.odds!=null?side.close:side?.open; const d=amToDec(readAmerican(n?.odds)); return d?{decimal:d}:null; }
function lineOf(side){ const n=side?.close?.line!=null?side.close:side?.open; const v=Number(String(n?.line??"").replace(/[^\d.+-]/g,"")); return n?.line!=null&&Number.isFinite(v)?v:null; }
function parseMarket(o){
  if(!o) return null;
  const home=priceOf(o.moneyline?.home), away=priceOf(o.moneyline?.away), draw=priceOf(o.moneyline?.draw);
  const sl=lineOf(o.pointSpread?.home), sh=priceOf(o.pointSpread?.home), sa=priceOf(o.pointSpread?.away);
  const tl=lineOf(o.total?.over)??lineOf(o.total?.under), ov=priceOf(o.total?.over), un=priceOf(o.total?.under);
  const mk={book:o.provider?.displayName||o.provider?.name||"ตลาด",home,draw,away,
    spread: sl!=null&&sh&&sa?{line:sl,home:sh,away:sa}:null, total: tl!=null&&ov&&un?{line:tl,over:ov,under:un}:null};
  return (home||away||draw||mk.spread||mk.total)?mk:null;
}
const tableCache=new Map(); // slug -> {at, value}
async function loadTable(slug){
  const hit=tableCache.get(slug); if(hit && Date.now()-hit.at<30*60e3) return hit.value;
  const value=await loadTableRaw(slug); tableCache.set(slug,{at:Date.now(),value}); return value;
}
async function loadTableRaw(slug){
  try{
    const p=await espn(`v2/sports/soccer/${slug}/standings`); const rows=new Map(); let g=0,pl=0;
    for(const ch of p.children||[]) for(const e of ch.standings?.entries||[]){
      const st=n=>{ const s=e.stats?.find(x=>x.name===n); return s&&Number.isFinite(s.value)?s.value:null; };
      const id=String(e.team?.id??""), played=st("gamesPlayed"), gf=st("pointsFor"), ga=st("pointsAgainst");
      if(!id||played==null||gf==null||ga==null||rows.has(id)) continue;
      rows.set(id,{played,gf,ga,points:st("points"),rank:st("rank")}); g+=gf; pl+=played;
    }
    return rows.size?{rows,avg:pl?g/pl:null}:null;
  }catch{ return null; }
}
async function pool(items,limit,fn){ const out=new Array(items.length); let i=0; await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{ while(i<items.length){ const k=i++; out[k]=await fn(items[k]); } })); return out; }
async function loadLiveDay(date, onlySlugs){
  const ymd=date.replaceAll("-","");
  const list=onlySlugs?.length ? LEAGUES.filter(([s])=>onlySlugs.includes(s)) : LEAGUES;
  const per=await pool(list,6,async([slug])=>{
    try{
      const b=await espn(`site/v2/sports/soccer/${slug}/scoreboard?dates=${ymd}`); const evs=b.events||[]; if(!evs.length) return [];
      const tbl=await loadTable(slug);
      return evs.map(ev=>{
        const c=ev.competitions?.[0], H=c?.competitors?.find(x=>x.homeAway==="home"), A=c?.competitors?.find(x=>x.homeAway==="away"); if(!H||!A) return null;
        const side=x=>{ const id=String(x.team?.id??""), r=tbl?.rows.get(id), sc=Number(x.score);
          return {id,logo:x.team?.logo||null,name:x.team?.displayName||"ทีม",short:x.team?.shortDisplayName||x.team?.abbreviation||x.team?.displayName||"ทีม",form:x.form||null,rank:r?.rank||null,played:r?.played??null,gf:r?.gf??null,ga:r?.ga??null,points:r?.points??null,score:Number.isFinite(sc)?sc:null}; };
        const h=side(H), a=side(A), base=baseLambdas(h,a,tbl?.avg??null);
        const name=c?.status?.type?.name||"", state=c?.status?.type?.state||"pre";
        const clock = state!=="in" ? null : name.includes("HALFTIME") ? "พักครึ่ง" : name.includes("PENALT") ? "ยิงจุดโทษ" : (c?.status?.displayClock||"สด");
        return {id:ev.id,lg:slug,ko:ev.date,st:name.includes("POSTPONED")?"pp":name.includes("CANCEL")?"pp":state,clock,h,a,lh:base.lh,la:base.la,basis:base.basis,mk:parseMarket(c?.odds?.[0]),ds:null,live:true,lgAvg:tbl?.avg??null,
          ls:state==="pre"?null:liveStatsOf(c?.competitors||[],c?.details||[],H,A)};
      }).filter(Boolean);
    }catch{ return null; }
  });
  if(per.every(x=>x==null)) throw new Error("feed");
  return {fetchedAt:new Date().toISOString(), matches:per.flatMap(x=>x||[])};
}
async function loadLiveDossier(m){
  try{
    const p=await espn(`site/v2/sports/soccer/${m.lg}/summary?event=${m.id}`,8000);
    const ser=(p.seasonseries||[]).find(s=>s.events?.length);
    const meet=(ser?.events||[]).filter(e=>(e.statusType?.state||e.status)==="post").map(e=>{
      const hh=e.competitors?.find(x=>x.homeAway==="home"), aa=e.competitors?.find(x=>x.homeAway==="away");
      return [(e.date||"").slice(0,10),String(hh?.team?.id),String(aa?.team?.id),Number(hh?.score),Number(aa?.score),hh?.team?.displayName,aa?.team?.displayName];
    }).filter(r=>Number.isFinite(r[3])&&Number.isFinite(r[4])).slice(0,5);
    const five=id=>{ const blk=(p.lastFiveGames||[]).find(x=>String(x.team?.id)===id); if(!blk) return null;
      const lines=[], ha=[], dates=[]; let w=0,d=0,l=0;
      for(const e of (blk.events||[]).slice(0,5)){ const hs=Number(e.homeTeamScore), as=Number(e.awayTeamScore); if(!Number.isFinite(hs)||!Number.isFinite(as)) continue;
        const home=String(e.homeTeamId)===id; lines.push(`${home?hs:as}-${home?as:hs}`); ha.push(home?"H":"A"); dates.push(e.gameDate||null);
        if(e.gameResult==="W") w++; else if(e.gameResult==="L") l++; else d++; }
      return {w,d,l,lines,ha,dates:dates.filter(Boolean).sort().reverse()}; };
    /* season leaders per team: goals, assists */
    const leaders={};
    for(const side of p.leaders||[]){
      const tid=String(side.team?.id??""); if(!tid) continue;
      for(const cat of side.leaders||[]){
        const key=/goal/i.test(cat.name||"")?"goals":/assist/i.test(cat.name||"")?"assists":null; if(!key) continue;
        for(const ld of (cat.leaders||[]).slice(0,3)){
          const a=ld.athlete; if(!a?.id) continue;
          const v=Number(String(ld.displayValue||ld.value||"").replace(/[^\d.]/g,""));
          const rec=(leaders[tid]=leaders[tid]||{})[a.id]=leaders[tid]?.[a.id]||{id:String(a.id),name:a.displayName||a.shortName,team:tid,goals:null,assists:null};
          rec[key]=Number.isFinite(v)?v:null;
        }
      }
    }
    /* line-ups, when ESPN has them */
    const starters={}; let known=false;
    for(const r of p.rosters||[]){ const tid=String(r.team?.id??""); const st=(r.roster||[]).filter(x=>x.starter); if(st.length>=10){ known=true; starters[tid]=new Set(st.map(x=>String(x.athlete?.id))); } }
    const miss=tid=>known&&starters[tid] ? Object.values(leaders[tid]||{}).filter(x=>(x.goals||0)>=3&&!starters[tid].has(x.id)).map(x=>x.name) : [];
    const v=p.gameInfo?.venue;
    const players=[...Object.values(leaders[m.h.id]||{}),...Object.values(leaders[m.a.id]||{})].map(x=>({...x,team:x.team===m.h.id?m.h.name:m.a.name,side:x.team===m.h.id?"h":"a"}));
    return {h2h:ser?.summary||null,meet,hf:five(m.h.id),af:five(m.a.id),venue:v?.fullName||null,city:v?.address?.city||null,country:v?.address?.country||null,
      players, marks:[], ls:liveStatsFromSummary(p), lineup: known?{known:true,hMiss:miss(m.h.id),aMiss:miss(m.a.id),starters:[...(starters[m.h.id]||[]),...(starters[m.a.id]||[])]}:null};
  }catch{ return null; }
}

/* ---------- extra context loaded when a match is opened (hosted site only) ---------- */
const extCache=store.get("ext",{}); // teamId -> {coach:{name,dob}}, athleteId -> dob
function saveExt(){ store.set("ext",extCache); }
async function loadWeather(m){
  const city=m.ds?.city; if(!city) return null;
  const ko=new Date(m.ko), days=(ko-Date.now())/864e5; if(days<-0.2||days>14) return null;
  try{
    const geo=await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en`,6000);
    const g=geo.results?.[0]; if(!g) return null;
    const day=ko.toISOString().slice(0,10);
    const f=await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&hourly=temperature_2m,precipitation,wind_speed_10m&start_date=${day}&end_date=${day}&timezone=UTC`,6000);
    const i=Math.min(23,ko.getUTCHours());
    return {temp:f.hourly.temperature_2m[i], rain:f.hourly.precipitation[i], wind:f.hourly.wind_speed_10m[i], elev:g.elevation??0, place:g.name};
  }catch{ return null; }
}
async function athleteDob(id){
  if(extCache["a"+id]!==undefined) return extCache["a"+id];
  try{ const j=await espnCore(`v2/sports/soccer/athletes/${id}`); extCache["a"+id]=(j.dateOfBirth||"").slice(0,10)||null; }catch{ return null; }
  saveExt(); return extCache["a"+id];
}
async function wikiJson(params){ return getJson(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({...params,format:"json",origin:"*"})}`,7000); }
async function wikiText(title){ const j=await wikiJson({action:"query",prop:"revisions",rvprop:"content",rvslots:"main",rvsection:"0",titles:title,redirects:"1"}); const pg=Object.values(j.query?.pages||{})[0]; return pg?.revisions?.[0]?.slots?.main?.["*"]||""; }
function wikiDob(text){ const m=text.match(/birth[ _]date(?:[ _]and[ _]age)?\s*\|\s*(?:df=y\w*\|\s*|mf=y\w*\|\s*)?(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i); return m?`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`:null; }
async function teamCoach(team){
  const key="c"+team.id; if(extCache[key]!==undefined) return extCache[key];
  let out=null;
  try{
    const s=await wikiJson({action:"query",list:"search",srsearch:`${team.name} football club`,srlimit:"1"});
    const title=s.query?.search?.[0]?.title;
    if(title){
      const txt=await wikiText(title);
      const mm=txt.match(/\|\s*(?:manager|head[ _]coach|coach)\s*=\s*([^\n]+)/i);
      if(mm){
        const link=mm[1].match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
        const name=link?(link[2]||link[1]):mm[1].replace(/<[^>]+>|\{\{[^}]*\}\}|'''?/g,"").trim();
        let dob=null; if(link){ try{ dob=wikiDob(await wikiText(link[1])); }catch{} }
        if(name && name.length<40) out={name:name.trim(),dob};
      }
    }
  }catch{ return null; }
  extCache[key]=out; saveExt(); return out;
}
async function loadPeople(m){
  const ps=(m.ds?.players||[]).filter(p=>p.id).slice(0,6);
  const [dobs,hc,ac]=await Promise.all([Promise.all(ps.map(p=>athleteDob(p.id))),teamCoach(m.h),teamCoach(m.a)]);
  return {players:ps.map((p,i)=>({...p,dob:dobs[i]})), coaches:{h:hc,a:ac}};
}

/* ---------- app state ---------- */
const S = {
  date: bkkToday(),
  tab: "home",
  filter: "all",        // all | hot
  league: "",
  analyze: "all",       // all | ah | ou | goals
  q: "",
  style: store.get("style","decimal"),
  favs: store.get("favs",{}),   // teamId -> name
  days: {},             // date -> {fetchedAt, matches, source}
  liveOk: null,
  open: null,
  briefBusy: false,
  logos: !window.claude,   // artifact pages cannot load outside images
  goals: {},               // matchId -> time a goal was seen
  ext: {},                 // matchId -> {wx, people} loaded when a match is opened
  newsAdj: {},             // matchId -> {h, a, reason} from the daily brief
  newsTeam: store.get("newsTeam",{}), // teamId -> {e, reason, d}: news carried to the next matches for 3 days
  trends: store.get("trends",{}),     // league -> recent goals per game (last 14 days)
  calib: null,                        // league -> learned home/away goal multipliers
  briefErr: ""
};

function snapshotDay(date){
  const d=SNAPSHOT?.[date]; if(!d) return null;
  const old = Date.now()-Date.parse(d.fetchedAt) > 3*3600e3;
  return {fetchedAt:d.fetchedAt, matches: old ? d.matches.map(m=>m.st==="in"?{...m,st:"unk"}:m) : d.matches, source:"snapshot"};
}
function prepare(day){
  const seen=new Set();
  const matches=day.matches.filter(m=>!seen.has(m.id)&&seen.add(m.id)).map(refine)
    .sort((a,b)=>a.ko.localeCompare(b.ko)||(LEAGUE_ORDER[a.lg]??99)-(LEAGUE_ORDER[b.lg]??99));
  return {...day, matches};
}
function getDay(date){
  if(!S.days[date]){
    const snap=snapshotDay(date), cached=store.get("day:"+date,null);
    const useCache = cached?.matches?.length && (!snap || cached.fetchedAt > snap.fetchedAt);
    S.days[date] = useCache ? prepare({...cached, source:"cache"}) : snap ? prepare(snap) : {fetchedAt:null, matches:[], source:"none"};
  }
  return S.days[date];
}
function saveDay(date){
  const d=S.days[date]; if(!d?.matches?.length) return;
  store.set("day:"+date,{fetchedAt:d.fetchedAt, matches:d.matches.map(m=>m.raw||m)});
  try{ const keep=new Set([shiftDate(bkkToday(),-1),bkkToday(),shiftDate(bkkToday(),1),shiftDate(bkkToday(),2),date]);
    Object.keys(localStorage).filter(k=>k.startsWith("gc:day:")&&!keep.has(k.slice(7))).forEach(k=>localStorage.removeItem(k)); }catch{}
}
async function probeLive(){
  if(S.liveOk!=null) return S.liveOk;
  try{ await espn(`site/v2/sports/soccer/eng.1/scoreboard`,5000); S.liveOk=true; }catch{ S.liveOk=false; }
  return S.liveOk;
}
async function refresh(date, manual, light){
  if(S.loading){ S.queued={date,manual}; return; }
  S.loading=date; S.err=null;
  const btn=$("#btnRefresh");
  btn.classList.add("spin"); paintStatus();
  try{
    if(await probeLive()){
      const prev=S.days[date];
      const slugs = light && prev?.source==="live" ? [...new Set(prev.matches.map(m=>m.lg))] : null;
      const live=await loadLiveDay(date, slugs);
      const old=S.days[date]; const keep=new Map((old?.matches||[]).map(m=>[m.id,m.ds]));
      const before=new Map((old?.source==="live"||old?.source==="cache"?old.matches:[]).map(m=>[m.id,m]));
      for(const m of live.matches){
        const o=before.get(m.id); if(!o||m.st==="pre") continue;
        const gh=(m.h.score??0)-(o.h.score??0), ga=(m.a.score??0)-(o.a.score??0);
        if(gh>0||ga>0){ S.goals[m.id]=Date.now();
          if(S.favs[m.h.id]||S.favs[m.a.id]) toast(`ประตู! ${gh>0?m.h.short:m.a.short} · ${m.h.short} ${m.h.score}–${m.a.score} ${m.a.short}`); }
      }
      live.matches.forEach(m=>{ const d=keep.get(m.id); if(d) m.ds=d; });
      S.days[date]=prepare({...live, source:"live"});
      saveDay(date);
      if(!Shared.pulled[date] || Date.now()-Shared.pulled[date]>5*60e3) await syncPull(date);
      recordDay(date);
      if(date===bkkToday()) loadTrends(date,[...new Set(S.days[date].matches.map(m=>m.lg))]).then(ch=>{ if(ch&&S.days[date]){ S.days[date]=prepare({...S.days[date],matches:S.days[date].matches.map(x=>x.raw||x)}); if(!S.open) render(); } });
      if(S.open){ const nm=S.days[date].matches.find(x=>x.id===S.open.id); if(nm) updateSheetScore(nm); }
      if(manual) toast("ดึงข้อมูลสดจาก ESPN แล้ว");
    } else if(manual){
      toast("หน้านี้เชื่อมฟีด ESPN ไม่ได้ จึงใช้ข้อมูลชุดที่บันทึกไว้ เปิดจากเว็บที่ติดตั้งไว้เพื่อดูสด");
    }
  }catch{ S.err=new Date().toISOString(); if(manual) toast("ดึงข้อมูลใหม่ไม่สำเร็จ ใช้ชุดเดิมต่อ"); }
  S.loading=false;
  btn.classList.remove("spin");
  if(S.queued){ const q=S.queued; S.queued=null; if(q.date!==date||q.manual) return refresh(q.date,q.manual); }
  scheduleNext();
  render();
  if(S.liveOk && date===bkkToday()) prefetch(shiftDate(date,1));
}
/* quietly load tomorrow once so its chip count and board are ready */
const prefetched=new Set();
async function prefetch(date){
  if(prefetched.has(date)||S.days[date]?.source==="live") return; prefetched.add(date);
  try{ const live=await loadLiveDay(date); S.days[date]=prepare({...live, source:"live"}); saveDay(date); if(!S.open) render(); }catch{}
}
/* after midnight Bangkok time, move a board that was showing "today" to the new day */
function rollDay(){
  const t=bkkToday(); if(S.today && S.today!==t && S.date===S.today){ S.date=t; S.league=""; }
  S.today=t;
}
/* auto update: every minute while a match is live or about to start, otherwise every 10 minutes */
let pollT;
function hotDay(day){ const now=Date.now(); return (day?.matches||[]).some(m=>m.st==="in"||(m.st==="pre"&&Date.parse(m.ko)-now<15*60e3&&now-Date.parse(m.ko)<3*3600e3)); }
function scheduleNext(){
  clearTimeout(pollT); S.nextMs=null; if(!S.liveOk) return;
  const ms=hotDay(S.days[S.date])?60e3:10*60e3; S.nextMs=ms;
  S.tick=(S.tick||0)+1;
  pollT=setTimeout(()=>{ if(document.visibilityState!=="visible") return scheduleNext(); rollDay(); refresh(S.date,false, ms<600e3 && S.tick%10!==0); },ms);
}
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState!=="visible") return;
  rollDay(); const d=S.days[S.date];
  if(S.liveOk && (!d?.fetchedAt || d.source!=="live" || Date.now()-Date.parse(d.fetchedAt)>60e3)) refresh(S.date,false); else render();
});
function updateSheetScore(nm){
  if(nm.st==="in"&&S.open?.id===nm.id&&(!S.lsAt||Date.now()-S.lsAt>110e3)){ S.lsAt=Date.now();
    loadLiveDossier(nm).then(ds=>{ if(ds&&S.open?.id===nm.id){ const cur=S.open; const keep=cur.raw?.ds; const merged=refine({...cur.raw, ds:{...(keep||ds), ls:ds.ls, lineup:ds.lineup||keep?.lineup}}); S.open=merged; const el=$("#liveBox"); if(el) el.outerHTML=liveBox(merged); } }); }
  if(!S.open||S.open.id!==nm.id) return;
  const keepDs=S.open.ds; const merged=keepDs&&!nm.ds?refine({...nm.raw, ds:keepDs}):nm;
  S.open=merged; const mid=$("#sheet .face .mid"); if(mid){ mid.innerHTML=midHtml(merged); mid.classList.toggle("live",merged.st==="in"); }
  const lb=$("#liveBox"); if(lb) lb.outerHTML=liveBox(merged);
  if(merged.st==="post"&&S.sheetTab==="overview") paintSheet();
}

