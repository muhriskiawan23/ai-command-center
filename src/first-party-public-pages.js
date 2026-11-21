import { readLink } from "./links.js";

// Read strictly public application assets without a vendor request, arbitrary URL
// fetching, cookies, or calls into the application's authenticated API routes.
const PUBLIC_ASSET_PATHS = new Map([
  ["/", "/"],
  ["/index.html", "/"],
  ["/paket", "/paket"],
  ["/paket.html", "/paket"]
]);

const fail = (url, reason) => ({ ok: false, url, requested: url, reason });
const canonicalHost = value => String(value || "").toLowerCase().replace(/\.$/, "");

export function isFirstPartyHost(raw, ownHost) {
  try {
    return Boolean(ownHost) && canonicalHost(new URL(raw).hostname) === canonicalHost(ownHost);
  } catch {
    return false;
  }
}

// null means this is not a first-party URL; the caller must apply its
// independently configured external-reader policy to it.
export async function readFirstPartyPublicLink(raw, ownHost, assets) {
  if (!isFirstPartyHost(raw, ownHost)) return null;
  let url;
  try { url = new URL(raw); } catch { return fail(raw, "alamat tidak valid"); }
  if (url.protocol !== "https:" || url.port || url.username || url.password)
    return fail(raw, "alamat non-HTTPS, port khusus, atau kredensial tidak diizinkan");
  if (url.search)
    return fail(raw, "parameter URL tidak diizinkan pada halaman publik BOR AI");
  const assetPath = PUBLIC_ASSET_PATHS.get(url.pathname);
  if (!assetPath)
    return fail(raw, "hanya beranda dan halaman paket publik BOR AI yang dapat dibaca");
  if (typeof assets?.fetch !== "function")
    return fail(raw, "aset publik BOR AI belum tersedia");
  // Fragments stay in the browser; do not put them in source context.
  url.hash = "";
  const result = await readLink(url.toString(), {
    fetcher: async (_requested, options) => {
      // The asset path is a fixed constant, never user-controlled or an API route.
      // A fresh Request has no browser cookies, authorization or user headers.
      const request = new Request(new URL(assetPath, url.origin), {
        method: "GET",
        redirect: "manual",
        signal: options.signal,
        headers: { Accept: "text/html" }
      });
      const response = await assets.fetch(request);
      // Do not follow even same-site redirects; they might resolve to private routes.
      if (response.status >= 300 && response.status < 400) {
        try { void response.body?.cancel()?.catch?.(() => {}); } catch {}
        return new Response(null, { status: 502 });
      }
      return response;
    }
  });
  return { ...result, requested: raw };
}
