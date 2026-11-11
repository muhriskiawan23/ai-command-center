// Helper HTTP/hash bersama (diekstrak dari index.js tanpa perubahan isi).
const encoder = new TextEncoder();

export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (name.toLowerCase() === "set-cookie" && Array.isArray(value)) {
      for (const cookie of value) headers.append(name, cookie);
    } else {
      headers.set(name, value);
    }
  }
  return Response.json(data, { status, headers });
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
