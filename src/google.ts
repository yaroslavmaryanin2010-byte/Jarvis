import type { Env } from "./types";

async function token(env: Env): Promise<string> {
  if (!env.GOOGLE_REFRESH_TOKEN) throw new Error("Google Календарь не подключён");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? "", client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Google OAuth: ${j.error_description ?? r.status}`);
  return j.access_token;
}

export async function listEvents(env: Env, days = 3): Promise<string> {
  const t = await token(env);
  const from = new Date(); const to = new Date(Date.now() + days * 86400_000);
  const u = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  u.search = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "20" }).toString();
  const j: any = await (await fetch(u, { headers: { authorization: `Bearer ${t}` } })).json();
  const items = (j.items ?? []).map((e: any) => `${e.start?.dateTime ?? e.start?.date} — ${e.summary}`);
  return items.length ? items.join("\n") : "Событий нет";
}

export async function createEvent(env: Env, a: { title: string; start_iso: string; end_iso?: string; notes?: string }): Promise<string> {
  const t = await token(env);
  const end = a.end_iso ?? new Date(new Date(a.start_iso).getTime() + 3600_000).toISOString();
  const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
    body: JSON.stringify({ summary: a.title, description: a.notes, start: { dateTime: a.start_iso }, end: { dateTime: end } }),
  });
  if (!r.ok) throw new Error(`Calendar: ${r.status}`);
  return `Событие «${a.title}» создано`;
}
