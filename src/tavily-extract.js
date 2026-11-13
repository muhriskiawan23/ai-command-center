import { validateUrl, MAX_PAGE_CHARS, MAX_LINKS } from "./links.js";

// Managed public-URL extraction. No arbitrary Worker fetch or Android tunnel.
const MAX_RESPONSE_BYTES = 1_000_000;
const TIMEOUT_MS = 8000;
const fail = (url, reason) => ({ ok: false, url, requested: url, reason });

export async function extractWithTavily(urls, env = {}, { fetcher = fetch, ownHost = "" } = {}) {
  const input = Array.isArray(urls) ? urls.slice(0, MAX_LINKS) : [];
  const key = typeof env.TAVILY_API_KEY === "string" ? env.TAVILY_API_KEY.trim() : "";
  const checked = input.map(raw => ({ raw, check: validateUrl(raw, ownHost) }));
  if (!key) return checked.map(x => fail(x.raw, x.check.ok ? "Tavily belum dikonfigurasi" : x.check.reason));
  const eligible = checked.filter(x => x.check.ok);
  if (!eligible.length) return checked.map(x => fail(x.raw, x.check.reason));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let extracted = new Map();
  try {
    const response = await fetcher("https://api.tavily.com/extract", {
      method: "POST", redirect: "manual", signal: controller.signal,
      headers: { "Accept": "application/json", "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ urls: eligible.map(x => x.check.url.toString()), extract_depth: "basic" })
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
