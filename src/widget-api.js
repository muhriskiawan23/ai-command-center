const MAX_ORIGINS = 5;
const DEFAULT_DAILY_LIMIT = 100;
const MAX_DAILY_LIMIT = 500;
const KEY_PREFIX = "borai_live_";

function validOrigin(value) {
  if (typeof value !== "string" || value.length > 300) return false;
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) && !url.username && !url.password;
  } catch { return false; }
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function requireOwner(request, env, deps) {
  if (!deps.sameOrigin(request)) return { error: deps.json({ error: "Origin tidak valid." }, 403) };
  let user;
  try { user = await deps.getSession(request, env); }
  catch { return { error: deps.json({ error: "Status login tidak dapat diperiksa." }, 503) }; }
  if (!user) return { error: deps.json({ error: "Masuk dengan Google untuk mengelola API key." }, 401) };
  return { user };
}

export async function handleDeveloperKeysRoute(request, env, url, deps) {
  if (!env.DB) return deps.json({ error: "Database tidak tersedia." }, 503);
  const owner = await requireOwner(request, env, deps);
  if (owner.error) return owner.error;

  if (url.pathname === "/api/developer/keys" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id, label, allowed_origins, daily_limit, created_at, revoked_at FROM public_api_keys WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
    ).bind(owner.user.id).all();
    return deps.json({ keys: (result.results || []).map(row => ({
      id: row.id, label: row.label, origins: JSON.parse(row.allowed_origins),
      dailyLimit: Number(row.daily_limit), createdAt: Number(row.created_at),
      revoked: row.revoked_at !== null
    })) });
  }

  if (url.pathname === "/api/developer/keys" && request.method === "POST") {
    const parsed = await request.json().catch(() => null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return deps.json({ error: "Body JSON tidak valid." }, 400);
    const label = typeof parsed.label === "string" ? parsed.label.trim().slice(0, 60) : "";
    const origins = parsed.origins;
    const dailyLimit = parsed.dailyLimit === undefined ? DEFAULT_DAILY_LIMIT : parsed.dailyLimit;
    if (!label) return deps.json({ error: "Label API key wajib diisi." }, 400);
    if (!Array.isArray(origins) || origins.length < 1 || origins.length > MAX_ORIGINS || origins.some(origin => !validOrigin(origin)) || new Set(origins).size !== origins.length) {
      return deps.json({ error: "Isi 1–5 origin HTTPS yang valid dan unik. HTTP hanya diizinkan untuk localhost." }, 400);
    }
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > MAX_DAILY_LIMIT) return deps.json({ error: "Kuota harian harus 1–500." }, 400);
    const id = crypto.randomUUID();
    const secret = KEY_PREFIX + deps.randomToken(32);
    const keyHash = await deps.sha256Hex(secret);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO public_api_keys (id, user_id, key_hash, label, allowed_origins, daily_limit, daily_used, usage_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, '', ?, ?)"
    ).bind(id, owner.user.id, keyHash, label, JSON.stringify(origins), dailyLimit, now, now).run();
    return deps.json({ id, key: secret, label, origins, dailyLimit, warning: "Salin API key sekarang. Secret hanya ditampilkan sekali." }, 201);
  }

  const match = url.pathname.match(/^\/api\/developer\/keys\/([a-f0-9-]{36})$/i);
  if (match && request.method === "DELETE") {
    const result = await env.DB.prepare(
      "UPDATE public_api_keys SET revoked_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
    ).bind(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), match[1], owner.user.id).run();
    if (!result.meta?.changes) return deps.json({ error: "API key tidak ditemukan atau sudah dicabut." }, 404);
    return deps.json({ revoked: true, id: match[1] });
  }
  return deps.json({ error: "Metode HTTP tidak didukung untuk endpoint ini." }, 405, { Allow: url.pathname.endsWith("/keys") ? "GET, POST" : "DELETE" });
}

