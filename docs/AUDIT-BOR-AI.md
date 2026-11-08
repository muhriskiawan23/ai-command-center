# Audit Teknis BOR AI — Audit historis 31 Oktober 2026; refresh terbatas 9 November 2026

Branch audit historis: `bor-ai/stage-06-input-audit` (di atas `bor-ai/stage-05-chat-core`). Nomor baris di bagian historis merujuk ke berkas pada branch tersebut.

> **Penting:** Bagian 1–5 dan daftar temuan di bawah mempertahankan hasil audit historis 31 Oktober 2026. Status temuan tersebut tidak otomatis mencerminkan kondisi `main` saat ini. Refresh 9 November di bagian 0 hanya memeriksa ulang pembaca tautan, sumber riset, validasi sitasi, batas kemampuan produk, dan bukti CI yang tersedia. Temuan lain harus direproduksi sebelum dinyatakan masih terbuka atau sudah selesai.


## 0. Refresh terbatas — 9 November 2026

**Baseline kode yang diperiksa:** `main` pada `cee8b2799f51f868fd75770b9f52e85ace2a8329`. PR dokumentasi #119 kemudian di-merge sebagai `b20ddabffe1a09932deae83dffa74222198c4125`; PR tersebut tidak mengubah kode aplikasi.

**Berkas dan alur yang ditinjau:** `src/links.js`, `tests/links.test.js`, `src/research.js`, `tests/research.test.js`, `src/citations.js`, `tests/citations.test.js`, serta alur penggabungan konteks, validasi sitasi, dan penyimpanan di `src/index.js`.

**Bukti CI dan deployment terkait:** pada head PR #119 `48ffd40b695f32d10607b3d9dd8f712049c900e7`, pemeriksaan Unit/syntax/preview validation, E2E Playwright, dan Cloudflare preview build semuanya selesai dengan status sukses. Run produksi `42518807471` pada 8 November memverifikasi D1 yang dipin dan menyatakan tidak ada migrasi tertunda; deploy Worker/assets sukses dan endpoint health, agents, serta Google config lolos. Optional live chat check dilewati. Run produksi tersebut memakai baseline `cee8b27`, bukan merge dokumentasi PR #119. Ini bukan bukti bahwa provider Brave, inference model asli, atau seluruh perilaku Worker live telah diuji.

| Area | Kondisi yang terlihat di kode dan tes | Batas bukti / residual |
|---|---|---|
| Validasi URL dan SSRF | Hanya HTTP/HTTPS; kredensial URL dan port non-default ditolak; alamat IPv4/IPv6 non-publik yang dikenali, nama host satu-label/internal, dan host Worker sendiri ditolak. Bentuk IPv4 non-kanonik dinormalisasi oleh parser URL dan dicakup oleh fixture. | Ini pemeriksaan hostname/IP literal, bukan verifikasi hasil resolusi DNS. DNS rebinding dan kebijakan egress aktual Worker tidak diuji pada runtime produksi dalam refresh ini. |
| Redirect | Redirect diikuti manual, maksimum tiga lompatan, dan setiap tujuan divalidasi ulang sebelum fetch berikutnya. Tes memastikan redirect ke IP privat tidak diambil dan loop berhenti. | Redirect eksternal nyata dan perilaku jaringan Worker belum diuji live. |
| Batas sumber daya | Timeout 8 detik per halaman; body dibaca bertahap dan dihentikan sekitar 1 MB; teks yang diberikan ke model dibatasi 16.000 karakter; maksimal tiga URL dari pesan pengguna dan tiga halaman hasil pencarian dibaca. | Timeout, streaming, dan batas ukuran diuji dengan fetch/stream tiruan, bukan situs eksternal sungguhan. |
| Ekstraksi dan prompt injection | HTML diubah menjadi teks; elemen script/style/noscript/svg/template/iframe/head dan komentar dibuang; karakter `<` dan `>` dari isi halaman dinetralkan sebelum dimasukkan ke blok data tidak tepercaya. System prompt juga melarang mengikuti instruksi dari halaman. | Ini mitigasi berlapis, bukan jaminan bahwa model asli selalu kebal prompt injection. Tidak ada red-team live-model dalam refresh ini. |
| Status baca halaman | Tautan pengguna ditandai berhasil/gagal dengan alasan. Hasil pencarian membedakan `read` dan `snippet_only`; jika halaman gagal dibaca, model hanya menerima judul/snippet dan catatan kegagalan, bukan klaim bahwa artikel penuh telah dibaca. | Situs yang membutuhkan JavaScript/login, paywall, challenge, dan format tak didukung tetap dapat gagal. PDF URL tidak dibaca oleh link reader. |
| Source ID dan sitasi | ID sumber dialokasikan berurutan untuk tautan pengguna, curated knowledge, dan hasil pencarian. Validasi pasca-generasi menghapus ID yang tidak sukses; tautan Markdown harus cocok dengan URL sumber yang tercatat, termasuk URL redirect yang tervalidasi. | Validasi memastikan keberadaan ID/URL, bukan bahwa setiap kalimat benar-benar didukung secara semantik oleh sumber tersebut. |
| Persistensi | Teks halaman dipakai sebagai konteks untuk permintaan saat itu. Penyimpanan percakapan menyimpan jawaban dan metadata sumber (`links_json`), bukan body halaman mentah. | Metadata sumber tetap dapat berisi URL, judul, host, jumlah karakter, status, dan alasan kegagalan. Refresh ini tidak menjalankan audit retensi D1 penuh. |
| PDF upload request cap | Endpoint memeriksa `Content-Length` sebelum parsing dan ukuran file setelah `request.formData()`. | Body multipart aktual belum dibatasi secara streaming sebelum parsing jika `Content-Length` tidak tersedia/tidak dapat dipercaya. Ini berpotensi membuat Worker membuffer body jauh di atas batas file 8 MB. Hardening dan regression test sedang disiapkan di PR #121; sampai ter-merge, jangan menganggap batas file sebagai batas memori pre-parse. |
| Deployment dan D1 pinning | `wrangler.jsonc` mem-pin nama dan `database_id` D1 produksi. `.github/workflows/bor-ai-deploy.yml` berjalan pada push ke `main` dan `workflow_dispatch`. Run produksi terakhir yang dapat diverifikasi, `42518807471` pada 8 November, memverifikasi D1 yang dipin, melaporkan **No migrations to apply**, melewati langkah apply, deploy Worker/assets (version `cb90d8ff-3cf1-4800-bb83-018871023ae6`), lalu meluluskan health, agents, dan Google config checks. | Optional live chat check dilewati. Run tersebut memakai baseline kode `cee8b27`; deployment setelah merge dokumentasi PR #119 belum terverifikasi. Check Cloudflare Workers Builds terlihat pada PR, tetapi pengaturan Git integration Cloudflare tidak tersedia dari repository; kemungkinan jalur deploy produksi kedua belum dapat dipastikan, sehingga M4 tetap belum ditutup. |

