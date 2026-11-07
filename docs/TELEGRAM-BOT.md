# Telegram Bot Integration

BOR AI can receive private Telegram text messages through a Cloudflare Worker webhook. The integration reuses the existing Workers AI model, Coordinator/multi-agent orchestration, daily usage counters, and chat rate limiter. It does not add a paid API or a new database table.

## Security and behavior

- Only private chats are processed. Group chats, channel posts, bot senders, media-only updates, and unsupported update types are ignored.
- Every webhook request must include Telegram's `X-Telegram-Bot-Api-Secret-Token` header matching the `TELEGRAM_WEBHOOK_SECRET` Worker secret.
- The bot token is stored only as the `TELEGRAM_BOT_TOKEN` Worker secret; it is never embedded in source code or frontend assets.
- Telegram users are charged against the existing guest daily quota using a Telegram-user-specific pseudonymous subject, plus the global daily quota. The existing per-minute limiter is also keyed by Telegram user ID.
- Telegram chat content is not persisted in D1 and no conversation history is retained. Users should not send passwords, API keys, or sensitive data.
- The webhook accepts text only, up to 4,000 characters. Replies are sent as plain text and truncated safely below Telegram's message limit.
- No automatic bot creation or webhook registration is performed by deployment. A bot owner must configure the credentials and webhook deliberately.

## One-time setup

1. In Telegram, open **@BotFather**, run `/newbot`, and follow its prompts. Copy the bot token privately.
2. Generate a webhook secret containing 32–64 random characters from `A-Z a-z 0-9 _ -`. Keep it private.
3. Configure both secrets for the production Worker (do not commit them):
   ```sh
   npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.jsonc
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config wrangler.jsonc
   ```
4. Register the webhook from a trusted terminal, replacing the placeholders. The webhook URL is:
   `https://ai-command-center.muhriskiawan23.workers.dev/api/integrations/telegram/webhook`
   ```sh
   curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://ai-command-center.muhriskiawan23.workers.dev/api/integrations/telegram/webhook","secret_token":"<TELEGRAM_WEBHOOK_SECRET>","allowed_updates":["message"]}'
   ```
5. Check the response from Telegram for `"ok": true`, then send `/start` to your bot in a private chat.

To inspect the webhook, call Telegram's `getWebhookInfo` endpoint from a trusted terminal. To disable it, call `deleteWebhook`. Never paste the bot token or secret into a public issue, chat, commit, or screenshot.

## Operational notes

- The webhook returns HTTP 200 for handled Telegram updates, including AI failures after attempting to notify the user. Telegram may retry deliveries when it receives a non-2xx response, so the handler avoids returning an error after a model failure.
- The existing Worker rate limiter allows 20 requests per minute per key (subject to Cloudflare's approximate per-location behavior). Existing daily guest/global limits remain the main usage guardrail.
- This integration is not activated until the two Worker secrets are configured and Telegram's webhook is registered.
