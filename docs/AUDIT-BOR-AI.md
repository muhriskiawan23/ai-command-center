# Audit Teknis BOR AI — Audit historis 31 Oktober 2026; refresh terbatas 9 November 2026

Branch audit historis: `bor-ai/stage-06-input-audit` (di atas `bor-ai/stage-05-chat-core`). Nomor baris di bagian historis merujuk ke berkas pada branch tersebut.

> **Penting:** Bagian 1–5 dan daftar temuan di bawah mempertahankan hasil audit historis 31 Oktober 2026. Status temuan tersebut tidak otomatis mencerminkan kondisi `main` saat ini. Refresh 9 November di bagian 0 hanya memeriksa ulang pembaca tautan, sumber riset, validasi sitasi, batas kemampuan produk, dan bukti CI yang tersedia. Temuan lain harus direproduksi sebelum dinyatakan masih terbuka atau sudah selesai.


## 0. Refresh terbatas — 9 November 2026

**Baseline kode (audit historis):** source-page reader and citation flow were initially reviewed on `cee8b2799f51f868fd75770b9f52e85ace2a8329`; subsequent security/release changes include PR #128 (`2d22f13`), PR #130 (`812d020`), provider-neutral adapter PR #129 (`f9a7e98b4a5264eca32eeeea73c4a3d07ab1c5da`), and search diversity PR #133 (`0d0d7d34011137efa3dd8015b5f422bae23de14b`). **This is a historical baseline, not current main.** Current main baseline is recorded in section 0.1 and release updates below.

**Berkas dan alur yang ditinjau:** `src/links.js`, `tests/links.test.js`, `src/research.js`, `tests/research.test.js`, `src/citations.js`, `tests/citations.test.js`, serta alur penggabungan konteks, validasi sitasi, dan penyimpanan di `src/index.js`.

**Bukti CI dan deployment terkait:** PR #126 production run `42551688572` deployed Worker `3ff29355-a717-4ddb-8dd3-7019ea8cf256`; 335/335 tests passed and dashboard then showed 100% active traffic, while Cloudflare Build versions remained upload-only. P0 issue #122 was closed after this evidence. PR #124 run `42552262484` deployed `a87d158e-3afa-41b5-b014-0366ab9c3b93`; PR #125 run `42552337757` deployed `7585871b-44a1-444b-aa18-07d0aa25f7c6`. PR #128 run `42553445926` deployed `6b060010-580a-424c-b89e-453be2fcbf3a`; PR #130 run `42554505794` deployed `a9b779a8-7669-44d5-bddb-3dcefcb514be`; PR #129 post-merge run `42556216716` deployed `3b8b930a-73a0-4c1f-869e-42665d078062`. PR #133 exact-head and post-merge tests passed 365/365; post-merge test run `42557190585` passed. Production run `42557190489` deployed Worker `662aa46a-7bb2-4629-b7bb-d4187bc70257`. Its log verifies pinned D1 `bor-ai-chat` (`d71231a9-9a04-471c-b904-d1bc843940aa`), no migrations to apply and no migrations applied, deep health (D1 and AI binding), at least 10 agents, and Google Sign-In configuration. Optional live chat was skipped. Dashboard active traffic has not been re-inspected after PR #126. No live Brave provider request or live model inference was performed.

