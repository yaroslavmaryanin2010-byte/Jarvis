import type { Env, Risk } from "./types";

export const now = () => Math.floor(Date.now() / 1000);

export function dayStart(env: Env, ts = now()): number {
  const off = Number(env.TZ_OFFSET_HOURS ?? 0) * 3600;
  return Math.floor((ts + off) / 86400) * 86400 - off;
}

export async function getSetting<T>(env: Env, key: string, fallback: T): Promise<T> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first<{ value: string }>();
  return r ? (JSON.parse(r.value) as T) : fallback;
}
export async function setSetting(env: Env, key: string, value: unknown) {
  await env.DB.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(key, JSON.stringify(value)).run();
}

export async function saveMessage(env: Env, channel: string, chatId: string, sender: string, direction: "in" | "out", text: string) {
  await env.DB.prepare("INSERT INTO messages(channel,chat_id,sender,direction,text,created_at) VALUES(?,?,?,?,?,?)")
    .bind(channel, chatId, sender, direction, text, now()).run();
}

export async function history(env: Env, channel: string, chatId: string, limit = 12) {
  const { results } = await env.DB.prepare(
    "SELECT direction,text FROM messages WHERE channel=? AND chat_id=? ORDER BY id DESC LIMIT ?"
  ).bind(channel, chatId, limit).all<{ direction: string; text: string }>();
  return results.reverse().map((m) => ({ role: (m.direction === "in" ? "user" : "assistant") as "user" | "assistant", content: m.text }));
}

export async function logActivity(
  env: Env, kind: string, title: string, detail: string, status: string, risk: Risk, payload?: unknown
): Promise<number> {
  const r = await env.DB.prepare(
    "INSERT INTO activity(kind,title,detail,status,risk,payload,created_at,resolved_at) VALUES(?,?,?,?,?,?,?,?)"
  ).bind(kind, title, detail, status, risk, payload ? JSON.stringify(payload) : null, now(), status === "pending" ? null : now()).run();
  return r.meta.last_row_id as number;
}
