import { json } from "./http.js";

const DAY_SECONDS = 86400;
const notFound = () => json({ error: "Halaman tidak ditemukan." }, 404);

export async function handleFeedbackReport(request, env, url, getSession) {
  const ownerId = env.BOR_FEEDBACK_REPORT_OWNER_ID;
  if (typeof ownerId !== "string" || !ownerId.trim()) return notFound();

  let user;
  try { user = await getSession(request, env); }
  catch { return notFound(); }
  if (user?.id !== ownerId) return notFound();
  if (request.method !== "GET") return json({ error: "Metode HTTP tidak didukung." }, 405, { Allow: "GET" });

  const days = url.searchParams.get("days") === "30" ? 30 : 7;
  const now = Math.floor(Date.now() / 1000);
  let counts;
  try {
    counts = await env.DB.prepare(`
      SELECT COUNT(CASE WHEN rating = 'helpful' THEN 1 END) AS helpful,
             COUNT(CASE WHEN rating = 'not_helpful' THEN 1 END) AS unhelpful,
             COUNT(CASE WHEN rating = 'not_helpful' AND LENGTH(TRIM(reason)) > 0 THEN 1 END) AS with_reason
      FROM answer_feedback
      WHERE updated_at > ? AND updated_at <= ?
    `).bind(now - days * DAY_SECONDS, now).first();
  } catch {
    return json({ error: "Laporan feedback belum dapat dimuat." }, 503);
  }

  const helpful = Number(counts.helpful);
  const unhelpful = Number(counts.unhelpful);
  const withReason = Number(counts.with_reason);
  const total = helpful + unhelpful;
  const number = new Intl.NumberFormat("id-ID");
  const rate = total ? new Intl.NumberFormat("id-ID", { style: "percent", maximumFractionDigits: 1 }).format(helpful / total) : "—";
  return new Response(`<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Feedback BOR AI</title>
<style>body{font:1rem/1.5 system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;color:#1c2937}nav{display:flex;gap:1.2rem}table{width:100%;margin-top:1rem;border-collapse:collapse}caption{text-align:left;font-weight:600}th,td{text-align:left;padding:.65rem .25rem;border-bottom:1px solid #d9e0e8}td{text-align:right}a{color:#184ca8}</style></head>
<body><main><h1>Feedback BOR AI</h1>
<nav aria-label="Periode laporan"><a href="?days=7"${days === 7 ? ' aria-current="page"' : ''}>7 hari</a><a href="?days=30"${days === 30 ? ' aria-current="page"' : ''}>30 hari</a></nav>
<table><caption>${days} hari terakhir</caption><tbody>
<tr><th scope="row">Total penilaian</th><td>${number.format(total)}</td></tr>
<tr><th scope="row">Membantu</th><td>${number.format(helpful)}</td></tr>
<tr><th scope="row">Tidak membantu</th><td>${number.format(unhelpful)}</td></tr>
<tr><th scope="row">Tidak membantu, dengan alasan</th><td>${number.format(withReason)}</td></tr>
<tr><th scope="row">Persentase penilaian membantu</th><td>${rate}</td></tr>
</tbody></table><p>Periode mengikuti waktu terakhir penilaian diperbarui. Setiap jawaban dihitung berdasarkan penilaian terakhirnya.</p></main></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex"
    }
  });
}