**Kesimpulan refresh terbatas:** tidak ditemukan regresi yang dapat dibuktikan pada alur pembaca tautan dari pemeriksaan statis dan fixture yang ditinjau. Namun, pemeriksaan juga menemukan potensi celah pembatasan body pada endpoint PDF server-side: `request.formData()` dipanggil sebelum ukuran body aktual dibatasi. PR #121 menambahkan pembacaan multipart berbatas dan regression test untuk stream tanpa `Content-Length`; statusnya harus tetap dianggap belum diperbaiki sampai PR tersebut lulus CI dan di-merge. Ini bukan audit penetrasi penuh dan bukan verifikasi live production. Tidak ada panggilan Brave, inference model, perubahan secret, atau migrasi database yang dijalankan.
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
| M4 | Deployment | Cloudflare Workers Builds check terlihat pada PR; workflow `bor-ai-deploy.yml` berjalan otomatis pada push `main` dan juga mendukung `workflow_dispatch`. Belum terbukti apakah Cloudflare Git integration juga mem-publish production pada push `main`. | Medium | Kemungkinan dua jalur deploy; konfigurasi Git integration tidak ada di repository | `.github/workflows/bor-ai-deploy.yml`, check "Workers Builds" di PR | Verifikasi pengaturan Cloudflare dashboard dan tetapkan satu jalur production resmi | **TERBUKA**. Workflow GitHub terbukti men-deploy baseline `cee8b27`; status Git integration Cloudflare belum dapat diverifikasi. |
| M5 | Orkestrasi | Tidak ada timeout/anggaran waktu di sisi server untuk `env.AI.run`; alur multi-agent berurutan | Medium | Panggilan model tanpa batas waktu per langkah maupun total | `src/index.js` (`withAiDeadline`, `AiTimeoutError`) | Timeout per panggilan dan anggaran total | **DIPERBAIKI** (Stage 9): 45 dtk per panggilan, 100 dtk total untuk multi-agent (dapat diubah lewat `AI_CALL_TIMEOUT_MS` / `AI_TOTAL_BUDGET_MS`); respons 504 `ai_timeout`, jatah harian dikembalikan, tidak ada yang disimpan. Diuji dengan AI tiruan (`tests/ai-timeouts.test.js`). **Batasan:** panggilan yang habis waktu tidak dapat dibatalkan di sisi penyedia AI, sehingga biaya panggilan itu tetap mungkin terjadi. |
| L1 | UI / Health | Indikator "Layanan terhubung" hanya berarti Worker hidup; tidak memeriksa D1 atau AI | Low | Endpoint health statis | `src/index.js:743` | `?deep=1` untuk cek D1; jangan tampilkan "terhubung" bila tidak diperiksa | **TERBUKA** |
| L2 | Operasional | Tidak ada observability/log persisten di konfigurasi | Low | `observability` tidak diaktifkan | `wrangler.jsonc` | Aktifkan Workers Logs (cek biaya/retensi) | **TERBUKA** |
| L3 | Auth | Logout hanya mengakhiri sesi perangkat ini | Low | Hapus satu token | `src/index.js:670` | Opsi "keluar dari semua perangkat" | **TERBUKA** |
| L4 | Auth | `/api/auth/nonce` dan `/api/auth/google` tanpa rate limit sendiri | Low | Limiter hanya dipasang di chat | `src/index.js:~616-651` | Pasang limiter yang sama | **TERBUKA** |
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
- **PDF server endpoint terpisah:** `POST /api/documents/pdf` menerima multipart same-origin hingga 8 MB dan mengirim raw PDF ke Cloudflare Workers AI `env.AI.toMarkdown` untuk konversi sementara. Endpoint ini tidak dipanggil oleh composer browser saat ini. Pemanggil endpoint harus mengetahui bahwa file PDF dikirim ke Cloudflare; endpoint ini mengonsumsi satu unit kuota harian.
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
