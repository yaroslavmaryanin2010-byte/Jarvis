export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  TZ_OFFSET_HOURS?: string;
  DIGEST_HOUR?: string;
  AI_GATEWAY_URL?: string;
  // секреты (wrangler secret put ...)
  APP_TOKEN: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  OWNER_TELEGRAM_ID: string;
  WHATSAPP_TOKEN: string;
  WHATSAPP_PHONE_ID: string;
  WHATSAPP_VERIFY_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
  OWNER_WHATSAPP?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
}
export type Risk = "low" | "medium" | "high";
export interface Action { tool: string; args: Record<string, any>; }
