import { readLink } from "./links.js";
import { createVerifiedLinkFetcher } from "./verified-egress.js";
import { extractWithTavily } from "./tavily-extract.js";

// A fallback is allowed only after an explicit temporary failure at the first
// proxy hop. Never send a rejected, redirected or unverifiable URL to Tavily.
export async function readExternalWithBackup(urls, env, { ownHost = "", read = readLink, makeFetcher = createVerifiedLinkFetcher, extract = extractWithTavily } = {}) {
  if (env?.URL_READER_ENABLED !== "true") return [];
  if (env.URL_READER_PROVIDER === "tavily") return extract(urls, env, { ownHost, fetcher: env.TAVILY_EXTRACT_FETCHER || fetch });
  const primary = makeFetcher(env);
  if (env.URL_READER_PROVIDER !== "railway") return Promise.all(urls.map(url => read(url, {ownHost, fetcher: primary || env.LINK_FETCHER || null})));
  const eligible = [];
  const results = await Promise.all(urls.map(async (url, index) => {
    let hops = 0, temporary = false;
    const result = await read(url, {ownHost, fetcher: primary ? async (...args) => {
      hops++;
      try { return await primary(...args); }
      catch (error) {
        temporary = hops === 1 && error?.code === "EGRESS_TEMPORARY_UNAVAILABLE";
        throw error;
      }
    } : null});
    if (!result.ok && temporary) eligible.push(index);
    return result;
  }));
  if (env.URL_READER_TAVILY_FALLBACK_ENABLED !== "true" || !eligible.length) return results;
  const raw = String(env.TAVILY_EXTRACT_DAILY_URL_LIMIT ?? "");
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) return results;
  eligible.sort((a,b) => a-b);
  // Existing extractor owns validation, sensitive-link rejection and atomic D1 quota.
  // The override is local to this call; no Worker config or global flag is mutated.
  const fallbackEnv = { URL_READER_ENABLED:"true", URL_READER_PROVIDER:"tavily", TAVILY_EXTRACT_DAILY_URL_LIMIT:String(Math.min(8, Number(raw))), TAVILY_API_KEY:env.TAVILY_API_KEY, DB:env.DB };
  try {
    const fallback = await extract(eligible.map(i => urls[i]), fallbackEnv, {ownHost, fetcher:env.TAVILY_EXTRACT_FETCHER || fetch});
    eligible.forEach((i,j) => { if (fallback[j]?.ok) results[i] = fallback[j]; });
  } catch { /* preserve primary failures, never retry paid extraction */ }
  return results;
}
