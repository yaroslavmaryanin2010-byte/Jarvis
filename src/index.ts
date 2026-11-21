import type { Env } from "./types";
import { handle, decide } from "./agent";
import { analytics } from "./analytics";
import { DEFAULT_MODELS } from "./ai";
import { dayStart, getSetting, setSetting, history, logActivity, now } from "./db";
import { tgSend, tgAnswerCallback, waSend, verifyWhatsApp, notifyOwner } from "./channels";

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/webhook/telegram" && req.method === "POST") {
      if (req.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
      const update = await req.json();
      ctx.waitUntil(onTelegram(env, update).catch((e) => console.error(e)));
      return new Response("ok");
    }

    if (p === "/webhook/whatsapp") {
      if (req.method === "GET") {
        const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === env.WHATSAPP_VERIFY_TOKEN;
        return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("forbidden", { status: 403 });
      }
      const raw = await req.text();
      if (!(await verifyWhatsApp(env, raw, req.headers.get("x-hub-signature-256")))) return new Response("forbidden", { status: 403 });
      ctx.waitUntil(onWhatsApp(env, JSON.parse(raw)).catch((e) => console.error(e)));
      return new Response("ok");
    }

    if (p.startsWith("/api/")) {
      if (req.headers.get("authorization") !== `Bearer ${env.APP_TOKEN}`) return json({ error: "unauthorized" }, 401);
      return api(req, env, p, url);
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(tick(env));
  },
};

async function onTelegram(env: Env, u: any) {
  if (u.callback_query) {
    const cq = u.callback_query;
    if (String(cq.from.id) !== env.OWNER_TELEGRAM_ID) return;
    const [act, id] = String(cq.data).split(":");
    const res = await decide(env, Number(id), act === "ap");
    await tgAnswerCallback(env, cq.id, res.slice(0, 190));
    return;
  }
  const biz = !!u.business_message; // Telegram Business: сообщения из вашего личного аккаунта
  const m = u.message ?? u.business_message;
  if (!m?.text) return;
  const chatId = biz ? `${m.chat.id}|${m.business_connection_id}` : String(m.chat.id);
  const fromOwner = String(m.from?.id) === env.OWNER_TELEGRAM_ID;
  if (fromOwner) {
    if (biz) return; // свои сообщения в бизнес-чатах не обрабатываем
    const reply = await handle(env, "owner", "telegram", chatId, "owner", m.text);
    if (reply) await tgSend(env, chatId, reply);
  } else {
    await handle(env, "customer", "telegram", chatId, m.from?.first_name ?? "клиент", m.text);
  }
}

async function onWhatsApp(env: Env, body: any) {
  for (const entry of body.entry ?? []) for (const ch of entry.changes ?? []) for (const m of ch.value?.messages ?? []) {
    if (m.type !== "text") continue;
    const name = ch.value?.contacts?.[0]?.profile?.name ?? m.from;
    if (env.OWNER_WHATSAPP && m.from === env.OWNER_WHATSAPP) {
      const reply = await handle(env, "owner", "whatsapp", m.from, "owner", m.text.body);
      if (reply) await waSend(env, m.from, reply);
    } else {
      await handle(env, "customer", "whatsapp", m.from, name, m.text.body);
    }
  }
}

async function api(req: Request, env: Env, p: string, url: URL): Promise<Response> {
  if (p === "/api/chat" && req.method === "POST") {
    const { text } = await req.json<{ text: string }>();
    return json({ reply: await handle(env, "owner", "app", "owner", "owner", text) });
  }
  if (p === "/api/messages") return json(await history(env, "app", "owner", 60));

  if (p === "/api/today") {
    const pending = await env.DB.prepare("SELECT id,kind,title,detail,risk,created_at FROM activity WHERE status='pending' ORDER BY id").all();
    const done = await env.DB.prepare("SELECT id,kind,title,detail,status,created_at FROM activity WHERE status!='pending' AND created_at>=? ORDER BY id DESC LIMIT 100")
      .bind(dayStart(env)).all();
    return json({ pending: pending.results, done: done.results });
  }
  if (p === "/api/approve" && req.method === "POST") {
    const { id, approve } = await req.json<{ id: number; approve: boolean }>();
    return json({ result: await decide(env, id, approve) });
  }
  if (p === "/api/analytics") return json(await analytics(env, Number(url.searchParams.get("days") ?? 7)));

  if (p === "/api/settings") {
    if (req.method === "PUT") {
      const b = await req.json<any>();
      if (b.model) await setSetting(env, "model", b.model);
      if (b.rates) await setSetting(env, "rates", b.rates);
      return json({ ok: true });
    }
    return json({
      model: await getSetting(env, "model", { provider: "anthropic", model: DEFAULT_MODELS.anthropic }),
      rates: await getSetting(env, "rates", null),
      defaults: DEFAULT_MODELS,
      keys: { anthropic: !!env.ANTHROPIC_API_KEY, openai: !!env.OPENAI_API_KEY, google: !!env.GOOGLE_API_KEY },
      calendar: !!env.GOOGLE_REFRESH_TOKEN,
    });
  }

  if (p === "/api/stt" && req.method === "POST") {
    const bytes = new Uint8Array(await req.arrayBuffer());
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const out: any = await env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: btoa(bin), language: "ru" });
    return json({ text: out.text ?? "" });
  }
  return json({ error: "not found" }, 404);
}

// Раз в минуту: напоминания и вечерняя сводка дня
async function tick(env: Env) {
  const due = await env.DB.prepare("SELECT id,text FROM reminders WHERE sent=0 AND due_at<=?").bind(now()).all<{ id: number; text: string }>();
  for (const r of due.results) {
    await notifyOwner(env, `Напоминание: ${r.text}`);
    await env.DB.prepare("UPDATE reminders SET sent=1 WHERE id=?").bind(r.id).run();
    await logActivity(env, "reminder", `Напоминание: ${r.text}`, "", "done", "low");
  }

  const local = new Date((now() + Number(env.TZ_OFFSET_HOURS ?? 0) * 3600) * 1000);
  if (local.getUTCHours() === Number(env.DIGEST_HOUR ?? 20) && local.getUTCMinutes() === 0) {
    const s = await env.DB.prepare("SELECT status, COUNT(*) n FROM activity WHERE created_at>=? AND kind NOT IN ('inbound') GROUP BY status")
      .bind(dayStart(env)).all<{ status: string; n: number }>();
    const n = (k: string) => s.results.find((x) => x.status === k)?.n ?? 0;
    await notifyOwner(env, `Итоги дня: выполнено ${n("done")}, ждут решения ${n("pending")}, отклонено ${n("rejected")}, ошибок ${n("failed")}.`);
  }
}
