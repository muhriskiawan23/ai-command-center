const GITHUB_API = "https://api.github.com";
const STATE_COOKIE = "__Host-borai_github_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index >= 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return "";
}
function cookie(name, value, maxAge) {
  return name + "=" + value + "; Path=/; Max-Age=" + maxAge + "; Secure; HttpOnly; SameSite=Lax";
}
function configured(env) {
  return Boolean(env.DB && env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET && env.GITHUB_APP_REDIRECT_URI && env.GITHUB_TOKEN_ENCRYPTION_KEY);
}
function tokenEncryptionError(code) {
  const error = new Error("GitHub token encryption failed.");
  error.code = code;
  return error;
}
async function encryptionKey(env) {
  if (!env.GITHUB_TOKEN_ENCRYPTION_KEY) throw tokenEncryptionError("key_missing");
  let raw;
  try { raw = fromBase64Url(env.GITHUB_TOKEN_ENCRYPTION_KEY); }
  catch { throw tokenEncryptionError("key_encoding_invalid"); }
  if (raw.length !== 32) throw tokenEncryptionError("key_length_invalid");
  try {
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch {
    throw tokenEncryptionError("crypto_import_failed");
  }
}
async function encryptToken(value, env) {
  const key = await encryptionKey(env);
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
    return base64Url(iv) + "." + base64Url(new Uint8Array(encrypted));
  } catch {
    throw tokenEncryptionError("crypto_encrypt_failed");
  }
}
async function decryptToken(value, env) {
  const [ivPart, dataPart, extra] = String(value || "").split(".");
  if (!ivPart || !dataPart || extra) throw new Error("Stored GitHub credential is invalid.");
  const key = await encryptionKey(env);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(ivPart) }, key, fromBase64Url(dataPart));
  return new TextDecoder().decode(decrypted);
}
function safeGitHubError(status) {
  if (status === 401 || status === 403) return "GitHub menolak akses. Periksa otorisasi atau instalasi GitHub App.";
  if (status === 404) return "Resource GitHub tidak ditemukan atau tidak tersedia untuk instalasi ini.";
  if (status === 429) return "Batas permintaan GitHub tercapai. Coba lagi nanti.";
  return "GitHub sementara tidak dapat dihubungi.";
}
function safeGitHubDiagnosticMessage(value) {
  if (typeof value !== "string") return "Unknown GitHub API error";
  return value
    .replace(/(?:gh[ousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, "[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240);
}
async function githubJson(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "BOR-AI",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    let providerMessage = "Unknown GitHub API error";
    try {
      const payload = await response.clone().json();
      providerMessage = safeGitHubDiagnosticMessage(payload?.message);
    } catch {}
    const diagnostic = {
      endpoint: new URL(url).pathname,
      status: response.status,
      message: providerMessage,
      requestId: response.headers.get("x-github-request-id") || undefined,
      rateLimitRemaining: response.headers.get("x-ratelimit-remaining") || undefined,
      rateLimitReset: response.headers.get("x-ratelimit-reset") || undefined,
      retryAfter: response.headers.get("retry-after") || undefined,
      acceptedPermissions: response.headers.get("x-accepted-github-permissions") || undefined
    };
    console.warn("GitHub API request failed", diagnostic);
    const status = [401, 403, 404, 429].includes(response.status) ? response.status : 502;
    return { error: safeGitHubError(response.status), status, diagnostic };
  }
  try { return { data: await response.json() }; }
  catch { return { error: "Respons GitHub tidak valid.", status: 502 }; }
}
async function refreshAccessToken(connection, env) {
  const now = Math.floor(Date.now() / 1000);
  if (connection.access_token_expires_at > now + 60) return connection;
  if (!connection.encrypted_refresh_token) throw new Error("GitHub access token expired; reconnect GitHub.");
  const refreshToken = await decryptToken(connection.encrypted_refresh_token, env);
  const body = new URLSearchParams({
    client_id: env.GITHUB_APP_CLIENT_ID,
    client_secret: env.GITHUB_APP_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) throw new Error("GitHub token refresh failed.");
  const tokens = await response.json();
  if (typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string") throw new Error("GitHub token refresh response is invalid.");
  const updated = {
    ...connection,
    encrypted_access_token: await encryptToken(tokens.access_token, env),
    encrypted_refresh_token: await encryptToken(tokens.refresh_token, env),
    access_token_expires_at: now + Math.max(60, Number(tokens.expires_in) || 28800),
    refresh_token_expires_at: now + Math.max(60, Number(tokens.refresh_token_expires_in) || 15897600),
    updated_at: now
  };
  await env.DB.prepare(
    "UPDATE github_connections SET encrypted_access_token = ?, encrypted_refresh_token = ?, access_token_expires_at = ?, refresh_token_expires_at = ?, updated_at = ? WHERE user_id = ?"
  ).bind(updated.encrypted_access_token, updated.encrypted_refresh_token, updated.access_token_expires_at, updated.refresh_token_expires_at, now, connection.user_id).run();
  return updated;
}
async function loadConnection(user, env) {
  return env.DB.prepare(
    "SELECT user_id, github_user_id, github_login, github_avatar_url, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, refresh_token_expires_at, connected_at, updated_at FROM github_connections WHERE user_id = ?"
  ).bind(user.id).first();
}
async function accessToken(connection, env) {
  const fresh = await refreshAccessToken(connection, env);
  return decryptToken(fresh.encrypted_access_token, env);
}
function clearStateCookie() { return cookie(STATE_COOKIE, "", 0); }

export async function handleGitHubOAuthRoute(request, env, url, { getSession, sameOrigin, randomToken, sha256Hex, json }) {
  const path = url.pathname;
  const known = ["/api/github/connect", "/api/github/callback", "/api/github/connection", "/api/github/disconnect", "/api/github/installations", "/api/github/repositories"];
  if (!known.includes(path)) return null;
  if (!configured(env)) return json({ error: "GitHub App belum dikonfigurasi. Admin perlu menambahkan konfigurasi OAuth dan encryption key." }, 503);
  let user;
  try { user = await getSession(request, env); }
  catch (error) { console.error("GitHub session lookup failed:", error); return json({ error: "Status login tidak dapat diperiksa." }, 503); }
  if (!user) return json({ error: "Masuk ke BOR AI terlebih dahulu untuk menghubungkan GitHub." }, 401);

  if (path === "/api/github/connect") {
    if (request.method !== "GET") return json({ error: "Metode HTTP tidak didukung." }, 405, { Allow: "GET" });
    const state = randomToken();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("DELETE FROM github_oauth_states WHERE expires_at <= ?").bind(now).run();
    await env.DB.prepare("INSERT INTO github_oauth_states (state_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256Hex(state), user.id, now + STATE_TTL_SECONDS, now).run();
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", env.GITHUB_APP_CLIENT_ID);
    authorize.searchParams.set("redirect_uri", env.GITHUB_APP_REDIRECT_URI);
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("allow_signup", "false");
    return new Response(null, { status: 302, headers: { Location: authorize.toString(), "Cache-Control": "no-store", "Set-Cookie": cookie(STATE_COOKIE, state, STATE_TTL_SECONDS) } });
  }

  if (path === "/api/github/callback") {
    if (request.method !== "GET") return json({ error: "Metode HTTP tidak didukung." }, 405, { Allow: "GET" });
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const stateCookie = readCookie(request, STATE_COOKIE);
    const fail = (reason, diagnostic) => {
      const destination = new URL("/", url.origin);
      destination.searchParams.set("github", "error");
      destination.searchParams.set("reason", reason);
      // Surface only sanitized provider diagnostics; never include tokens, codes, or request headers.
      if (diagnostic?.message) destination.searchParams.set("github_message", diagnostic.message);
      if (diagnostic?.requestId && /^[A-Za-z0-9-]{1,80}$/.test(diagnostic.requestId)) destination.searchParams.set("github_request", diagnostic.requestId);
      if (diagnostic?.rateLimitRemaining && /^\d{1,12}$/.test(diagnostic.rateLimitRemaining)) destination.searchParams.set("github_rate_remaining", diagnostic.rateLimitRemaining);
      return new Response(null, { status: 302, headers: { Location: destination.pathname + destination.search, "Set-Cookie": clearStateCookie(), "Cache-Control": "no-store" } });
    };
    let callbackStage = "state_validation";
    try {
    if (!state || !stateCookie || state !== stateCookie) return fail("state_cookie");
    if (state.length > 200) return fail("state_cookie");
    const now = Math.floor(Date.now() / 1000);
    callbackStage = "state_lookup";
    const pending = await env.DB.prepare("SELECT user_id FROM github_oauth_states WHERE state_hash = ? AND expires_at > ?")
      .bind(await sha256Hex(state), now).first();
    if (!pending || pending.user_id !== user.id) return fail("state_expired_or_session");
    callbackStage = "state_consume";
    await env.DB.prepare("DELETE FROM github_oauth_states WHERE state_hash = ?").bind(await sha256Hex(state)).run();
    // GitHub returns an error (for example access_denied) without an authorization code.
    // Handle this before validating code so cancellations are not misreported as state failures.
    if (url.searchParams.has("error")) {
      return new Response(null, { status: 302, headers: { Location: "/?github=cancelled", "Set-Cookie": clearStateCookie(), "Cache-Control": "no-store" } });
    }
    if (!code || code.length > 500) return fail("missing_code");
    callbackStage = "token_exchange";
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET, code, redirect_uri: env.GITHUB_APP_REDIRECT_URI })
    });
    if (!tokenResponse.ok) return fail("token_http_" + tokenResponse.status);
    callbackStage = "token_response_parse";
    const tokens = await tokenResponse.json();
    if (typeof tokens.access_token !== "string" || !tokens.access_token) {
      const providerError = typeof tokens.error === "string" && /^[a-z_]{1,40}$/.test(tokens.error) ? tokens.error : "unknown";
      return fail("token_" + providerError);
    }
    callbackStage = "profile_lookup";
    const profile = await githubJson(GITHUB_API + "/user", tokens.access_token);
    if (profile.error) return fail("profile_http_" + (profile.status || 502), profile.diagnostic);
    if (!Number.isSafeInteger(profile.data?.id) || typeof profile.data?.login !== "string") return fail("profile_invalid");
    callbackStage = "token_encrypt_access";
    const encryptedAccess = await encryptToken(tokens.access_token, env);
    callbackStage = "token_encrypt_refresh";
    const encryptedRefresh = typeof tokens.refresh_token === "string" ? await encryptToken(tokens.refresh_token, env) : null;
    const accessExpires = now + Math.max(60, Number(tokens.expires_in) || 28800);
    const refreshExpires = encryptedRefresh ? now + Math.max(60, Number(tokens.refresh_token_expires_in) || 15897600) : null;
    callbackStage = "connection_save";
    await env.DB.prepare(
      "INSERT INTO github_connections (user_id, github_user_id, github_login, github_avatar_url, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, refresh_token_expires_at, connected_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET github_user_id=excluded.github_user_id, github_login=excluded.github_login, github_avatar_url=excluded.github_avatar_url, encrypted_access_token=excluded.encrypted_access_token, encrypted_refresh_token=excluded.encrypted_refresh_token, access_token_expires_at=excluded.access_token_expires_at, refresh_token_expires_at=excluded.refresh_token_expires_at, connected_at=excluded.connected_at, updated_at=excluded.updated_at"
    ).bind(user.id, profile.data.id, profile.data.login, String(profile.data.avatar_url || "").slice(0, 1000), encryptedAccess, encryptedRefresh, accessExpires, refreshExpires, now, now).run();
    return new Response(null, { status: 302, headers: { Location: "/?github=connected", "Set-Cookie": clearStateCookie(), "Cache-Control": "no-store" } });
    } catch (error) {
      // Log only the stage and error class; never log OAuth codes, state, tokens, or provider payloads.
      const safeEncryptionCodes = new Set(["key_missing", "key_encoding_invalid", "key_length_invalid", "crypto_import_failed", "crypto_encrypt_failed"]);
      const encryptionCode = callbackStage === "token_encrypt_access" || callbackStage === "token_encrypt_refresh"
        ? (safeEncryptionCodes.has(error?.code) ? "_" + error.code : "")
        : "";
      console.error("GitHub OAuth callback failed", {
        stage: callbackStage,
        errorName: error instanceof Error ? error.name : "UnknownError",
        ...(encryptionCode ? { encryptionCode: encryptionCode.slice(1) } : {})
      });
      return fail("callback_" + callbackStage + encryptionCode);
    }
  }

  if (path === "/api/github/connection") {
    if (request.method !== "GET") return json({ error: "Metode HTTP tidak didukung." }, 405, { Allow: "GET" });
    const connection = await loadConnection(user, env);
    return json({ connected: Boolean(connection), ...(connection ? { account: { id: connection.github_user_id, login: connection.github_login, avatarUrl: connection.github_avatar_url }, connectedAt: connection.connected_at, accessTokenExpiresAt: connection.access_token_expires_at } : {}) }, 200, { "Cache-Control": "no-store" });
  }

  if (path === "/api/github/disconnect") {
    if (request.method !== "POST") return json({ error: "Metode HTTP tidak didukung." }, 405, { Allow: "POST" });
    if (!sameOrigin(request)) return json({ error: "Origin tidak valid." }, 403);
    await env.DB.prepare("DELETE FROM github_connections WHERE user_id = ?").bind(user.id).run();
    return json({ connected: false });
  }

  if (path === "/api/github/installations" || path === "/api/github/repositories") {
    if (request.method !== "GET") return json({ error: "Metode HTTP tidak didukung." }, 405, { Allow: "GET" });
    const connection = await loadConnection(user, env);
    if (!connection) return json({ error: "Hubungkan akun GitHub terlebih dahulu." }, 409);
    try {
      const token = await accessToken(connection, env);
      const installations = await githubJson(GITHUB_API + "/user/installations?per_page=100", token);
      if (installations.error) return json({ error: installations.error }, installations.status);
      const items = Array.isArray(installations.data.installations) ? installations.data.installations : [];
      if (path === "/api/github/installations") {
        return json({ installations: items.map((item) => ({ id: item.id, account: item.account?.login, accountType: item.account?.type, repositorySelection: item.repository_selection, appId: item.app_id, appSlug: item.app_slug })) }, 200, { "Cache-Control": "no-store" });
      }
      const installationId = url.searchParams.get("installation_id") || "";
      if (!/^\\d{1,20}$/.test(installationId) || !items.some((item) => String(item.id) === installationId)) return json({ error: "Instalasi GitHub tidak valid atau bukan milik akun ini." }, 403);
      const repositories = await githubJson(GITHUB_API + "/user/installations/" + installationId + "/repositories?per_page=100", token);
      if (repositories.error) return json({ error: repositories.error }, repositories.status);
      return json({ repositories: (repositories.data.repositories || []).map((item) => ({ id: item.id, fullName: item.full_name, name: item.name, private: item.private, defaultBranch: item.default_branch, permissions: { contents: item.permissions?.contents, pullRequests: item.permissions?.pull_requests, administration: item.permissions?.administration } })) }, 200, { "Cache-Control": "no-store" });
    } catch (error) {
      console.error("GitHub installation lookup failed:", error);
      return json({ error: "Akses GitHub kedaluwarsa atau gagal diverifikasi. Hubungkan ulang akun GitHub." }, 503);
    }
  }
  return null;
}
