const MAX_UPDATE_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 4000;
const TELEGRAM_TEXT_LIMIT = 3900;

function response(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function validTelegramId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function commandName(text) {
  const first = text.trim().split(/\s+/, 1)[0].toLowerCase();
  return first.split("@", 1)[0];
}

async function sendTelegramMessage(token, chatId, text, fetcher) {
  const safeText = String(text || "Maaf, BOR AI belum bisa memberikan jawaban. Coba lagi.").slice(0, TELEGRAM_TEXT_LIMIT);
  const result = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: safeText, disable_web_page_preview: true })
  });
  if (!result.ok) throw new Error(`Telegram sendMessage failed with HTTP ${result.status}`);
  const payload = await result.json().catch(() => null);
  if (!payload?.ok) throw new Error("Telegram sendMessage returned an unsuccessful result");
}

export async function handleTelegramWebhook(request, env, deps) {
  if (request.method !== "POST") return response({ error: "Metode HTTP tidak didukung." }, 405);
  const token = env.TELEGRAM_BOT_TOKEN;
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (typeof token !== "string" || !token.trim() || typeof secret !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    return response({ error: "Integrasi Telegram belum dikonfigurasi." }, 503);
  }
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== secret) return response({ error: "Webhook tidak terautentikasi." }, 401);

  const length = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(length) && length > MAX_UPDATE_BYTES) return response({ error: "Update terlalu besar." }, 413);
  let raw;
  try { raw = await request.text(); } catch { return response({ error: "Update tidak dapat dibaca." }, 400); }
  if (raw.length > MAX_UPDATE_BYTES) return response({ error: "Update terlalu besar." }, 413);
  let update;
  try { update = JSON.parse(raw); } catch { return response({ error: "JSON update tidak valid." }, 400); }

  const message = update?.message;
  const chat = message?.chat;
  const sender = message?.from;
  if (!validTelegramId(chat?.id) || !validTelegramId(sender?.id) || sender.is_bot || chat.type !== "private") {
    return response({ ok: true, ignored: true });
  }
  if (typeof message.text !== "string" || !message.text.trim()) return response({ ok: true, ignored: true });
  const text = message.text.trim();
  if (text.length > MAX_MESSAGE_CHARS) {
    try { await sendTelegramMessage(token, chat.id, "Pesan terlalu panjang. Batasnya 4.000 karakter per pesan.", deps.fetcher); }
    catch (error) { console.error("Telegram reply failed:", error); }
    return response({ ok: true });
  }

  const command = commandName(text);
  if (command === "/start" || command === "/help") {
    const greeting = "Halo! Gw BOR AI. Kirim pertanyaan atau instruksi dalam chat pribadi ini untuk mulai.\n\nCatatan: bot belum menyimpan riwayat percakapan Telegram. Jangan kirim password, API key, atau data sensitif.";
    try { await sendTelegramMessage(token, chat.id, greeting, deps.fetcher); }
    catch (error) { console.error("Telegram welcome failed:", error); return response({ error: "Pesan Telegram gagal dikirim." }, 502); }
    return response({ ok: true });
  }

  if (env.CHAT_LIMITER?.limit) {
    try {
      const limited = await env.CHAT_LIMITER.limit({ key: `telegram:${sender.id}` });
      if (!limited?.success) {
        await sendTelegramMessage(token, chat.id, "Terlalu banyak permintaan. Tunggu sekitar satu menit lalu coba lagi.", deps.fetcher);
        return response({ ok: true, rateLimited: true });
      }
    } catch (error) {
      console.error("Telegram rate limiter failed:", error);
      return response({ error: "Pembatasan permintaan sedang bermasalah." }, 503);
    }
  }

  const useMultiAgent = deps.shouldUseMultiAgent(text);
  const units = useMultiAgent ? 3 : 1;
  const quotaRequest = new Request(request.url, {
    method: "POST",
    headers: { "CF-Connecting-IP": `telegram-user:${sender.id}` }
  });
  const usage = await deps.enforceDailyLimits(env, quotaRequest, null, units);
  if (!usage.ok) {
    const data = await usage.response.json().catch(() => ({}));
    try { await sendTelegramMessage(token, chat.id, data.error || "Batas penggunaan harian tercapai. Coba lagi besok.", deps.fetcher); }
    catch (error) { console.error("Telegram quota reply failed:", error); }
    return response({ ok: true, quotaLimited: true });
  }

  try {
    const timeout = useMultiAgent ? deps.multiAgentBudgetMs : deps.singleAgentBudgetMs;
    const aiEnv = deps.withAiDeadline(env, Date.now() + timeout, request.signal);
    const result = useMultiAgent
      ? await deps.runMultiAgent(aiEnv, text, [], "")
      : { response: await deps.runAgent(aiEnv, "coordinator", text, "", [], "") };
    const answer = typeof result?.response === "string" ? result.response.trim() : "";
    if (!answer) throw new Error("BOR AI returned an empty response");
    await sendTelegramMessage(token, chat.id, answer, deps.fetcher);
    return response({ ok: true });
  } catch (error) {
    await deps.refundUsage(env, usage.day, usage.charges);
    console.error("Telegram AI request failed:", error);
    try { await sendTelegramMessage(token, chat.id, "Maaf, BOR AI gagal memproses pesan ini. Coba lagi beberapa saat.", deps.fetcher); }
    catch (sendError) { console.error("Telegram error reply failed:", sendError); }
    return response({ ok: true, generationFailed: true });
  }
}
