// Pembaca link: ekstraksi URL, perlindungan SSRF, redirect, batas ukuran/waktu, dan ekstraksi teks.
import test from "node:test";
import assert from "node:assert/strict";
import { extractUrls, validateUrl, blockedHostReason, htmlToText, readLink, buildPageContext, summarizeLinks, MAX_DOWNLOAD_BYTES, MAX_PAGE_CHARS } from "../src/links.js";

const html = (body, title = "Judul Uji") => `<!doctype html><html><head><title>${title}</title><style>.x{}</style><script>alert(1)</script></head><body>${body}</body></html>`;
const respond = (body, { status = 200, type = "text/html; charset=utf-8", headers = {} } = {}) => new Response(body, { status, headers: { "content-type": type, ...headers } });
const LONG = "Ini adalah paragraf uji yang cukup panjang supaya dianggap berisi teks yang berguna bagi model.";

test("ekstraksi URL: tanda baca, markdown, www, duplikat, dan batas 3 link", () => {
  assert.deepEqual(extractUrls("lihat https://a.com/x. dan (https://b.com/y) juga [c](https://c.com/z)!").urls, ["https://a.com/x", "https://b.com/y", "https://c.com/z"]);
  assert.deepEqual(extractUrls("buka www.contoh.id/artikel, lalu https://contoh.id").urls, ["https://www.contoh.id/artikel", "https://contoh.id"]);
  assert.deepEqual(extractUrls("https://a.com https://a.com").urls, ["https://a.com"]);
  assert.equal(extractUrls("https://wikipedia.org/wiki/Bogor_(kota)").urls[0], "https://wikipedia.org/wiki/Bogor_(kota)");
  const many = extractUrls("https://a.com https://b.com https://c.com https://d.com https://e.com");
  assert.equal(many.urls.length, 3); assert.equal(many.ignored, 2);
  assert.deepEqual(extractUrls("tidak ada link, hanya contoh.com dan ftp://x.com").urls, []);
});

test("SSRF: alamat internal, metadata cloud, IPv6, bentuk IP terselubung, kredensial, port, dan skema ditolak", () => {
  const blocked = [
    "http://localhost/", "http://127.0.0.1/", "http://127.1/", "http://0.0.0.0/", "http://10.1.2.3/", "http://172.16.0.1/", "http://172.31.255.255/",
    "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "http://192.88.99.2/", "http://100.64.0.1/", "http://224.0.0.1/", "http://255.255.255.255/",
    "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://[::1]/", "http://[::]/", "http://[fd00::1]/", "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[2002:7f00:1::]/", "http://[2001:db8::1]/", "http://[2001:2::1]/", "http://[2001:5::1]/", "http://[3fff::1]/",
    "http://intranet/", "http://metadata/", "http://printer.local/", "http://api.internal/", "http://x.localhost/", "http://router.lan/",
    "http://user:pass@example.com/", "https://example.com:8443/", "http://example.com:8080/", "ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "http://"
  ];
  for (const url of blocked) assert.equal(validateUrl(url).ok, false, `harus ditolak: ${url}`);
  const allowed = ["https://example.com/", "http://example.com/path?x=1", "https://sub.contoh.co.id/a", "https://8.8.8.8/", "https://[2606:4700:4700::1111]/", "https://[2a00::1]/", "https://example.com:443/"];
  for (const url of allowed) assert.equal(validateUrl(url).ok, true, `harus diizinkan: ${url}`);
  assert.equal(validateUrl("https://app.example.workers.dev/", "app.example.workers.dev").ok, false);   // host aplikasi sendiri
  assert.equal(blockedHostReason("example.com"), null);
});

test("ekstraksi teks HTML: buang script/style/head, ambil judul, dekode entitas, dan netralkan tanda kurung sudut", () => {
  const { title, text } = htmlToText(html("<nav>Menu</nav><h1>Halo &amp; selamat datang</h1><p>Baris&nbsp;satu<br>Baris dua &lt;/web_page&gt;</p><!-- rahasia --><script>x()</script>", "Berita &quot;Penting&quot;"));
  assert.equal(title, 'Berita "Penting"');
  assert.ok(text.includes("Halo & selamat datang"));
  assert.ok(!text.includes("alert(1)") && !text.includes("x()") && !text.includes("rahasia") && !text.includes(".x{}"));
  assert.ok(text.split("\n").length >= 3);
  const ctx = buildPageContext([{ ok: true, url: "https://a.com/", title: 'x" onload="y', text, chars: text.length, truncated: false }]);
  assert.equal((ctx.match(/<web_page /g) || []).length, 1);
  assert.equal((ctx.match(/<\/web_page>/g) || []).length, 1);          // penutup palsu dari isi halaman tidak lolos
  assert.ok(!/title="[^"]*"[^>]*onload/.test(ctx));
  assert.match(ctx, /source_id="1"/);
  assert.match(ctx, /CITATIONS:/);
});

test("sumber link memiliki ID stabil dan URL hanya diberikan untuk halaman yang berhasil dibaca", () => {
  const sources = summarizeLinks([
    { ok: true, url: "https://a.example/article", title: "Artikel A", chars: 120, truncated: false },
    { ok: false, url: "https://b.example/private", reason: "situs membalas 403" }
  ]);
  assert.equal(sources[0].sourceId, 1);
  assert.equal(sources[0].url, "https://a.example/article");
  assert.equal(sources[1].sourceId, 2);
  assert.equal(sources[1].ok, false);
  assert.equal("url" in sources[1], false);
});

