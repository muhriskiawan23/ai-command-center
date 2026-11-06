# Audit Teknis BOR AI — 31 Oktober 2026

Branch audit: `bor-ai/stage-06-input-audit` (di atas `bor-ai/stage-05-chat-core`).
Nomor baris merujuk ke berkas pada branch ini.

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

**Koreksi atas klaim sebelumnya:** sebelumnya dinyatakan bahwa URL preview memakai database yang sama dengan production. Itu **asumsi yang tidak terverifikasi**. `wrangler.jsonc` tidak berisi `database_id`, sehingga cara Workers Builds meng-bind D1 untuk preview tidak dapat dipastikan dari kode. Periksa di dashboard Cloudflare.

## 2. Ringkasan

Tidak ada temuan **Critical** yang terkonfirmasi. Ada 1 temuan **High** yang sudah diperbaiki (klaim kemampuan palsu), 1 **High** yang terbuka (eksposur biaya), 5 **Medium**, dan beberapa **Low**.

## 3. Temuan

Status: **DIPERBAIKI** (ada test), **TERBUKA** (butuh keputusan/infrastruktur), **TERKONFIRMASI-KODE** (terbukti dari kode, belum direproduksi di runtime).

| ID | Komponen | Temuan | Sev. | Root cause | Lokasi | Rekomendasi | Status |
|---|---|---|---|---|---|---|---|
| H1 | Multi-agent / Prompt | Model mengaku bisa "berita terkini" dan "mencari sumber online" (terlihat di screenshot mode Analyst) padahal tidak punya kemampuan itu | High | Hanya prompt Researcher dan penulis final yang melarang klaim browsing; agent lain tidak punya pernyataan kemampuan | `src/index.js:8` (`CAPABILITY_NOTICE`), dipasang di `runAgent` | Pernyataan kemampuan nyata di SEMUA agent; perbarui saat kemampuan baru benar-benar ada | **DIPERBAIKI**. `tests/capabilities.test.js` membuktikan pernyataan sampai ke semua agent. Efektivitas di model asli belum teruji. |
| H2 | Biaya / Abuse | Endpoint chat publik (Guest) bisa memicu hingga ~12 panggilan model per permintaan. Batas semula hanya 20 permintaan/60 dtk per IP; penyerang terdistribusi tidak terbatas. | High | Desain publik tanpa kuota harian/anggaran global | `src/index.js` (`enforceDailyLimits`, `consumeUsage`), `migrations/0002_daily_usage.sql` | Kuota harian per tamu/akun + rem darurat global; anti-bot (Turnstile) | **DIPERBAIKI SEBAGIAN** (Stage 7): tamu 15, akun 150, global 1.500 unit/hari (multi-agent = 3 unit; jatah dikembalikan bila AI gagal). Diuji pada SQLite nyata (`tests/daily-limits.test.js`). **Belum:** Turnstile/anti-bot; penyerang dengan banyak IP tetap bisa menghabiskan jatah global 1.500/hari (dampak maksimum terbatas). Perilaku di production bergantung pada migrasi 0002 yang sudah diterapkan. |
| M1 | Riwayat / API | Membuka satu percakapan mengembalikan SEMUA pesan tanpa batas | Medium | Query tanpa `LIMIT` | `src/index.js:701` (sebelumnya `ORDER BY id ASC` tanpa batas) | Batasi dan beri tanda `truncated` | **DIPERBAIKI**: 500 pesan terbaru + `truncated`. `tests/conversation-limits.test.js` (1.200 pesan). |
| M2 | Chat / Klien | Tidak ada timeout di klien: bila server macet, composer terkunci tanpa batas | Medium | `fetch` tanpa `AbortController` | `public/app.js` (`CHAT_TIMEOUT_MS`, `api()`) | Batas waktu + pesan jelas + Coba lagi | **DIPERBAIKI** (150 dtk; pesan error dan retry tersedia). Stage 15 menambahkan request ID per submit untuk akun: jika Worker sudah menyimpan giliran tetapi respons hilang, retry dengan ID yang sama memutar ulang jawaban tersimpan. Diuji pada API dan E2E, termasuk isolasi antar-akun. Membutuhkan migration `0006_chat_request_idempotency.sql`. Guest tetap memory-only dan tidak memiliki deduplikasi persisten. |
| M3 | Riwayat | Daftar percakapan dibatasi 100 tanpa pagination; chat ke-101+ tak terjangkau dari UI (hanya bisa dihapus massal) | Medium | `LIMIT 100`, tanpa paginasi | `src/index.js` (conversation list route) | Paginasi/infinite scroll, pencarian | **DIPERBAIKI** (Stage 13): keyset pagination 100 item per halaman; pencarian dan arsip tetap account-scoped. Diuji melintasi 205 percakapan termasuk validasi cursor dan isolasi akun. |
| M4 | Deployment | Dua jalur deploy: Cloudflare Workers Builds (terlihat di check PR) dan workflow `bor-ai-deploy.yml` (manual). Sumber kebenaran ambigu; risiko versi tertimpa atau tidak sinkron | Medium | Dua integrasi terpisah | `.github/workflows/bor-ai-deploy.yml`, check "Workers Builds" di PR | Tentukan satu jalur resmi untuk production | **TERBUKA**. Periksa pengaturan Git integration di dashboard Cloudflare. |
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

