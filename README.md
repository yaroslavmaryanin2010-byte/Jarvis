# Джарвис

Агент для ответов заказчикам, расчёта стоимости печати и повседневных задач. Работает целиком на Cloudflare (Workers + D1 + Workers AI), ноутбук не нужен.

## Что внутри
- `src/agent.ts` — ядро: модель предлагает действия, безопасные выполняются сразу, остальные ждут вашего решения
- `src/ai.ts` — Anthropic, OpenAI, Google (через Cloudflare AI Gateway, если задан `AI_GATEWAY_URL`)
- `src/channels.ts` — Telegram (в т.ч. Business) и WhatsApp Business Cloud API
- `src/google.ts` — Google Календарь
- `src/pricing.ts` — расчёт цены печати по вашим тарифам
- `src/analytics.ts`, `src/index.ts` — аналитика, API, вебхуки, напоминания и вечерняя сводка
- `public/` — интерфейс (PWA): чат, голос, «Сегодня», аналитика, настройки

## Запуск
1. `npm install`, затем `npx wrangler login`
2. `npx wrangler d1 create jarvis` — вставьте выданный `database_id` в `wrangler.toml`
3. `npm run db:init`
4. Секреты (`npx wrangler secret put ИМЯ`):
   `APP_TOKEN` (ключ входа в приложение, придумайте длинный), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (любая случайная строка), `OWNER_TELEGRAM_ID` (ваш числовой id),
   `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` (нужные),
   `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `OWNER_WHATSAPP` (по желанию),
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (календарь)
5. `npm run deploy`
6. Telegram:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d url=https://<ваш-домен>/webhook/telegram \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET> \
     -d 'allowed_updates=["message","callback_query","business_message","business_connection"]'
   ```
   Чтобы бот видел сообщения клиентов в вашем личном Telegram: Настройки → Telegram для бизнеса → Чат-боты (нужен Premium).
7. WhatsApp: в Meta for Developers укажите вебхук `https://<ваш-домен>/webhook/whatsapp`, ваш verify token и подпишитесь на поле `messages`.
8. Откройте сайт, введите `APP_TOKEN`, «Добавить на экран Домой». В Настройках → Тарифы внесите те же цены, что в калькуляторе.

## Как устроены разрешения
Сразу: расчёт цены, напоминания, чтение календаря. С вашего разрешения: любое сообщение клиенту и создание событий. Запросы приходят кнопками в Telegram и в раздел «Сегодня». Правила — в `RISK` в `src/agent.ts`.

## Не сделано (следующие шаги)
- Web Push вместо уведомлений через Telegram
- Голосовые и фото от клиентов (сейчас только текст)
- WhatsApp: вне 24 часов после сообщения клиента нужны шаблоны сообщений
- Одобрение прямо из WhatsApp
