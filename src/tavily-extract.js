import { validateUrl, MAX_PAGE_CHARS, MAX_LINKS } from "./links.js";
import { consumeUsage, usageDay } from "./daily-limits.js";

// Managed public-URL extraction. No arbitrary Worker fetch or Android tunnel.
const MAX_RESPONSE_BYTES = 1_000_000;
const TIMEOUT_MS = 8000;
const DEFAULT_DAILY_URL_BUDGET = 30;
// Normalize camelCase, snake_case and kebab-case without blocking unrelated keys (e.g. design).
const SENSITIVE_QUERY_KEY = /(?:^|_)(?:token|secret|password|passwd|passcode|api_key|access_key|auth|authorization|session|signature|credential|client_secret|jwt|bearer|signed|sig|code)(?:_|$)/;
function isSensitiveQueryKey(key) {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[-\\s]+/g, "_").toLowerCase();
  return SENSITIVE_QUERY_KEY.test(normalized);
}

function checkPublicUrl(raw, ownHost) {
  const check = validateUrl(raw, ownHost);
  if (!check.ok) return check;
  const url = new URL(check.url.toString());
  if (url.username || url.password) return { ok: false, reason: "URL berisi kredensial" };
  if ([...url.searchParams.keys()].some(key => isSensitiveQueryKey(key))) return { ok: false, reason: "URL berisi parameter autentikasi sensitif" };
  // Initial privacy rollout: query values can embed credentials under innocuous names (e.g. ?data=JWT).
  // Until consent and value-redaction are designed, do not transmit ANY query string to a third-party provider.
  if (url.search) return { ok: false, reason: "URL dengan parameter query belum didukung demi privasi" };
  url.hash = ""; // URL fragments are client-side data and must not be sent to a provider.
  return { ok: true, url };
}

export async function reserveTavilyExtractBudget(env, urlCount) {
  // A separate atomic global D1 quota: existing chat units are not Tavily provider credits.
  if (!env.DB?.prepare) return false;
  const rawLimit = env.TAVILY_EXTRACT_DAILY_URL_LIMIT;
  const configured = rawLimit === undefined || rawLimit === null ? DEFAULT_DAILY_URL_BUDGET : Number(rawLimit);
  // Explicit zero disables paid extraction; malformed limits fail closed instead of silently enabling spending.
  if (!Number.isSafeInteger(configured) || configured < 1 || configured > 10000) return false;
  const limit = configured;
  if (!Number.isSafeInteger(urlCount) || urlCount < 1 || urlCount > MAX_LINKS) return false;
  try {
    return (await consumeUsage(env, usageDay(), "provider:tavily-extract:global", urlCount, limit)) !== null;
  } catch {
    return false; // Fail closed if D1 is unavailable or migration is missing.
  }
}
const fail = (url, reason) => ({ ok: false, url, requested: url, reason });

export async function extractWithTavily(urls, env = {}, { fetcher = fetch, ownHost = "" } = {}) {
  const input = Array.isArray(urls) ? urls.slice(0, MAX_LINKS) : [];
  const key = typeof env.TAVILY_API_KEY === "string" ? env.TAVILY_API_KEY.trim() : "";
  const checked = input.map(raw => ({ raw, check: checkPublicUrl(raw, ownHost) }));
  if (!key) return checked.map(x => fail(x.raw, x.check.ok ? "Tavily belum dikonfigurasi" : x.check.reason));
  const eligible = checked.filter(x => x.check.ok);
  if (!eligible.length) return checked.map(x => fail(x.raw, x.check.reason));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let extracted = new Map();
  try {
    // Deduplicate URLs to avoid unnecessary provider credits within one extraction batch.
    const uniqueUrls = [...new Set(eligible.map(x => x.check.url.toString()))];
    if (!(await reserveTavilyExtractBudget(env, uniqueUrls.length))) throw Error("budget_unavailable");
    const response = await fetcher("https://api.tavily.com/extract", {
      method: "POST", redirect: "manual", signal: controller.signal,
      headers: { "Accept": "application/json", "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ urls: uniqueUrls, extract_depth: "basic" })
    });
    if (!response.ok || response.status >= 300) { try { await response.body?.cancel(); } catch {} throw Error("provider_failure"); }
    const size = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(size) && size > MAX_RESPONSE_BYTES) { try { await response.body?.cancel(); } catch {} throw Error("oversize"); }
    // Bound actual bytes too; Content-Length is not always provided.
    const reader = response.body?.getReader();
    if (!reader) throw Error("empty_response");
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw Error("oversize"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(payload?.results)) throw Error("invalid_response");
    const allowed = new Set(eligible.map(x => x.check.url.toString()));
    extracted = new Map(payload.results.filter(x => typeof x?.url === "string" && allowed.has(x.url)).map(x => [x.url, x]));
  } catch {
    return checked.map(x => fail(x.raw, x.check.ok ? "Tavily tidak dapat membaca URL" : x.check.reason));
  } finally {
    clearTimeout(timer);
  }
  return checked.map(({ raw, check }) => {
    if (!check.ok) return fail(raw, check.reason);
    const item = extracted.get(check.url.toString());
    const rawText = item?.raw_content;
    if (typeof rawText !== "string" || rawText.trim().length < 40) return fail(raw, "konten tidak tersedia atau terlalu pendek");
    const text = rawText.trim().slice(0, MAX_PAGE_CHARS);
    return { ok: true, url: check.url.toString(), requested: raw, title: "", text, chars: text.length, truncated: rawText.trim().length > MAX_PAGE_CHARS };
  });
}