export async function handlePublicChatRoute(request, env, deps) {
  const origin = request.headers.get("Origin") || "";
  if (request.method === "OPTIONS") {
    if (!origin || origin.length > 300) return deps.json({ error: "Origin tidak valid." }, 403);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") return deps.json({ error: "Metode HTTP tidak didukung." }, 405, { Allow: "POST, OPTIONS" });
  const fail = (message, status, extra = {}) => withCors(deps.json({ error: message }, status, extra), origin || "null");
  if (!validOrigin(origin)) return deps.json({ error: "Origin HTTPS yang valid wajib disertakan." }, 403);
  const match = (request.headers.get("Authorization") || "").match(/^Bearer (borai_live_[A-Za-z0-9_-]{30,})$/);
  if (!match) return fail("API key tidak valid atau tidak ditemukan.", 401);
  if (!env.DB) return fail("Database tidak tersedia.", 503);

  const keyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(match[1]));
  const hash = [...new Uint8Array(keyHash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const row = await env.DB.prepare(
    "SELECT id, allowed_origins, daily_limit FROM public_api_keys WHERE key_hash = ? AND revoked_at IS NULL"
  ).bind(hash).first();
  if (!row) return fail("API key tidak valid atau sudah dicabut.", 401);
  let allowed;
  try { allowed = JSON.parse(row.allowed_origins); } catch { return fail("Konfigurasi origin API key rusak.", 503); }
  if (!Array.isArray(allowed) || !allowed.includes(origin)) return fail("Origin ini tidak diizinkan untuk API key.", 403);

  const parsed = await deps.readJsonRequest(request, 64 * 1024);
  if (parsed.error) return withCors(parsed.error, origin);
  const body = parsed.body;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return fail("Pesan tidak boleh kosong.", 400);
  if (message.length > 12000) return fail("Pesan maksimal 12.000 karakter.", 400);
  const agentId = body?.agent || "coordinator";
  if (typeof agentId !== "string" || !Object.hasOwn(deps.AGENTS, agentId)) return fail("Agent tidak dikenal.", 400);

  if (deps.CHAT_LIMITER?.limit) {
    try {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown-client";
      const ipLimit = await deps.CHAT_LIMITER.limit({ key: "widget-ip:" + ip });
      const keyLimit = ipLimit?.success ? await deps.CHAT_LIMITER.limit({ key: "widget-key:" + row.id }) : ipLimit;
      if (!keyLimit?.success) return fail("Terlalu banyak permintaan. Coba lagi dalam satu menit.", 429, { "Retry-After": "60" });
    } catch { return fail("Pembatasan permintaan sedang bermasalah.", 503); }
  }

  const day = new Date().toISOString().slice(0, 10);
  const now = Math.floor(Date.now() / 1000);
  const consumed = await env.DB.prepare(
    "UPDATE public_api_keys SET daily_used = CASE WHEN usage_day = ? THEN daily_used + 1 ELSE 1 END, usage_day = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL AND (CASE WHEN usage_day = ? THEN daily_used ELSE 0 END) < daily_limit RETURNING daily_used, daily_limit"
  ).bind(day, day, now, row.id, day).first();
  if (!consumed) return fail("Kuota harian API key sudah habis.", 429, { "Retry-After": String(secondsUntilNextUtcDay()) });

  try {
    const timeout = Number(env.AI_CALL_TIMEOUT_MS);
    const deadline = Date.now() + (Number.isFinite(timeout) && timeout > 0 ? timeout : 45000);
    const aiEnv = deps.withAiDeadline(env, deadline, request.signal);
    const result = await deps.runAgent(aiEnv, agentId, message);
    return withCors(deps.json({
      response: result.response,
      agent: deps.AGENTS[agentId].name,
      model: deps.MODEL,
      usage: { used: Number(consumed.daily_used), limit: Number(consumed.daily_limit), remaining: Math.max(0, Number(consumed.daily_limit) - Number(consumed.daily_used)), resetsAt: "07:00 WIB" }
    }), 200, { "X-RateLimit-Limit": String(consumed.daily_limit), "X-RateLimit-Remaining": String(Math.max(0, Number(consumed.daily_limit) - Number(consumed.daily_used))) });
  } catch (error) {
    await env.DB.prepare("UPDATE public_api_keys SET daily_used = MAX(daily_used - 1, 0), updated_at = ? WHERE id = ? AND usage_day = ?").bind(now, row.id, day).run().catch(() => {});
    console.error("Widget AI generation failed:", error);
    return fail("AI gagal memproses permintaan. Silakan coba lagi.", 502);
  }
}
