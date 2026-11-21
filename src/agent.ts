import type { Env, Action, Risk } from "./types";
import { chat, DEFAULT_MODELS, type Provider, type Msg } from "./ai";
import { getSetting, history, logActivity, saveMessage, now } from "./db";
import { calcPrice } from "./pricing";
import { listEvents, createEvent } from "./google";
import { notifyOwner, sendTo } from "./channels";

// Политика разрешений: low выполняется сразу, остальное ждёт решения владельца.
const RISK: Record<string, Risk> = {
  calc_price: "low", add_reminder: "low", calendar_list: "low",
  calendar_create: "medium", send_message: "high",
};

const TOOLS = `Инструменты (поле "tool", аргументы в "args"):
- calc_price {grams, hours, filament, qty?} — расчёт стоимости печати (за одну штуку)
- add_reminder {text, due_iso} — напоминание владельцу (ISO-время с часовым поясом)
- calendar_list {days?} — события календаря
- calendar_create {title, start_iso, end_iso?, notes?} — создать событие (нужно разрешение)
- send_message {channel, chat_id, text} — написать другому человеку (нужно разрешение)`;

function system(who: "owner" | "customer", env: Env): string {
  const base = `Ты — Джарвис, помощник владельца студии 3D-печати. Сейчас ${new Date().toISOString()} (UTC), владелец в часовом поясе UTC${Number(env.TZ_OFFSET_HOURS ?? 0) >= 0 ? "+" : ""}${env.TZ_OFFSET_HOURS ?? 0}.
Отвечай ТОЛЬКО JSON без пояснений и markdown: {"reply": "текст", "actions": [{"tool": "...", "args": {...}}]}.
Пиши по-русски, коротко и по делу. Не выдумывай цены и сроки: цену считай инструментом calc_price. Если не хватает данных (вес, время печати, пластик), спроси.
${TOOLS}`;
  return who === "owner"
    ? `${base}\nТебе пишет сам владелец. В "reply" — ответ ему.`
    : `${base}\nТебе пишет заказчик. В "reply" — черновик ответа заказчику от имени студии (вежливо, без обещаний, которые ты не можешь проверить). Не добавляй send_message: черновик уйдёт владельцу на утверждение.`;
}

function parse(raw: string): { reply: string; actions: Action[] } {
  const m = raw.match(/\{[\s\S]*\}/);
  try { const j = JSON.parse(m ? m[0] : raw); return { reply: String(j.reply ?? ""), actions: Array.isArray(j.actions) ? j.actions : [] }; }
  catch { return { reply: raw, actions: [] }; }
}

export async function execute(env: Env, tool: string, a: Record<string, any>): Promise<string> {
  switch (tool) {
    case "calc_price": return calcPrice(env, { grams: +a.grams, hours: +a.hours, filament: String(a.filament), qty: a.qty ? +a.qty : 1 });
    case "add_reminder": {
      const due = Math.floor(new Date(a.due_iso).getTime() / 1000);
      if (!due) throw new Error("Не понял время напоминания");
      await env.DB.prepare("INSERT INTO reminders(text,due_at) VALUES(?,?)").bind(a.text, due).run();
      return `Напоминание поставлено: ${a.text}`;
    }
    case "calendar_list": return listEvents(env, a.days ?? 3);
    case "calendar_create": return createEvent(env, a as any);
    case "send_message":
      await sendTo(env, a.channel, a.chat_id, a.text);
      await saveMessage(env, a.channel, a.chat_id, "jarvis", "out", a.text);
      return "Отправлено";
    default: throw new Error(`Неизвестный инструмент: ${tool}`);
  }
}

const label = (tool: string, a: Record<string, any>) =>
  tool === "send_message" ? `Ответ клиенту (${a.channel})` : tool === "calendar_create" ? `Событие: ${a.title}` : tool;

async function queue(env: Env, tool: string, args: Record<string, any>) {
  const id = await logActivity(env, tool, label(tool, args), args.text ?? args.notes ?? JSON.stringify(args), "pending", RISK[tool], { tool, args });
  await notifyOwner(env, `Нужно ваше решение: ${label(tool, args)}\n\n${args.text ?? JSON.stringify(args)}`,
    [{ text: "Разрешить", data: `ap:${id}` }, { text: "Отклонить", data: `rj:${id}` }]);
}

export async function decide(env: Env, id: number, approve: boolean): Promise<string> {
  const row = await env.DB.prepare("SELECT * FROM activity WHERE id=? AND status='pending'").bind(id).first<any>();
  if (!row) return "Уже обработано";
  if (!approve) {
    await env.DB.prepare("UPDATE activity SET status='rejected', resolved_at=? WHERE id=?").bind(now(), id).run();
    return "Отклонено";
  }
  const { tool, args } = JSON.parse(row.payload);
  try {
    const res = await execute(env, tool, args);
    await env.DB.prepare("UPDATE activity SET status='done', detail=?, resolved_at=? WHERE id=?").bind(res, now(), id).run();
    return res;
  } catch (e: any) {
    await env.DB.prepare("UPDATE activity SET status='failed', detail=?, resolved_at=? WHERE id=?").bind(String(e.message), now(), id).run();
    return `Ошибка: ${e.message}`;
  }
}

// Главный цикл: модель предлагает действия → безопасные выполняем → результат возвращаем модели → итоговый ответ.
export async function handle(env: Env, who: "owner" | "customer", channel: string, chatId: string, sender: string, text: string): Promise<string> {
  await saveMessage(env, channel, chatId, sender, "in", text);
  const cfg = await getSetting<{ provider: Provider; model: string }>(env, "model", { provider: "anthropic", model: DEFAULT_MODELS.anthropic });
  const msgs: Msg[] = await history(env, channel, chatId);
  let reply = "";
  try {
    for (let i = 0; i < 3; i++) {
      const raw = await chat(env, cfg.provider, cfg.model, system(who, env), msgs);
      const out = parse(raw);
      reply = out.reply;
      const results: string[] = [];
      const pending: Action[] = [];
      for (const a of out.actions) {
        const risk = RISK[a.tool];
        if (!risk) continue;
        if (risk === "low") {
          try {
            const r = await execute(env, a.tool, a.args ?? {});
            await logActivity(env, a.tool, label(a.tool, a.args ?? {}), r, "done", "low");
            results.push(`${a.tool}: ${r}`);
          } catch (e: any) {
            await logActivity(env, a.tool, label(a.tool, a.args ?? {}), String(e.message), "failed", "low");
            results.push(`${a.tool}: ошибка ${e.message}`);
          }
        } else pending.push(a);
      }
      if (!results.length || i === 2) { for (const p of pending) await queue(env, p.tool, p.args ?? {}); break; }
      msgs.push({ role: "assistant", content: raw },
        { role: "user", content: `Результаты инструментов:\n${results.join("\n")}\nДай итоговый ответ. Выполненные инструменты не повторяй.` });
    }
  } catch (e: any) {
    reply = `Не получилось связаться с моделью: ${e.message}`;
    await logActivity(env, "ai_error", "Ошибка модели", String(e.message), "failed", "low");
  }

  if (who === "customer") {
    // черновик ответа клиенту всегда уходит владельцу на утверждение
    if (reply) await queue(env, "send_message", { channel, chat_id: chatId, text: reply });
    await logActivity(env, "inbound", `Сообщение от клиента (${channel})`, text.slice(0, 200), "done", "low");
    return "";
  }
  await saveMessage(env, channel, chatId, "jarvis", "out", reply);
  return reply;
}