| Area | Kondisi yang terlihat di kode dan tes | Batas bukti / residual |
|---|---|---|
| Validasi URL dan SSRF | Hanya HTTP/HTTPS; kredensial URL dan port non-default ditolak; alamat IPv4/IPv6 non-publik yang dikenali, nama host satu-label/internal, dan host Worker sendiri ditolak. PR #128 menambah blok IPv4 `192.88.99.0/24`, IPv6 `2001::/23`, dan IPv6 dokumentasi `3fff::/20`; PR #130 mengembangkan bentuk IPv6 terkompresi sebelum pemeriksaan rentang agar alamat global-unicast valid tidak salah ditolak. | Ini pemeriksaan hostname/IP literal, bukan verifikasi hasil resolusi DNS. **DNS rebinding belum dicegah atau diverifikasi.** Cloudflare mendokumentasikan akses jaringan privat Worker melalui Workers VPC bindings; `wrangler.jsonc` BOR AI saat ini tidak mendeklarasikan binding tersebut, tetapi itu bukan bukti kebijakan egress account-wide. Tidak ada bukti runtime bahwa DNS publik yang berubah menjadi alamat privat selalu diblokir. Perlu validasi konfigurasi akun/egress dan desain DNS-pinning atau egress proxy sebelum klaim proteksi. |
| Redirect | Redirect diikuti manual, maksimum tiga lompatan, dan setiap tujuan divalidasi ulang sebelum fetch berikutnya. Tes memastikan redirect ke IP privat tidak diambil dan loop berhenti. | Redirect eksternal nyata dan perilaku jaringan Worker belum diuji live. |
| Batas sumber daya | Timeout 8 detik per halaman; body dibaca bertahap dan dihentikan sekitar 1 MB; teks yang diberikan ke model dibatasi 16.000 karakter; maksimal tiga URL dari pesan pengguna dan tiga halaman hasil pencarian dibaca. PR #128 juga membatalkan response body untuk status non-2xx atau tipe konten yang tidak didukung, serta untuk respons provider Brave non-2xx/oversized/non-JSON. | Timeout, streaming, pembatalan body, dan batas ukuran diuji dengan fetch/stream tiruan, bukan situs eksternal sungguhan. |
| Ekstraksi dan prompt injection | HTML diubah menjadi teks; elemen script/style/noscript/svg/template/iframe/head dan komentar dibuang; karakter `<` dan `>` dari isi halaman dinetralkan sebelum dimasukkan ke blok data tidak tepercaya. System prompt juga melarang mengikuti instruksi dari halaman. | Ini mitigasi berlapis, bukan jaminan bahwa model asli selalu kebal prompt injection. Tidak ada red-team live-model dalam refresh ini. |
| Status baca halaman | Tautan pengguna ditandai berhasil/gagal dengan alasan. Hasil pencarian membedakan `read` dan `snippet_only`; jika halaman gagal dibaca, model hanya menerima judul/snippet dan catatan kegagalan, bukan klaim bahwa artikel penuh telah dibaca. | Situs yang membutuhkan JavaScript/login, paywall, challenge, dan format tak didukung tetap dapat gagal. PDF URL tidak dibaca oleh link reader. |
| Source ID dan sitasi | ID sumber dialokasikan berurutan untuk tautan pengguna, curated knowledge, dan hasil pencarian. Validasi pasca-generasi menghapus ID yang tidak sukses; tautan Markdown harus cocok dengan URL sumber yang tercatat, termasuk URL redirect yang tervalidasi. | Validasi memastikan keberadaan ID/URL, bukan bahwa setiap kalimat benar-benar didukung secara semantik oleh sumber tersebut. |
| Persistensi | Teks halaman dipakai sebagai konteks untuk permintaan saat itu. Penyimpanan percakapan menyimpan jawaban dan metadata sumber (`links_json`), bukan body halaman mentah. | Metadata sumber tetap dapat berisi URL, judul, host, jumlah karakter, status, dan alasan kegagalan. Refresh ini tidak menjalankan audit retensi D1 penuh. |
| PDF upload request cap | PR #121 sudah menambahkan `readRequestBytesWithinLimit` untuk membatasi body multipart aktual (`PDF_MAX_BYTES + 64 KiB`) sebelum `formData()`; `Content-Length` hanya menjadi early-rejection hint. File tetap dibatasi maksimal 8 MB setelah parsing. Regression test mengirim stream oversized tanpa `Content-Length`, memastikan HTTP 413 dan pembatalan sebelum seluruh file dibaca. | Perbaikan sudah ada di `main` dan termasuk dalam production deploy commit `706004a`; regression test lulus. Belum dilakukan upload oversized langsung ke endpoint production. Uji stream memakai Worker test harness. |
| Word DOCX extraction | PR #125 merged and deployed: local browser extraction from `word/document.xml`, 5 MB file cap, 2,000 ZIP-entry/paragraph cap, 30 MB expanded content cap, 10,000-character context cap; server validates size, escapes delimiters, and marks extracted text untrusted. Raw file and extracted text are not persisted. | Parser uses a bounded XML tokenizer, skips comments/processing instructions/CDATA markup, preserves CDATA in `w:t`, rejects DTD, and enforces actual decompressed-byte limits. Exact-head tests passed 355/355; production deploy run `42552337757` succeeded. No real-world DOCX corpus or device/browser compatibility test yet. |
| Deployment dan D1 pinning | GitHub Actions is the authoritative production traffic promoter; Cloudflare Workers Builds Production Deploy command is `npx wrangler versions upload` and only uploads a version. PR #126 run `42551688572` deployed version `3ff29355-a717-4ddb-8dd3-7019ea8cf256`; dashboard showed it active at 100%, with Build versions `0baa4c49` and `52cef062` Ready but not active. PR #124 and #125 subsequent GitHub Actions deploys succeeded with versions `a87d158e-3afa-41b5-b014-0366ab9c3b93` and `7585871b-44a1-444b-aa18-07d0aa25f7c6`. | D1 pin verification passed, no migrations pending, no migrations applied; deep health, agents, and Google config passed. Dashboard evidence confirms the upload-only Build command did not promote traffic at the inspected release. Re-inspect active traffic after any future change to the Cloudflare Build configuration. |

