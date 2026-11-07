import test from "node:test";
import assert from "node:assert/strict";
import { handleTelegramWebhook } from "../src/telegram.js";

const token = "123456:telegram-test-token";
const secret = "test_webhook_secret_123";
const update = (overrides = {}) => ({
  update_id: 123,
  message: {
    message_id: 1,
    from: { id: 77, is_bot: false },
    chat: { id: 77, type: "private" },
    text: "Halo BOR AI",
    ...overrides
  }
});
function setup(options = {}) {
  const sent = [];
  const calls = [];
  const env = {
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_WEBHOOK_SECRET: secret,
    ...(Object.prototype.hasOwnProperty.call(options, "limiter") ? { CHAT_LIMITER: { limit: async value => { calls.push(value); return { success: options.limiter }; } } } : {})
  };
  const deps = {
    fetcher: async (_url, init) => { sent.push(JSON.parse(init.body)); return Response.json({ ok: true }); },
    shouldUseMultiAgent: () => false,
    runAgent: async (_env, agent, message) => `Jawaban untuk ${message} dari ${agent}.`,
    runMultiAgent: async () => ({ response: "Jawaban multi-agent." }),
    withAiDeadline: value => value,
    enforceDailyLimits: async () => ({ ok: true, day: "2026-11-07", charges: [{ subject: "guest:test", units: 1 }] }),
    refundUsage: async () => {},
    singleAgentBudgetMs: 10000,
    multiAgentBudgetMs: 30000
  };
  return { env, deps, sent, calls };
}
function request(body, { method = "POST", webhookSecret = secret } = {}) {
  return new Request("https://example.test/api/integrations/telegram/webhook", {
    method,
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": webhookSecret },
    body: method === "POST" ? JSON.stringify(body) : undefined
  });
}

test("rejects requests without the configured Telegram webhook secret", async () => {
  const { env, deps } = setup();
  const result = await handleTelegramWebhook(request(update(), { webhookSecret: "wrong" }), env, deps);
  assert.equal(result.status, 401);
});

test("returns unavailable until bot token and webhook secret are configured", async () => {
  const { env, deps } = setup();
  delete env.TELEGRAM_BOT_TOKEN;
  const result = await handleTelegramWebhook(request(update()), env, deps);
  assert.equal(result.status, 503);
});

test("ignores group messages and bot senders", async () => {
  const { env, deps, sent } = setup();
  const group = update({ chat: { id: -100, type: "group" } });
  const result = await handleTelegramWebhook(request(group), env, deps);
  assert.deepEqual(await result.json(), { ok: true, ignored: true });
  assert.equal(sent.length, 0);
});

test("answers /start without invoking the model", async () => {
  const { env, deps, sent } = setup();
  const result = await handleTelegramWebhook(request(update({ text: "/start" })), env, deps);
  assert.equal(result.status, 200);
  assert.match(sent[0].text, /Halo! Gw BOR AI/);
});

test("routes a private text message through Coordinator and sends the answer", async () => {
  const { env, deps, sent } = setup();
  const result = await handleTelegramWebhook(request(update()), env, deps);
  assert.deepEqual(await result.json(), { ok: true });
  assert.equal(sent[0].chat_id, 77);
  assert.match(sent[0].text, /Jawaban untuk Halo BOR AI dari coordinator/);
});

test("uses per-Telegram-user rate limiting", async () => {
  const { env, deps, sent, calls } = setup({ limiter: false });
  const result = await handleTelegramWebhook(request(update()), env, deps);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { key: "telegram:77" });
  assert.match(sent[0].text, /Terlalu banyak permintaan/);
});

test("charges the existing guest daily quota using a Telegram-specific identity", async () => {
  const { env, deps } = setup();
  let quotaRequest;
  deps.enforceDailyLimits = async (_env, request, user, units) => {
    quotaRequest = { ip: request.headers.get("CF-Connecting-IP"), user, units };
    return { ok: true, day: "2026-11-07", charges: [] };
  };
  await handleTelegramWebhook(request(update()), env, deps);
  assert.deepEqual(quotaRequest, { ip: "telegram-user:77", user: null, units: 1 });
});

test("refunds quota if model generation fails", async () => {
  const { env, deps, sent } = setup();
  let refunded = false;
  deps.runAgent = async () => { throw new Error("AI unavailable"); };
  deps.refundUsage = async () => { refunded = true; };
  await handleTelegramWebhook(request(update()), env, deps);
  assert.equal(refunded, true);
  assert.match(sent[0].text, /gagal memproses/);
});

test("rejects non-POST methods", async () => {
  const { env, deps } = setup();
  const result = await handleTelegramWebhook(request(null, { method: "GET" }), env, deps);
  assert.equal(result.status, 405);
});
