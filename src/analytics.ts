import type { Env } from "./types";
import { dayStart, now } from "./db";

export async function analytics(env: Env, days = 7) {
  const since = dayStart(env, now() - (days - 1) * 86400);
  const off = Number(env.TZ_OFFSET_HOURS ?? 0) * 3600;
  const q = (sql: string, ...b: any[]) => env.DB.prepare(sql).bind(...b).all<any>().then((r) => r.results);

  const perDay = await q(
    `SELECT date(created_at + ?, 'unixepoch') AS day,
            SUM(direction='in' AND channel!='app') AS incoming,
            SUM(direction='out' AND channel!='app') AS outgoing
     FROM messages WHERE created_at >= ? GROUP BY day ORDER BY day`, off, since);
  const channels = await q("SELECT channel, COUNT(*) AS n FROM messages WHERE direction='in' AND channel!='app' AND created_at>=? GROUP BY channel", since);
  const status = await q("SELECT status, COUNT(*) AS n FROM activity WHERE created_at>=? GROUP BY status", since);
  const tools = await q("SELECT kind, COUNT(*) AS n FROM activity WHERE created_at>=? AND kind NOT IN ('inbound','ai_error') GROUP BY kind ORDER BY n DESC", since);
  const resp = await q(
    "SELECT AVG(resolved_at - created_at) AS avg_sec FROM activity WHERE kind='send_message' AND status='done' AND created_at>=?", since);
  const quotes = await q("SELECT COUNT(*) AS n FROM activity WHERE kind='calc_price' AND status='done' AND created_at>=?", since);

  return { days, perDay, channels, status, tools, approvalAvgSec: Math.round(resp[0]?.avg_sec ?? 0), quotes: quotes[0]?.n ?? 0 };
}
