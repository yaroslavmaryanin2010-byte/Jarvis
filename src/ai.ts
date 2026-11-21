import type { Env } from "./types";

export type Provider = "anthropic" | "openai" | "google";
export interface Msg { role: "user" | "assistant"; content: string }

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-4.1-mini",     // можно сменить в Настройках
  google: "gemini-2.5-flash", // можно сменить в Настройках
};

// Если задан AI_GATEWAY_URL, запросы идут через Cloudflare AI Gateway (логи, кэш, лимиты).
export async function chat(env: Env, provider: Provider, model: string, system: string, messages: Msg[]): Promise<string> {
  const gw = env.AI_GATEWAY_URL?.replace(/\/$/, "");

  if (provider === "anthropic") {
    const url = gw ? `${gw}/anthropic/v1/messages` : "https://api.anthropic.com/v1/messages";
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1500, system, messages }),
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error(`Anthropic: ${j?.error?.message ?? r.status}`);
    return j.content?.[0]?.text ?? "";
  }

  if (provider === "openai") {
    const url = gw ? `${gw}/openai/chat/completions` : "https://api.openai.com/v1/chat/completions";
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY ?? ""}` },
      body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages] }),
    });
    const j: any = await r.json();
    if (!r.ok) throw new Error(`OpenAI: ${j?.error?.message ?? r.status}`);
    return j.choices?.[0]?.message?.content ?? "";
  }

  const url = gw
    ? `${gw}/google-ai-studio/v1beta/models/${model}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GOOGLE_API_KEY ?? "" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    }),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Google: ${j?.error?.message ?? r.status}`);
  return j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