**Kesimpulan refresh terbatas:** tidak ditemukan regresi yang dapat dibuktikan pada alur pembaca tautan dari pemeriksaan statis dan fixture yang ditinjau. PR #128 memperkuat blok alamat khusus dan pembatalan response body; PR #130 memperbaiki pemeriksaan IPv6 terkompresi; PR #129 menambahkan kontrak adapter search/news netral-provider dengan Brave sebagai satu-satunya adapter terdaftar dan fail-closed untuk provider tak dikenal; PR #133 menambahkan canonical URL deduplication dan batas dua hasil usable per hostname. Post-merge main tests lulus 365/365 dan production Worker `662aa46a-7bb2-4629-b7bb-d4187bc70257` berhasil diverifikasi melalui deep health, agents, dan Google Sign-In. D1 ter-pin, tidak ada migrasi tertunda atau diterapkan. Dashboard traffic belum diperiksa ulang setelah PR #126. Ini bukan audit penetrasi penuh, pengujian corpus DOCX nyata, atau validasi live model/search. Tidak ada Brave call atau live model inference yang dilakukan.
## 0.1. Pembaruan setelah PR #147–#148 — 9 November 2026

**Baseline terbaru:** `24541b5d1f1400c516ef1b31426f77547cbbe98f` (PR #148). PR #147 memperbaiki redirect provider Tavily/Brave agar kompatibel dengan Cloudflare Workers: request memakai `redirect: "manual"` dan respons 3xx ditolak tanpa mengikuti redirect. Regression test memastikan hanya satu fetch dan tujuan redirect tidak pernah dihubungi. PR #148 menganggap secret kosong/spasi sebagai tidak terkonfigurasi dan menguji fallback Brave ketika secret Tavily hanya whitespace.

**Bukti rilis:** PR #147 production deploy `42584477901` sukses; live Tavily smoke `42584585509` sukses: Web menghasilkan 1 sumber usable dan News menghasilkan 4. PR #148 post-merge tests `42588126753` dan production deployment `42588126655` sukses, termasuk verifikasi endpoint produksi. Smoke lanjutan `42588229148` berstatus skipped karena release-marker condition; jangan menyebutnya sebagai live pass. Brave belum live-verified.

**Residual yang belum ditutup:** DNS rebinding dan egress aktual Worker masih belum diverifikasi; red-team prompt injection dengan model live belum dilakukan; traffic-controller aktif belum diinspeksi ulang setelah release terbaru; audit penetrasi eksternal dan review historis lain belum selesai. Tes unit/E2E yang memakai fetcher tiruan tidak membuktikan perilaku jaringan produksi.

## 1. Ruang lingkup dan batas audit (baca dulu)

**Diaudit:** seluruh source code (`src/index.js`, `public/app.js`, `public/index.html`, `public/app.css`, `wrangler.jsonc`, `migrations/`, `.github/workflows/`), serta perilaku di browser untuk 8 ukuran layar memakai Worker yang sama dengan production terhadap SQLite sungguhan dan AI tiruan.

**TIDAK dapat diuji dari lingkungan audit** (dinyatakan eksplisit, bukan diasumsikan lolos):

| Hal | Alasan |
|---|---|
| URL preview/production (`*.workers.dev`) | Tidak terjangkau dari sandbox audit. Yang diaudit adalah kode yang sama, bukan URL hidup. |
| Login Google asli | Butuh Client ID dan origin sungguhan. Uji memakai SDK tiruan; token palsu terbukti ditolak server (401). |
| Kualitas dan perilaku model AI asli | Uji memakai AI tiruan agar tanpa biaya. Efektivitas perbaikan prompt pada Llama 3.3 70B belum teruji. |
| Keyboard virtual Android/iOS sungguhan | Hanya ada **emulasi** (viewport menyusut). Bukan pengujian perangkat nyata. |
| Safari/iOS dan Firefox | Seluruh uji browser memakai **Chromium saja**. |
| Beban/stress dan biaya AI nyata | Tidak dijalankan. |
| Pembaca layar (screen reader) | Tidak diuji. |

**Koreksi atas klaim sebelumnya (snapshot audit 31 Oktober):** saat itu `wrangler.jsonc` memang belum memuat `database_id`, sehingga cara Workers Builds meng-bind D1 untuk preview tidak dapat dipastikan. Pada `main` saat ini, `wrangler.jsonc` sudah mem-pin `database_id` D1 produksi; run produksi `42518807471` memverifikasi pin tersebut dan melaporkan tidak ada migrasi tertunda. Hal ini tetap tidak membuktikan database yang dipakai oleh preview Workers Builds; pengaturan Git integration/preview D1 masih perlu diperiksa di dashboard Cloudflare.

## 2. Ringkasan

Tidak ada temuan **Critical** yang terkonfirmasi. Ada 1 temuan **High** yang sudah diperbaiki (klaim kemampuan palsu), 1 **High** yang terbuka (eksposur biaya), 5 **Medium**, dan beberapa **Low**.

## 3. Temuan

Status: **DIPERBAIKI** (ada test), **TERBUKA** (butuh keputusan/infrastruktur), **TERKONFIRMASI-KODE** (terbukti dari kode, belum direproduksi di runtime).

| ID | Komponen | Temuan | Sev. | Root cause | Lokasi | Rekomendasi | Status |
|---|---|---|---|---|---|---|---|
| H1 | Multi-agent / Prompt | Model mengaku bisa "berita terkini" dan "mencari sumber online" (terlihat di screenshot mode Analyst) padahal tidak punya kemampuan itu | High | Hanya prompt Researcher dan penulis final yang melarang klaim browsing; agent lain tidak punya pernyataan kemampuan | `src/index.js:8` (`CAPABILITY_NOTICE`), dipasang di `runAgent` | Pernyataan kemampuan nyata di SEMUA agent; perbarui saat kemampuan baru benar-benar ada | **DIPERBAIKI**. `tests/capabilities.test.js` membuktikan pernyataan sampai ke semua agent. Efektivitas di model asli belum teruji. |
| H2 | Biaya / Abuse | Endpoint chat publik (Guest) bisa memicu hingga ~12 panggilan model per permintaan. Batas semula hanya 20 permintaan/60 dtk per IP; penyerang terdistribusi tidak terbatas. | High | Desain publik tanpa kuota harian/anggaran global | `src/index.js` (`enforceDailyLimits`, `consumeUsage`), `migrations/0002_daily_usage.sql` | Kuota harian per tamu/akun + rem darurat global; anti-bot (Turnstile) | **DIPERBAIKI SEBAGIAN** (Stage 7): tamu 15, akun 150, global 1.500 unit/hari (multi-agent = 3 unit; jatah dikembalikan bila AI gagal). Diuji pada SQLite nyata (`tests/daily-limits.test.js`). **Belum:** Turnstile/anti-bot; penyerang dengan banyak IP tetap bisa menghabiskan jatah global 1.500/hari (dampak maksimum terbatas). Run produksi `42518807471` pada 8 November memverifikasi D1 yang dipin dan `wrangler d1 migrations list` melaporkan tidak ada migrasi tertunda, sehingga migration `0002` telah diterapkan pada saat itu. Namun, live chat/quota smoke check dilewati; penegakan kuota aktual belum diuji lewat request produksi. |
| M1 | Riwayat / API | Membuka satu percakapan mengembalikan SEMUA pesan tanpa batas | Medium | Query tanpa `LIMIT` | `src/index.js:701` (sebelumnya `ORDER BY id ASC` tanpa batas) | Batasi dan beri tanda `truncated` | **DIPERBAIKI**: 500 pesan terbaru + `truncated`. `tests/conversation-limits.test.js` (1.200 pesan). |
| M2 | Chat / Klien | Tidak ada timeout di klien: bila server macet, composer terkunci tanpa batas | Medium | `fetch` tanpa `AbortController` | `public/app.js` (`CHAT_TIMEOUT_MS`, `api()`) | Batas waktu + pesan jelas + Coba lagi | **DIPERBAIKI** (150 dtk; pesan error dan retry tersedia). Stage 15 menambahkan request ID per submit untuk akun: jika Worker sudah menyimpan giliran tetapi respons hilang, retry dengan ID yang sama memutar ulang jawaban tersimpan. Diuji pada API dan E2E, termasuk isolasi antar-akun. Membutuhkan migration `0006_chat_request_idempotency.sql`. Guest tetap memory-only dan tidak memiliki deduplikasi persisten. |
| M3 | Riwayat | Daftar percakapan dibatasi 100 tanpa pagination; chat ke-101+ tak terjangkau dari UI (hanya bisa dihapus massal) | Medium | `LIMIT 100`, tanpa paginasi | `src/index.js` (conversation list route) | Paginasi/infinite scroll, pencarian | **DIPERBAIKI** (Stage 13): keyset pagination 100 item per halaman; pencarian dan arsip tetap account-scoped. Diuji melintasi 205 percakapan termasuk validasi cursor dan isolasi akun. |
| M4 | Deployment | Initial finding: GitHub Actions and Cloudflare Workers Builds both ran on the `706004a` push. Resolved: Cloudflare production Deploy command is now `npx wrangler versions upload`; dashboard inspection showed the GitHub Actions version active at 100% and Build-uploaded versions Ready but not active. | High / P0 | Competing production traffic promoters could race or diverge | `.github/workflows/bor-ai-deploy.yml`; Cloudflare Build history; GitHub runs `42522046920`, `42551688572`, `42552262484`, `42552337757` | Keep GitHub Actions as sole production traffic promoter; Cloudflare Builds may upload versions only. Re-inspect dashboard after any configuration change. | **CLOSED — issue #122** after dashboard evidence was recorded. |
| M5 | Orkestrasi | Tidak ada timeout/anggaran waktu di sisi server untuk `env.AI.run`; alur multi-agent berurutan | Medium | Panggilan model tanpa batas waktu per langkah maupun total | `src/index.js` (`withAiDeadline`, `AiTimeoutError`) | Timeout per panggilan dan anggaran total | **DIPERBAIKI** (Stage 9): 45 dtk per panggilan, 100 dtk total untuk multi-agent (dapat diubah lewat `AI_CALL_TIMEOUT_MS` / `AI_TOTAL_BUDGET_MS`); respons 504 `ai_timeout`, jatah harian dikembalikan, tidak ada yang disimpan. Diuji dengan AI tiruan (`tests/ai-timeouts.test.js`). **Batasan:** panggilan yang habis waktu tidak dapat dibatalkan di sisi penyedia AI, sehingga biaya panggilan itu tetap mungkin terjadi. |
| L1 | UI / Health | Indikator "Layanan terhubung" hanya berarti Worker hidup; tidak memeriksa D1 atau AI | Low | Endpoint health statis | `src/index.js:743` | `?deep=1` untuk cek D1; jangan tampilkan "terhubung" bila tidak diperiksa | **TERBUKA** |
| L2 | Operasional | Tidak ada observability/log persisten di konfigurasi | Low | `observability` tidak diaktifkan | `wrangler.jsonc` | Aktifkan Workers Logs (cek biaya/retensi) | **TERBUKA** |
| L3 | Auth | Logout hanya mengakhiri sesi perangkat ini | Low | Hapus satu token | `src/index.js:670` | Opsi "keluar dari semua perangkat" | **TERBUKA** |
| L4 | Auth | `/api/auth/nonce` dan `/api/auth/google` sebelumnya tanpa rate limit sendiri | Low | Limiter awalnya hanya dipasang di chat | `src/index.js` (`handleAuthRoute`, `authRateLimit`) | Pasang limiter yang sama | **DIPERBAIKI**: kedua endpoint kini memakai bucket IP terpisah (`auth:nonce:` dan `auth:google:`), gagal-tertutup jika binding limiter hilang/error, dan mengembalikan 429 dengan Retry-After. Dibuktikan oleh `tests/auth.test.js`. |
| L5 | CSP | `style-src` masih `'unsafe-inline'` | Low | Style inline di markup dan JS | `src/index.js:136` | Pindahkan ke kelas CSS | **TERBUKA** |
| L6 | Penyimpanan | Tidak ada kuota penyimpanan per pengguna | Low | Pembatasan hanya per permintaan (12.000 karakter) | `src/index.js:3`, `:714-727` | Kuota per akun | **TERBUKA** |
| L7 | Aksesibilitas | `aria-live="polite"` pada seluruh area percakapan dapat membuat pembaca layar membacakan ulang konten besar | Low | Region live terlalu luas | `public/index.html` (`#conversation`) | Region live khusus pesan baru | **HIPOTESIS**, tidak diuji dengan screen reader |
| I1 | Auth | Perbandingan nonce `!==` (bukan constant-time) | Info | — | `src/index.js:626` | Tidak mendesak: nonce berumur 5 menit dan bukan rahasia jangka panjang | Info |

## 4. Perilaku kolom input chat (sesuai spesifikasi)

| Persyaratan | Implementasi | Status uji |
|---|---|---|
| Enter = baris baru | Handler Enter-kirim dihapus (`public/app.js:429` komentar penjelas). `enterkeyhint="enter"` pada textarea | Lolos: `tests/e2e/composer.spec.js` (Enter, Shift+Enter) di 8 viewport |
| Tidak ada pintasan kirim lain | Ctrl/Meta+Enter tidak mengirim | Lolos |
| Tombol panah = kirim, sekali | `lockComposer()` + flag `busy`; klik ganda tidak menggandakan | Lolos (`dblclick` → 1 POST, baris baru utuh) |
| Auto-expand | `resizePrompt()` (`public/app.js:25`) memakai `scrollHeight` | Lolos |
| Batas tinggi + scroll internal | CSS `max-height:min(220px,40dvh)`; `overflow-y:auto` hanya saat melebihi batas | Lolos (60 baris: tinggi ≤ batas, `scrollHeight > clientHeight`, `scrollTop` dapat digeser) |
| Keyboard virtual tidak menutupi input | `interactive-widget=resizes-content`, `100dvh`, batas tinggi mengikuti layar | **Hanya emulasi viewport menyusut: lolos. Keyboard Android/iOS sungguhan: TIDAK DIUJI.** |
| Tombol kirim tetap terlihat | — | Lolos (posisi di dalam viewport) |
| Desain/posisi tombol dipertahankan | Hanya area sentuh diperluas ke 44px (`::after`) | Visual tidak berubah |

Catatan produk: spesifikasi meminta Enter = baris baru di semua perangkat. Perlu diketahui, ChatGPT versi desktop sebenarnya mengirim saat Enter; hanya versi mobile yang membuat baris baru. Implementasi mengikuti spesifikasi tertulis (semua perangkat). Bila ingin, perilaku desktop dapat dijadikan pengaturan.

## 5. Yang diperiksa dan dinyatakan aman (disertai bukti)

| Area | Bukti |
|---|---|
| Verifikasi Google | `aud`, `iss`, `exp`, `nonce`, `email_verified` diperiksa (`src/index.js:~572-580`); token rusak/palsu → 401 tanpa detail |
| Cookie sesi | `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax` (`:513`, `cookieHeader`); token disimpan sebagai hash SHA-256 (test) |
| Isolasi data antar pengguna | Semua query memakai `user_id` dari sesi server; diuji pada SQLite nyata (`tests/isolation.test.js`) |
| CSRF | Mutasi lintas-origin ditolak 403 meski cookie valid (test) |
| XSS | `markdown()` meng-escape sebelum format; payload `<img onerror>`, `<script>`, `<svg onload>`, `javascript:` dari jawaban AI dan pesan pengguna tidak dieksekusi (`tests/e2e/security-ui.spec.js`) |
| CSP | `script-src` tanpa `'unsafe-inline'`, tanpa skrip inline di HTML (`tests/security-headers.test.js`) |
| Atomisitas penyimpanan | Pesan pengguna + jawaban ditulis dalam satu batch (`:727`); AI gagal → tidak ada yang tersimpan (test) |
| Batas ukuran | Body maksimal 64 KB (`:3`); riwayat dibatasi (`:18`) |
| Log | Hanya objek error yang dicatat; isi pesan pengguna tidak dicatat |

## 6. Batas kemampuan produk saat ini (bukan bug)

BOR AI tetap merupakan workspace chat AI yang berpusat pada Coordinator dan specialist modes. Runtime adaptive model gateway saat ini hanya memiliki satu model Workers AI yang eligible: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Tidak ada provider/model kedua yang aktif dan tidak ada hasil evaluasi live yang membuktikan kandidat lain lebih baik.

Kemampuan file yang terdokumentasi di repository bersifat terbatas dan sebagian besar diekstrak lokal di browser:

- **PDF browser composer:** satu file hingga 8 MB; PDF.js mengekstrak teks secara lokal dan Tesseract.js melakukan OCR lokal untuk dokumen scan (English/Indonesian, maksimal 10 halaman). Hanya teks hasil ekstraksi yang dikirim ke `/api/chat`; raw PDF tidak diunggah oleh jalur UI ini.
- **PDF server endpoint terpisah:** `POST /api/documents/pdf` menerima multipart same-origin; body dibatasi sebelum parsing hingga `PDF_MAX_BYTES + 64 KiB` dan file dibatasi maksimal 8 MB. Endpoint mengirim raw PDF ke Cloudflare Workers AI `env.AI.toMarkdown` untuk konversi sementara. Endpoint ini tidak dipanggil oleh composer browser saat ini. Pemanggil endpoint harus mengetahui bahwa file PDF dikirim ke Cloudflare; endpoint ini mengonsumsi satu unit kuota harian.
- Kedua jalur tidak menyimpan file PDF atau teks ekstraksi ke D1. Teks browser dibatasi 30.000 karakter; hasil konversi server dibatasi 32.000 karakter. Kualitas OCR/konversi dan semua layout tidak dijamin.
- **CSV/XLSX:** satu file hingga 5 MB; parsing, preview baris terbatas, dan ringkasan numerik deterministik di browser. XLSX maksimal 10 sheet dan 10.000 baris data total. Formula diperlakukan sebagai teks, bukan dieksekusi.
- **PPTX:** satu file hingga 5 MB; ekstraksi teks maksimal 80 slide di browser. Gambar, chart, animasi, dan speaker notes tidak diekstrak.
- **Image understanding, audio input/output, dan video analysis:** belum tersedia di aplikasi. Inventaris model vision di `docs/MULTIMODAL-READINESS.md` hanya shortlist dokumentasi; tidak berarti model telah diuji atau diaktifkan.

BOR AI tidak memiliki runtime eksekusi kode/build APK, kontrol browser/komputer, atau konektor Gmail/Calendar/Slack/Discord/WhatsApp yang terverifikasi live. Repository memiliki kode dan setup untuk GitHub App, Telegram, serta widget/public API, tetapi aktivasi produksi memerlukan secret, migrasi D1, izin pengguna/provider, dan smoke test masing-masing. Keberadaan kode bukan bukti bahwa integrasi sedang aktif.

### Web research dan pembaca tautan

- **Live search/news:** adapter Brave tersedia dalam kode, tetapi pencarian live tetap belum terverifikasi sampai `BRAVE_SEARCH_API_KEY`, kuota provider, dan smoke test terkendali dikonfirmasi. Tanpa provider yang aktif, BOR AI tidak boleh mengarang hasil pencarian.
- **Tautan yang dikirim pengguna:** maksimal tiga URL per pesan. Hanya HTTP/HTTPS pada port default, tanpa kredensial; URL dengan host internal/non-publik atau host Worker sendiri ditolak. Redirect manual maksimal tiga lompatan dan tiap tujuan divalidasi ulang.
- **Batas per halaman:** timeout 8 detik, body maksimum 1 MB, teks maksimum 16.000 karakter. HTML, XHTML, plain text, Markdown, dan JSON dapat dibaca jika menghasilkan teks yang cukup. Halaman JavaScript-only, login, paywall/challenge, PDF, dan format tak didukung dapat gagal.
- **Hasil pencarian:** maksimal lima hasil kandidat dari adapter; hingga tiga halaman tujuan dibaca. Konteks membedakan halaman yang benar-benar dibaca (`read`) dari snippet saja (`snippet_only`), serta memberi alasan ketika pembacaan gagal.
- **Prompt injection:** konten web diperlakukan sebagai data tidak tepercaya, bukan instruksi. Tag sudut dinetralkan dan system prompt memberi batasan; kepatuhan model asli belum dibuktikan oleh unit/E2E test.
- **Sitasi:** source ID harus merujuk ke sumber sukses. Link sitasi Markdown harus cocok dengan URL sumber yang tercatat. Pemeriksaan ini tidak membuktikan dukungan semantik setiap klaim.
- **Penyimpanan:** body halaman tidak disimpan sebagai isi percakapan; jawaban dan metadata sumber disimpan untuk pengguna yang memiliki riwayat persisten.

### Batas bukti dan hal yang belum diverifikasi

- Worker live, Google sign-in asli, model inference asli, Brave Search/News, DNS rebinding/egress aktual, anti-bot, biaya provider, dan perilaku situs eksternal belum diverifikasi dalam refresh ini.
- Unit/integration/E2E dengan mock membuktikan perilaku di fixture, bukan kualitas model asli atau ketersediaan provider live.
- Temuan H2, M1–M5, L1–L7, dan I1 di bagian historis tidak dinyatakan selesai/terbuka berdasarkan refresh terbatas ini. Setiap temuan harus diuji ulang pada `main` dan/atau konfigurasi produksi sebelum statusnya diperbarui.


## 0.2. Klarifikasi batas DNS rebinding — 9 November 2026

Pemeriksaan kode terbaru menemukan komentar lama yang menyatakan Workers tidak dapat menjangkau jaringan privat. Klaim tersebut terlalu luas dan telah dikoreksi di `src/links.js`. Dokumentasi Cloudflare menyebut Workers dapat menjangkau layanan privat melalui Workers VPC bindings ([Workers VPC overview](https://developers.cloudflare.com/workers-vpc/), [VPC Networks](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/)). Konfigurasi `wrangler.jsonc` BOR AI saat ini tidak mendeklarasikan binding VPC, tetapi audit ini tidak memiliki bukti kebijakan egress account-wide atau perilaku resolusi DNS aktual untuk semua jalur Worker.

**Kesimpulan yang aman:** validasi URL menolak IP literal non-publik dan host internal yang dikenal, serta memvalidasi setiap redirect. Ia tidak melakukan DNS resolution/pinning. Karena itu, DNS rebinding tidak boleh ditandai sebagai mitigasi selesai. Langkah berikutnya adalah memeriksa konfigurasi jaringan/egress Cloudflare yang benar-benar aktif dan memilih kontrol yang dapat mengikat hostname ke alamat IP tervalidasi (atau menggunakan egress proxy yang menerapkan kebijakan tersebut). Tidak ada perubahan perilaku runtime dalam PR dokumentasi ini.


## 0.2. Pembaruan setelah PR #147–#150 — 9 November 2026

**Baseline produksi:** merge PR #150, commit f22bbd1d5f4ee0ebe0092457a8503ba1075ef710.

**Perubahan dan bukti:**
- PR #147 memperbaiki adapter Tavily/Brave agar menggunakan redirect manual pada Cloudflare Workers dan menolak respons 3xx tanpa mengikuti redirect. Live smoke pada release PR #147 (42584585509) berhasil: Web 1 sumber usable, News 4 sumber usable.
- PR #148 memperbaiki pemeriksaan secret yang hanya berisi whitespace agar dianggap belum dikonfigurasi.
- PR #149 menyelaraskan dokumentasi dengan bukti release.
- PR #150 memperbaiki komentar yang terlalu luas tentang akses private network di Workers dan mencatat batas DNS rebinding. PR #150 tidak mengubah perilaku runtime, konfigurasi Worker, atau kebijakan egress.

**Verifikasi release PR #150:**
- Exact-head unit/syntax/preview validation, E2E, preview build, dan Workers Builds: sukses.
- Production deployment 42590507391: sukses. D1 database bor-ai-chat terverifikasi ter-pin; tidak ada migrasi tertunda, sehingga langkah migrasi dilewati. Worker/assets dan pemeriksaan endpoint produksi berhasil.
- Post-merge tests 42590507411: sukses.
- Tavily live smoke 42590615200: sukses. Live Web Search mengembalikan 4 sumber usable; Live News Search mengembalikan 4 sumber usable. Pemeriksaan hanya mengungkap nama secret, bukan nilainya.
- Pemeriksaan secret produksi melaporkan TAVILY_API_KEY ada dan BRAVE_SEARCH_API_KEY tidak ada. Karena itu Tavily telah diverifikasi live pada release PR #150; Brave belum dikonfigurasi dan tidak boleh disebut sebagai fallback aktif.

**Residual keamanan yang belum ditutup:**
1. src/links.js memvalidasi IP literal dan sintaks hostname, tetapi tidak melakukan DNS resolution atau pinning. DNS rebinding belum dimitigasi atau diverifikasi pada jalur runtime.
2. wrangler.jsonc tidak mendeklarasikan Workers VPC binding. Ini bukan bukti bahwa akun Cloudflare tidak memiliki konfigurasi egress/private-network lain; konfigurasi akun dan trafik aktif belum diperiksa dari dashboard.
3. Mitigasi prompt injection pada halaman eksternal bersifat defense-in-depth: konten dinetralkan dan ditandai sebagai data tidak tepercaya, tetapi belum ada red-team menggunakan model produksi.
4. Dashboard Cloudflare untuk memastikan versi Worker yang menerima 100% trafik belum diperiksa ulang setelah release PR #150.
5. Penetration test eksternal, alerting/percentile operasional, dan pengujian pemulihan masih belum selesai.

**Catatan:** smoke Tavily membuktikan dua jalur pencarian live berhasil pada saat uji; tidak membuktikan kualitas faktual setiap sumber, ketersediaan kuota jangka panjang, atau keamanan seluruh alur model. Test fetcher tiruan tidak membuktikan perilaku jaringan DNS produksi.
