import { MAX_PAGE_CHARS, MAX_LINKS } from "./links.js";
import { checkPublicUrl } from "./reader-url-privacy.js";
import { consumeUsage, usageDay } from "./daily-limits.js";

// Managed public-URL extraction. No arbitrary Worker fetch or Android tunnel.
const MAX_RESPONSE_BYTES = 1_000_000;
const TIMEOUT_MS = 8000;
const DEFAULT_DAILY_URL_BUDGET = 0; // Fail closed until owner explicitly configures an extraction-attempt ceiling.
export async function reserveTavilyExtractBudget(env, urlCount) {
  // Defense in depth: the spending reservation must not be callable when
  // Reader consent or provider selection is OFF, even from a new call site.
  if (env?.URL_READER_ENABLED !== "true" || env?.URL_READER_PROVIDER !== "tavily") return false;
  // A separate atomic global D1 quota: existing chat units are not Tavily provider credits.
  if (!env.DB?.prepare) return false;
  const rawLimit = env.TAVILY_EXTRACT_DAILY_URL_LIMIT;
  const configured = rawLimit === undefined || rawLimit === null ? DEFAULT_DAILY_URL_BUDGET : (typeof rawLimit === "string" && !/^[0-9]+$/.test(rawLimit.trim()) ? NaN : Number(rawLimit));
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

export async function extractWithTavily(urls, env = {}, { fetcher = fetch, ownHost = "", timeoutMs = TIMEOUT_MS } = {}) {
  const input = Array.isArray(urls) ? urls.slice(0, MAX_LINKS) : [];
  const key = typeof env?.TAVILY_API_KEY === "string" ? env.TAVILY_API_KEY.trim() : "";
  const checked = input.map(raw => ({ raw, check: checkPublicUrl(raw, ownHost) }));
  // The caller must gate the chat/research path, but the adapter itself also
  // refuses paid provider calls when the independent Reader switch is OFF.
  // Keep blocked-URL validation messages without ever charging D1 or Tavily.
  if (env?.URL_READER_ENABLED !== "true" || env?.URL_READER_PROVIDER !== "tavily")
    return checked.map(x => fail(x.raw, x.check.ok ? "Pembacaan URL belum diaktifkan" : x.check.reason));
  if (!key) return checked.map(x => fail(x.raw, x.check.ok ? "Tavily belum dikonfigurasi" : x.check.reason));
  const eligible = checked.filter(x => x.check.ok);
  if (!eligible.length) return checked.map(x => fail(x.raw, x.check.reason));
  // The deadline covers both response headers and every streaming read.
  // Even a custom transport that ignores AbortSignal cannot hang the Worker.
  const controller = new AbortController();
  let timer, reader, response;
  let extracted = new Map();
  try {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT_MS)
      throw Error("invalid_timeout");
    // Deduplicate URLs to avoid unnecessary provider credits within one extraction batch.
    const uniqueUrls = [...new Set(eligible.map(x => x.check.url.toString()))];
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("provider_timeout"));
      }, timeoutMs);
    });
    // D1 admission can also stall. A timed-out reservation must never start
    // the paid provider call, even if D1 commits the counter later.
    if (!(await Promise.race([reserveTavilyExtractBudget(env, uniqueUrls.length), deadline])))
      throw Error("budget_unavailable");
    response = await Promise.race([fetcher("https://api.tavily.com/extract", {
      method: "POST", redirect: "manual", signal: controller.signal,
      headers: { "Accept": "application/json", "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ urls: uniqueUrls, extract_depth: "basic" })
    }), deadline]);
    if (!response?.ok || response.status >= 300) throw Error("provider_failure");
    const advertised = response.headers?.get?.("content-length");
    if (advertised !== null && advertised !== undefined &&
        (!/^[0-9]+$/.test(advertised) || BigInt(advertised) > BigInt(MAX_RESPONSE_BYTES)))
      throw Error("oversize");
    // Bound actual bytes too; a Content-Length header is not sufficient.
    reader = response.body?.getReader?.();
    if (!reader) throw Error("empty_response");
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw Error("oversize");
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!Array.isArray(payload?.results)) throw Error("invalid_response");
    const allowed = new Set(eligible.map(x => x.check.url.toString()));
    extracted = new Map(payload.results.filter(x => typeof x?.url === "string" && allowed.has(x.url)).map(x => [x.url, x]));
  } catch {
    // A timed-out or unknown provider attempt still consumes its reserved
    // allowance: never assume upstream billable cost was zero.
    return checked.map(x => fail(x.raw, x.check.ok ? "Tavily tidak dapat membaca URL" : x.check.reason));
  } finally {
    clearTimeout(timer);
    // A broken ReadableStream.cancel() may never resolve. Release the reader
    // without awaiting cancellation or exposing provider errors to end users.
    if (reader) {
      try { void reader.cancel().catch(() => {}); } catch {}
      try { reader.releaseLock(); } catch {}
    } else if (response?.body) {
      try { void response.body.cancel().catch(() => {}); } catch {}
    }
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
