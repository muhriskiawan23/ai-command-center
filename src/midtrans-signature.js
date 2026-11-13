// Isolated Midtrans notification signature helper. No route or payment side effects.
// Formula: SHA512(order_id + status_code + gross_amount + server_key).
// Verify current Midtrans API specification before connecting to production.
const HEX_512 = /^[0-9a-f]{128}$/i;
const encoder = new TextEncoder();
function safeEqualHex(a,b) {
  if (typeof a !== "string" || typeof b !== "string" || !HEX_512.test(a) || !HEX_512.test(b)) return false;
  let mismatch = 0;
  for (let i=0;i<128;i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function fields(payload, serverKey) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      typeof serverKey !== "string" || !serverKey) throw new TypeError("Invalid signature input");
  for (const key of ["order_id","status_code","gross_amount"]) {
    if (typeof payload[key] !== "string" || !payload[key]) throw new TypeError("Invalid notification field: " + key);
  }
  return payload.order_id + payload.status_code + payload.gross_amount + serverKey;
}
export async function midtransSignature(payload, serverKey) {
  const digest = await crypto.subtle.digest("SHA-512", encoder.encode(fields(payload,serverKey)));
  return Array.from(new Uint8Array(digest), n=>n.toString(16).padStart(2,"0")).join("");
}
export async function verifyMidtransNotificationSignature(payload, serverKey) {
  // Compute before comparison; malformed payloads are rejected by fields().
  const expected = await midtransSignature(payload,serverKey);
  return safeEqualHex(expected,payload.signature_key);
}
