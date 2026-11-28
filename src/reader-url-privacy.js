import { validateUrl } from "./links.js";

// Shared conservative privacy policy for external URL-reader providers.
// Normalize camelCase, snake_case and kebab-case without blocking unrelated keys (e.g. design).
const SENSITIVE_QUERY_KEY = /(?:^|_)(?:token|secret|password|passwd|passcode|api_key|access_key|auth|authorization|session|signature|credential|client_secret|jwt|bearer|signed|sig|code)(?:_|$)/;
function isSensitiveQueryKey(key) {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[-\\s]+/g, "_").toLowerCase();
  return SENSITIVE_QUERY_KEY.test(normalized);
}

// Conservative heuristic: never submit likely action/session links to an external
// extractor, even when credentials live in URL paths rather than query parameters.
// This cannot prove an arbitrary URL has no private data.
const PRIVATE_ACTION_PATH = /(?:^|\/)(?:reset[-_]password|password[-_]reset|forgot[-_]password|magic[-_]link|verify[-_]email|email[-_]verification|invite|invites|invitation|invitations|accept[-_]invite|oauth\/callback|auth\/callback)(?:\/|$)/i;
const JWT_PATH_SEGMENT = /(?:^|\/)eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\/|$)/;
function privateUrlPath(pathname) {
  let path = pathname;
  // Detect singly or doubly escaped separators; malformed escaping fails closed.
  for (let pass = 0; pass < 3; pass++) {
    if (PRIVATE_ACTION_PATH.test(path) || JWT_PATH_SEGMENT.test(path)) return true;
    if (!/%[0-9a-f]{2}/i.test(path)) return false;
    try { path = decodeURIComponent(path); } catch { return true; }
  }
  return PRIVATE_ACTION_PATH.test(path) || JWT_PATH_SEGMENT.test(path);
}

export function checkPublicUrl(raw, ownHost) {
  const check = validateUrl(raw, ownHost);
  if (!check.ok) return check;
  const url = new URL(check.url.toString());
  if (privateUrlPath(url.pathname)) return { ok: false, reason: "URL tampak berisi tautan akses pribadi" };
  if (url.username || url.password) return { ok: false, reason: "URL berisi kredensial" };
  if ([...url.searchParams.keys()].some(key => isSensitiveQueryKey(key))) return { ok: false, reason: "URL berisi parameter autentikasi sensitif" };
  // Initial privacy rollout: query values can embed credentials under innocuous names (e.g. ?data=JWT).
  // Until consent and value-redaction are designed, do not transmit ANY query string to a third-party provider.
  if (url.search) return { ok: false, reason: "URL dengan parameter query belum didukung demi privasi" };
  url.hash = ""; // URL fragments are client-side data and must not be sent to a provider.
  return { ok: true, url };
}

