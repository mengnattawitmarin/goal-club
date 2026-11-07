// Headlines for the AI news scan and the daily brief (เมดูซ่า 3.2): English feeds, ESPN league news
// and Thai football news. THAI_NEWS_FEEDS (comma-separated RSS URLs) replaces the default Thai feeds.
const THAI_DEFAULT = [
  "https://news.google.com/rss/search?q=%E0%B9%84%E0%B8%97%E0%B8%A2%E0%B8%A5%E0%B8%B5%E0%B8%81&hl=th&gl=TH&ceid=TH:th",           // ไทยลีก
  "https://news.google.com/rss/search?q=%E0%B8%9A%E0%B8%B2%E0%B8%94%E0%B9%80%E0%B8%88%E0%B9%87%E0%B8%9A+%E0%B8%9F%E0%B8%B8%E0%B8%95%E0%B8%9A%E0%B8%AD%E0%B8%A5&hl=th&gl=TH&ceid=TH:th", // บาดเจ็บ ฟุตบอล
];
export const FEEDS = [
  { source: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/football/rss.xml" },
  { source: "The Guardian", url: "https://www.theguardian.com/football/rss" },
];
export function thaiFeeds() {
  const env = String(process.env.THAI_NEWS_FEEDS || "").split(",").map((x) => x.trim()).filter((x) => /^https:\/\//.test(x));
  return (env.length ? env : THAI_DEFAULT).map((url, i) => ({ source: `ข่าวไทย ${i + 1}`, url, thai: true }));
}
export function decode(s) {
  return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, "").trim();
}
export async function rss({ source, url }, n = 12) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "user-agent": "GoalClub/1.0 (+https://goal-club.vercel.app)" } });
    if (!r.ok) return [];
    const xml = await r.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, n).map((m) => ({
      source,
      title: decode((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""),
      url: decode((m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1] || ""),
    })).filter((x) => x.title);
  } catch { return []; }
}
export async function espnNews(lg, n = 8) {
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/news?limit=${n}`, { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return (j.articles || []).map((a) => ({ source: `ESPN ${lg}`, title: `${a.headline}${a.description ? " — " + a.description : ""}`, url: a.links?.web?.href || "" })).filter((x) => x.title);
  } catch { return []; }
}
/* everything at once, with which feeds answered (for the status page) */
export async function headlines({ thai = true, max = 90 } = {}) {
  const feeds = [...FEEDS, ...(thai ? thaiFeeds() : [])];
  const lists = await Promise.all([...feeds.map((f) => rss(f)), ...["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "tha.1"].map((lg) => espnNews(lg))]);
  const names = [...feeds.map((f) => f.source), ...["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "tha.1"].map((lg) => `ESPN ${lg}`)];
  const health = Object.fromEntries(names.map((n, i) => [n, lists[i].length]));
  return { items: lists.flat().slice(0, max), health };
}