test("membaca halaman: sukses, dipotong, dan teks tersimpan apa adanya hingga batas 16.000 karakter", async () => {
  const result = await readLink("https://example.com/a", { fetcher: async () => respond(html(`<p>${LONG}</p><p>${"x".repeat(MAX_PAGE_CHARS * 2)}</p>`)) });
  assert.equal(result.ok, true);
  assert.equal(result.title, "Judul Uji");
  assert.equal(result.truncated, true);
  assert.equal(result.text.length, MAX_PAGE_CHARS);
});

test("ekstraksi mempertahankan bagian artikel setelah 6.000 karakter", async () => {
  const marker = "BAGIAN_PENTING_IaaS_PaaS_SaaS";
  const body = `<p>${"awal ".repeat(1400)}</p><p>${marker}</p>`;
  const result = await readLink("https://example.com/artikel-panjang", { fetcher: async () => respond(html(body)) });
  assert.equal(result.ok, true);
  assert.ok(result.text.length > 6000);
  assert.ok(result.text.includes(marker));
});

test("redirect: tiap lompatan divalidasi ulang; ke IP privat ditolak dan tidak pernah diambil", async () => {
  const calls = [];
  const fetcher = async (url) => { calls.push(url); return url.includes("start") ? respond("", { status: 302, headers: { location: "http://10.0.0.5/admin" } }) : respond(html(LONG)); };
  const result = await readLink("https://example.com/start", { fetcher });
  assert.equal(result.ok, false);
  assert.match(result.reason, /pengalihan ke alamat yang tidak diizinkan/);
  assert.deepEqual(calls, ["https://example.com/start"]);
});

test("redirect yang sah diikuti (termasuk relatif); loop dihentikan setelah 3 lompatan", async () => {
  const ok = await readLink("https://example.com/a", { fetcher: async (url) => url.endsWith("/a") ? respond("", { status: 301, headers: { location: "/b" } }) : respond(html(LONG)) });
  assert.equal(ok.ok, true); assert.equal(ok.url, "https://example.com/b");
  let n = 0;
  const loop = await readLink("https://example.com/0", { fetcher: async () => respond("", { status: 302, headers: { location: `/${++n}` } }) });
  assert.equal(loop.ok, false); assert.match(loop.reason, /terlalu banyak pengalihan/); assert.equal(n, 4);
});

test("jenis konten tidak didukung, status error, halaman kosong/JS-only, dan jaringan gagal dilaporkan jujur", async () => {
  assert.match((await readLink("https://example.com/f.pdf", { fetcher: async () => respond("%PDF", { type: "application/pdf" }) })).reason, /belum didukung \(application\/pdf\)/);
  assert.match((await readLink("https://example.com/x", { fetcher: async () => respond("nope", { status: 404 }) })).reason, /404/);
  assert.match((await readLink("https://example.com/spa", { fetcher: async () => respond(html('<div id="root"></div><script src="app.js"></script>')) })).reason, /tidak berisi teks/);
  assert.match((await readLink("https://example.com/x", { fetcher: async () => { throw new Error("ECONNRESET"); } })).reason, /tidak dapat terhubung/);
});

test("batas waktu: server yang menggantung dibatalkan", async () => {
  const hang = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const started = Date.now();
  const result = await readLink("https://example.com/slow", { fetcher: hang, timeoutMs: 40 });
  assert.equal(result.ok, false); assert.match(result.reason, /waktu habis/);
  assert.ok(Date.now() - started < 2000);
});

test("batas unduhan: stream tak berujung dihentikan di sekitar 1 MB, tidak dibaca sampai habis", async () => {
  let pulled = 0;
  const chunk = new TextEncoder().encode(`<p>${"kata ".repeat(20000)}</p>`);       // ±100 KB per tarikan
  const stream = new ReadableStream({ pull(controller) { pulled += chunk.byteLength; controller.enqueue(chunk); if (pulled > 50_000_000) controller.close(); } });
  const result = await readLink("https://example.com/besar", { fetcher: async () => new Response(stream, { headers: { "content-type": "text/html" } }) });
  assert.equal(result.ok, true); assert.equal(result.truncated, true);
  assert.ok(pulled <= MAX_DOWNLOAD_BYTES + 400_000, `terbaca ${pulled} byte`);
});


test("redirect sukses mempertahankan URL asli dan mencatat URL tujuan akhir", async () => {
  const result = await readLink("https://example.com/start", { fetcher: async (url) => url.endsWith("/start") ? respond("", { status: 302, headers: { location: "/artikel" } }) : respond(html(LONG)) });
  assert.equal(result.ok, true);
  assert.equal(result.requested, "https://example.com/start");
  assert.equal(result.url, "https://example.com/artikel");
  const [source] = summarizeLinks([result]);
  assert.equal(source.url, "https://example.com/start");
  assert.equal(source.resolvedUrl, "https://example.com/artikel");
});


test("non-ok and unsupported responses are cancelled without buffering their bodies", async () => {
  for (const options of [
    { status: 404, type: "text/plain" },
    { status: 200, type: "application/pdf" }
  ]) {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("unused response body")); },
      cancel() { cancelled = true; }
    });
    const response = new Response(body, { status: options.status, headers: { "content-type": options.type } });
    const result = await readLink("https://example.com/unused", { fetcher: async () => response });
    assert.equal(result.ok, false);
    assert.equal(cancelled, true);
  }
});


test("IPv6 compressed zero hextets are expanded before special-range checks", () => {
  assert.equal(validateUrl("https://[2a00::1]/").ok, true);
  assert.equal(validateUrl("https://[2606:4700::1111]/").ok, true);
  assert.equal(validateUrl("https://[2001::1]/").ok, false);
  assert.equal(validateUrl("https://[3fff::1]/").ok, false);
});
