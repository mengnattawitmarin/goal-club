// Leagues the app follows (ESPN slugs). Shared by the daily job and the store's checks.
export const LEAGUES = ["tha.1","eng.1","esp.1","ger.1","ita.1","fra.1","uefa.champions","uefa.europa","uefa.europa.conf","eng.2","eng.league_cup","ned.1","por.1","bel.1","sco.1","tur.1","usa.1","mex.1","bra.1","arg.1","ksa.1","jpn.1","chn.1","aus.1"];

// เมดูซ่า 4.1: national-team competitions (plan "แผนเมดูซ่า 4.1 · ทีมชาติ", all 7 groups).
// National sides never meet clubs, so they get their own history (bfn:*), fit (dcnt/dcnl) and backtest (backtestn).
// Some slugs may not exist on ESPN: the model job checks them (natslugs) and the app skips the ones that fail.
export const NATIONAL = [
  "afc.asian.cup",                       // 1 เอเชียนคัพ
  "fifa.friendly",                       // 2 กระชับมิตร
  "uefa.nations",                        // 3 ยูฟ่าเนชันส์ลีก
  "fifa.world",                          // 4 ฟุตบอลโลก
  "concacaf.nations.league",             // 5 คอนคาแคฟเนชันส์ลีก
  "aff.championship",                    // 6 อาเซียนแชมเปียนชิพ
  "fifa.worldq.afc", "fifa.worldq.uefa", "fifa.worldq.conmebol", "fifa.worldq.concacaf", "fifa.worldq.caf",
  "uefa.euro", "conmebol.america", "caf.nations", "concacaf.gold",   // 7 คัดเลือกฟุตบอลโลก, ยูโร, โกปา อเมริกา, แอฟริกา, โกลด์คัพ
];
export const ALL_LEAGUES = [...LEAGUES, ...NATIONAL];
export const isNational = (lg) => NATIONAL.includes(lg);
