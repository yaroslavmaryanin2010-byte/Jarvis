import type { Env } from "./types";

export type Button = { text: string; data: string };

// chat_id для Telegram Business хранится как "<chat_id>|<business_connection_id>"
export async function tgSend(env: Env, chatId: string, text: string, buttons?: Button[]) {
  const [id, bc] = chatId.split("|");
  const body: any = { chat_id: id, text };
  if (bc) body.business_connection_id = bc;
  if (buttons?.length) body.reply_markup = { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] };
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Telegram: ${r.status} ${await r.text()}`);
}

export async function tgAnswerCallback(env: Env, id: string, text: string) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callback_query_id: id, text }),
  });
}

// WhatsApp Business Cloud API. Свободный текст — только в течение 24 ч после сообщения клиента.
export async function waSend(env: Env, to: string, text: string) {
  const r = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
  if (!r.ok) throw new Error(`WhatsApp: ${r.status} ${await r.text()}`);
}

export async function verifyWhatsApp(env: Env, raw: string, sigHeader: string | null): Promise<boolean> {
  if (!sigHeader?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.WHATSAPP_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === sigHeader.slice(7);
}

export async function sendTo(env: Env, channel: string, chatId: string, text: string) {
  if (channel === "telegram") return tgSend(env, chatId, text);
  if (channel === "whatsapp") return waSend(env, chatId, text);
  throw new Error(`Неизвестный канал: ${channel}`);
}

// Уведомления владельцу (приходят пушем на телефон через Telegram)
export async function notifyOwner(env: Env, text: string, buttons?: Button[]) {
  try { await tgSend(env, env.OWNER_TELEGRAM_ID, text, buttons); } catch (e) { console.error("notify failed", e); }
}
