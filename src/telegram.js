import { safeError } from "./safe-error.js";
const MAX_UPDATE_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 4000;
const TELEGRAM_TEXT_LIMIT = 3900;

const COMMANDS = {
  "/start": "Halo! Gw BOR AI. Gw adalah AI assistant dengan kemampuan multi-agent untuk membantu menjawab pertanyaan, menganalisis informasi, menyusun tulisan, merencanakan pekerjaan, dan membantu coding.\n\nKirim pertanyaan atau instruksi untuk mulai. Gunakan /help untuk melihat perintah.\n\nCatatan: bot belum menyimpan riwayat percakapan Telegram. Jangan kirim password, API key, atau data sensitif.",
  "/help": "Perintah BOR AI:\n/start — Mulai menggunakan BOR AI\n/help — Tampilkan panduan perintah\n/about — Tentang BOR AI\n/status — Status layanan bot\n/agents — Lihat daftar spesialis AI\n\nKirim pesan biasa untuk bertanya atau memberi instruksi kepada BOR AI.",
  "/about": "BOR AI — Your Intelligent AI Command Center.\n\nBOR AI adalah AI assistant yang menggunakan Coordinator dan orkestrasi multi-agent untuk membantu menjawab pertanyaan, menganalisis informasi, menyusun konten, merencanakan pekerjaan, dan membantu coding.\n\nDibangun di atas Cloudflare Workers dan Workers AI.\n\nWebsite: https://ai-command-center.muhriskiawan23.workers.dev\nRepository: https://github.com/muhriskiawan23/ai-command-center\n\nTelegram saat ini tidak menyimpan riwayat percakapan.",
  "/status": "BOR AI Telegram: ONLINE\nWebhook berhasil menerima pesan ini dan layanan bot sedang merespons.\n\nModel AI dipanggil saat kamu mengirim pesan biasa. Status ini bukan pemeriksaan menyeluruh terhadap seluruh layanan eksternal.",
  "/agents": "Spesialis BOR AI:\n• Coordinator — mengarahkan permintaan dan menyusun jawaban\n• Researcher — menyusun brief konteks dan fakta\n• Analyst — menganalisis data dan masalah\n• Writer — menyusun tulisan dan konten\n• Fact Checker — memeriksa konsistensi klaim\n• Strategist — mengevaluasi strategi dan pilihan\n• Coder — membantu pemrograman\n• Planner — menyusun rencana dan langkah kerja\n• Critic — meninjau kelemahan dan risiko\n• Summarizer — merangkum informasi\n• Translator — membantu penerjemahan\n• Text Analyst — menganalisis teks"
};

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
  if (new TextEncoder().encode(raw).byteLength > MAX_UPDATE_BYTES) return response({ error: "Update terlalu besar." }, 413);
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
    catch (error) { console.error("Telegram reply failed:", safeError(error)); }
    return response({ ok: true });
  }

  const command = commandName(text);
  if (Object.hasOwn(COMMANDS, command)) {
    try {
      await sendTelegramMessage(token, chat.id, COMMANDS[command], deps.fetcher);
    } catch (error) {
      console.error("Telegram command failed:", safeError(error));
      return response({ error: "Pesan Telegram gagal dikirim." }, 502);
    }
    return response({ ok: true, command });
  }
  if (text.startsWith("/")) {
    try { await sendTelegramMessage(token, chat.id, "Perintah tidak dikenal. Gunakan /help untuk melihat daftar perintah BOR AI.", deps.fetcher); }
    catch (error) { console.error("Telegram unknown-command reply failed:", safeError(error)); }
    return response({ ok: true, unknownCommand: true });
  }

  if (env.CHAT_LIMITER?.limit) {
    try {
      const limited = await env.CHAT_LIMITER.limit({ key: `telegram:${sender.id}` });
      if (!limited?.success) {
        await sendTelegramMessage(token, chat.id, "Terlalu banyak permintaan. Tunggu sekitar satu menit lalu coba lagi.", deps.fetcher);
        return response({ ok: true, rateLimited: true });
      }
    } catch (error) {
      console.error("Telegram rate limiter failed:", safeError(error));
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
    catch (error) { console.error("Telegram quota reply failed:", safeError(error)); }
    return response({ ok: true, quotaLimited: true });
  }

  try {
    const timeout = useMultiAgent ? deps.multiAgentBudgetMs : deps.singleAgentBudgetMs;
    const modelTrace = [];
    const aiEnv = deps.withAiDeadline({ ...env, MODEL_TRACE: modelTrace }, Date.now() + timeout, request.signal);
    const result = useMultiAgent
      ? await deps.runMultiAgent(aiEnv, text, [], "")
      : { response: await deps.runAgent(aiEnv, "coordinator", text, "", [], "") };
    const answer = typeof result?.response === "string" ? result.response.trim() : "";
    if (!answer) throw new Error("BOR AI returned an empty response");
    await sendTelegramMessage(token, chat.id, answer, deps.fetcher);
    return response({ ok: true });
  } catch (error) {
    await deps.refundUsage(env, usage.day, usage.charges);
    console.error("Telegram AI request failed:", safeError(error));
    try { await sendTelegramMessage(token, chat.id, "Maaf, BOR AI gagal memproses pesan ini. Coba lagi beberapa saat.", deps.fetcher); }
    catch (sendError) { console.error("Telegram error reply failed:", safeError(sendError)); }
    return response({ ok: true, generationFailed: true });
  }
}