BOR AI adalah chat teks dengan satu model (`src/index.js`, Llama 3.3 70B di Workers AI). BOR AI **tidak** dapat: mencari di internet, membaca file/lampiran, menjalankan atau membangun kode (APK, aplikasi), mengendalikan aplikasi atau browser, atau terintegrasi dengan layanan pihak ketiga. Pernyataan ini dipasang ke prompt semua agent (H1).

**Satu pengecualian sejak Stage 8: membaca tautan yang diketik pengguna** (`src/links.js`). Server mengambil halaman, mengubahnya menjadi teks, dan memberikannya ke model sebagai data tidak tepercaya.

| Aspek | Perlakuan |
|---|---|
| SSRF | Hanya http/https port 80/443; tanpa username/password; IP privat/loopback/link-local/cadangan (IPv4 dan IPv6), bentuk IP terselubung (desimal/hex/oktal), nama host internal/satu-label, dan host aplikasi sendiri ditolak. Setiap pengalihan (maks. 3) divalidasi ulang. |
| Sumber daya | 8 dtk per halaman, unduhan maks. 1 MB, 6.000 karakter per halaman, maks. 3 tautan per pesan. Pesan dengan tautan memakai 1 unit kuota harian ekstra. |
| Injeksi prompt | Isi halaman dibungkus `<web_page>` dengan semua `<` dan `>` dinetralkan; prompt sistem melarang mengikuti instruksi di dalamnya dan mewajibkan model mengaku bila tautan tidak terbaca. Isi halaman tidak disimpan di database. |
| Transparansi | Pengguna melihat daftar tautan yang terbaca atau gagal (beserta alasannya) di bawah jawaban. |

**Batasan yang diketahui dan belum dapat dibuktikan dari lingkungan audit:**

- DNS rebinding (nama publik yang mengarah ke IP privat) tidak dapat dideteksi dari Worker. Worker tidak dapat menjangkau jaringan privat, sehingga ini lapisan pertahanan tambahan, bukan satu-satunya penghalang.
- Pengujian memakai `fetch` tiruan. Perilaku terhadap situs sungguhan (anti-bot, paywall, Cloudflare challenge, halaman yang dirender JavaScript, PDF) **belum diuji**. Halaman seperti itu akan dilaporkan gagal, bukan ditebak.
- Efektivitas model asli dalam mematuhi aturan `<web_page>` (tidak mengikuti instruksi di halaman) **belum teruji**; yang teruji adalah isi prompt dan penetralan tag.
- Tidak ada penghormatan terhadap `robots.txt`; yang dibaca hanya tautan yang sengaja diketik pengguna.
- Konteks halaman hanya berlaku untuk pesan yang memuat tautan; pertanyaan lanjutan bergantung pada jawaban sebelumnya, bukan teks halamannya.
