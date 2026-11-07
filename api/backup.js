// Backup of everything the app has learned (เมดูซ่า 3.1). Needs CRON_SECRET (Vercel env).
//   GET  /api/backup              -> download the live data as one JSON file
//   POST /api/backup {restore:1}  -> put the weekly copy (bak:*) back in place
// Send the header  Authorization: Bearer <CRON_SECRET>
import { kv, kvPipe, kvEnabled, readBody } from "../lib/kv.js";
import { BACKUP_KEYS } from "./cron.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.status(403).json({ error: "ตั้งค่า CRON_SECRET ใน Vercel ก่อนจึงจะใช้การสำรองข้อมูลได้" }); return; }
  if (req.headers?.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: "unauthorized" }); return; }
  if (!kvEnabled) { res.status(200).json({ error: "no database" }); return; }
  if (req.method === "POST") {
    if (!readBody(req).restore) { res.status(400).json({ error: "send {\"restore\":1}" }); return; }
    const out = await kvPipe(BACKUP_KEYS.map((k) => ["COPY", `bak:${k}`, k, "REPLACE"]));
    res.status(200).json({ ok: true, restored: BACKUP_KEYS.filter((_, i) => out[i] === 1) });
    return;
  }
  const types = await kvPipe(BACKUP_KEYS.map((k) => ["TYPE", k]));
  const read = BACKUP_KEYS.map((k, i) => types[i] === "list" ? ["LRANGE", k, "0", "-1"] : types[i] === "hash" ? ["HGETALL", k] : types[i] === "set" ? ["SMEMBERS", k] : ["GET", k]);
  const vals = await kvPipe(read);
  const data = Object.fromEntries(BACKUP_KEYS.map((k, i) => [k, { type: types[i], value: vals[i] }]));
  res.setHeader("Content-Disposition", `attachment; filename="goal-club-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.status(200).json({ at: new Date().toISOString(), keys: data });
}
