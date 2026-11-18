# BOR AI — audit keamanan, kredit, pemulihan dan checklist peluncuran

Tanggal: 18 November 2026 (WIB). Branch: `feat/plan-tier-server-gates-20261117`,
Draft PR #264. Baseline yang diperiksa: `f19041ea4c5acc1e0b54d4be8933e0c1e49214f6`.
Laporan ini disimpan bersama perbaikan; gunakan SHA commit yang memuatnya untuk
verifikasi CI. **Keputusan saat penyusunan: NO-GO untuk peluncuran berbayar penuh.**
Ini audit rekayasa kode dan pengujian sintetis, bukan sertifikasi independen,
pentest produksi, bukti invoice, atau persetujuan komersial.

## 1. Temuan dan tindakan

| Area | Temuan aktual | Tindakan / bukti |
| --- | --- | --- |
| Tagihan teks | Respons error/terpotong dengan token terukur dapat melewati settlement Stage 3 | Diperbaiki di `src/stage3-journaled-inference.js`: error eksplisit, finish reason selain `stop`, teks kosong/nonteks/terlalu besar/kontrol dan alias bertentangan ditolak sebelum settlement. Bukti penggunaan tetap dijurnal; kedua reservasi ditahan untuk review. Tidak otomatis refund atau retry. |
| Perubahan respons saat await | Referensi respons provider dapat berubah ketika penulisan jurnal berjalan | Salin dan bekukan teks/usage sebelum await. Pengujian mengubah objek asal saat jurnal ditulis dan membuktikan tagihan/hasil tetap memakai snapshot yang sama. |
| Egress #156 | `response.json()` membaca envelope proxy tanpa batas sebelum pengecekan base64 | Diperbaiki di `src/verified-egress.js`: maksimum envelope 1.500.000 byte secara streaming sebelum parsing, validasi UTF-8, pembatalan, deadline baca 10 detik, pembatalan body saat gagal, tanpa fallback fetch langsung. Batas isi hasil tetap 1.000.000 byte. Ini perlindungan respons, bukan bukti DNS pinning hosted. |
| Inventori Gateway | Halaman pertama tanpa metadata tidak boleh dianggap inventori lengkap | Membawa perubahan yang sama dengan Draft #267 (`33cfd87`, `fccca8b`, `59aea01`): seluruh halaman sampai total halaman/halaman kosong, batas pagination gagal tertutup, hasil agregat tanpa nama/ID kebijakan. Tidak memanggil API Cloudflare atau mengubah policy. |
| Akses akun | Sesi di-hash dan dibatasi expiry; riwayat/memori memakai `user_id`; mutasi memeriksa origin | Diperiksa di `src/index.js`, `src/memory.js`, `src/widget-api.js`, `src/plan-entitlements.js`, dan tes terkait. Tes API key/origin/ownership, entitlement refund/revocation, dan media lintas akun disertakan dalam regresi. Tidak ada klaim pentest produksi. |
| Identitas operator | Verifier Ed25519, role finance/security, expiry dan nonce ledger tersedia secara draft | Tetap internal dan tidak memberi otoritas debit/refund. Enrollment identitas nyata, akses layanan, distribusi revocation dan bukti hosted masih harus diverifikasi. Tidak ada endpoint publik recovery baru. |
| Perlindungan data | Cascade SQLite sintetis memisahkan akun dan riwayat; log error disanitasi | `tests/privacy-d1-cascade.test.py` menguji 4 kasus. Pesan asli dapat menyimpan URL/rahasia yang diketik pengguna; penghapusan live tidak membuktikan backup/provider ikut terhapus. Retensi, backup, lokasi data dan tinjauan independen tetap terbuka. |

**#156 belum dapat ditutup.** Bukti private-path positif 13 November tercatat di
`docs/security/private-egress-runtime-evidence-2026-11-13.md`. Bukti tersebut
bukan matriks negatif hosted lengkap. Mixed DNS, rebinding/CNAME, redirect,
sertifikat salah/expired, origin IPv6, stabilitas connector dan review
privasi/retensi independen tetap perlu bukti lingkungan yang sah.
`URL_READER_ENABLED=false` tetap dipertahankan. Pekerjaan ini tidak menerapkan
migrasi remote, mengubah kredensial atau mengaktifkan fitur produksi.

## 2. Kebijakan harga dan batas risiko

Harga USD yang disetujui tetap Basic **$1.99/bulan** dan Pro **$6.99/bulan**.
Definisi kredit kandidat tetap 1 kredit BOR = $0.0001 plafon biaya provider;
ini bukan satu token. Alokasi kandidat Basic 3.000 kredit ($0.30) dan Pro
15.000 kredit ($1.50) **belum merupakan manfaat kontraktual yang aktif**.
Multi-agent, semua percobaan model, Search/Extract, moderasi, konversi dan
media harus masuk biaya; tidak ada asumsi panggilan gagal/retry pasti gratis.

Sumber resmi dicek kembali saat pekerjaan ini dilakukan:

- Cloudflare Llama 3.3 70B FP8 Fast: $0.293/juta token input dan $2.253/juta output:
  https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/
- Tavily PAYG: $0.008/kredit API. Search basic/advanced masing-masing 1/2 kredit;
  jangan menyamakan semua endpoint Extract/Crawl dengan Search:
  https://www.tavily.com/pricing dan
  https://help.tavily.com/articles/8298987937-billing-credits-usage-limits
- Midtrans mengiklankan VA Rp4.000, QRIS 0,7%, GoPay 2%; klasifikasi produk
  digital, pajak dan kontrak merchant bisa berbeda:
  https://midtrans.com/id/biaya dan
  https://docs.midtrans.com/docs/what-is-the-applicable-transaction-fee-for-qris

Tarif publik bukan bukti invoice atau kontrak BOR AI. Tidak ada nilai pajak
atau kurs pasar terkini yang disimpulkan dari contoh di bawah.

### Pemeriksaan solvabilitas baru

`evaluation/bor-ai-plan-solvency.js` menilai seluruh pendapatan/biaya dalam
integer mikro-USD. Setiap biaya wajib diisi; input hilang ditolak. Model
memasukkan biaya gateway IDR setelah pajak pada kurs checkout terkunci,
pajak pendapatan bila berlaku, kebocoran FX, cadangan refund, biaya variabel,
alokasi biaya tetap, subsidi Free, 100% kredit baru + rollover + top-up lama,
serta stres biaya provider. Pembulatan biaya selalu ke atas.

Skenario **hipotetis**, bukan biaya akun aktual: kurs 18.260 IDR/USD, VA
Rp4.000 + stres pajak fee 12%, FX 2%, cadangan refund 5%, pajak pendapatan
0% hanya parameter contoh, biaya variabel $0.10/akun, biaya tetap $20/bulan,
subsidi Free $5/bulan, konsumsi kredit 100%, biaya provider **2x**, target
sisa setelah semua biaya skenario 30%. Tanpa rollover/top-up lama.

| Kohor homogen | Akun membayar | Sisa USD per akun setelah seluruh biaya skenario | Lulus target 30%? |
| --- | ---: | ---: | --- |
| Basic | 1 | -$24.094646 | Tidak |
| Basic | 10 | -$1.594646 | Tidak |
| Basic | 100 | $0.655354 | Ya, hanya asumsi ini |
| Basic | 1.000 | $0.880354 | Ya, hanya asumsi ini |
| Pro | 1 | -$21.844646 | Tidak |
| Pro | 10 | $0.655354 | Tidak; positif tetapi di bawah target |
| Pro | 100 | $2.905354 | Ya, hanya asumsi ini |
| Pro | 1.000 | $3.130354 | Ya, hanya asumsi ini |

Titik impas skenario kohor homogen: 28 Basic atau 8 Pro. Ini bukan proyeksi
pelanggan nyata atau titik impas campuran; biaya yang belum diinventarisasi
tidak ditanggung otomatis oleh angka ini. Tidak ada jaminan bebas margin
negatif dari harga jual saja. Jumlah pelanggan rendah, fee tinggi, perubahan
kurs/biaya, Free tanpa batas atau kewajiban kredit lama dapat membuat rugi.

**Rollover tetap OFF untuk keduanya.** Pada contoh 100 akun, ruang matematis
Basic hanya 291 kredit tambahan setelah 3.000 kredit baru; 292 gagal target.
Pro memiliki ruang 4.041 kredit, tetapi ini bukan persetujuan rollover.
Top-up lama mengurangi ruang yang sama; tidak boleh menganggap kewajibannya
nol karena uang diterima pada bulan lalu. Hasil model selalu
`canActivateBilling:false` dan `rolloverEnabled:false`.

Top-up belum dijual. Harga dan minimum top-up harus lolos per metode bayar,
termasuk fee tetap bank; gunakan tes Rp5.000 yang sudah menunjukkan kerugian
di `tests/bor-ai-margin-stress.test.js`. Versikan tarif dan tentukan expiry,
lot kredit, batas hold, refund serta perubahan harga sebelum membuat janji
ke pelanggan. Langganan habis bukan izin menghapus kredit yang masih ditahan.

## 3. Matriks kegagalan dan pemulihan

| Gangguan | Perilaku yang diwajibkan / diuji | Bukti lokal |
| --- | --- | --- |
| DB/jurnal tidak tersedia sebelum dispatch | Tidak memanggil AI; gagal tertutup. Jika write ambigu, hold tidak otomatis dilepas | `stage3-real-d1-journal-integration.test.js`, tes ledger/budget |
| Crash antar langkah finansial | Orphan budget, dual hold, dispatch tanpa outcome, measured sebelum settle, provider-settled/wallet-held, urutan wallet-first terdeteksi | `stage3-crash-recovery-matrix.test.js` |
| SQLite ditutup/dibuka | State finansial dan kontrol OFF tersimpan, tidak menghitung ulang sebagai transaksi baru | `stage3-disk-restart-recovery.test.js` |
| Runtime dihentikan dan dibuat ulang | D1 persisten tetap menyimpan hold, unknown usage, replay dan OFF | `tests/billing/stage3-workerd-restart-smoke.mjs` |
| Dua Worker bersamaan | Reservasi atomik menolak pembelanjaan berlebih, request duplikat hanya satu dispatch/debit, OFF berlaku bersama | `tests/billing/stage3-two-worker-shared-d1-smoke.mjs` |
| AI timeout/tidak kooperatif/late success | Deadline; unknown outcome ditahan. Respons terlambat tidak settle/deliver; retry tidak dispatch lagi | `stage3-journaled-inference.test.js`, staging smoke |
| Provider error/truncated/filtered dengan usage | Tetap jurnal exposure, tidak settlement/delivery, kedua hold tetap, duplikat ditolak | Regresi SQL baru di `stage3-real-d1-journal-integration.test.js` |
| Refund/chargeback atau OFF saat proses | Recheck entitlement dan shared D1; hentikan hasil, jangan membatalkan bookkeeping yang sudah commit | `plan-entitlements.test.js`, staging smoke |
| Private egress terlalu besar/macete/UTF-8 rusak | Hentikan pembacaan sebelum parsing/hasil, tidak fetch langsung | Regresi baru `verified-egress.test.js` |

Semua model/payment pada tes di atas sintetis. Workerd/D1 yang diuji lokal
nyata, tetapi **bukan** bukti remote Cloudflare lintas region, invoice asli,
SSO operator atau pemulihan hasil media tersimpan. Pemulihan hold tetap
memerlukan statement dan proses operator yang terpisah; tidak auto-debit,
refund atau release berdasarkan timeout. Runbook:
`docs/STAGE-3-OPERATOR-RECOVERY-RUNBOOK.md`.

## 4. Checklist setelah keputusan Tavily dan Midtrans

Setiap baris wajib punya SHA, lingkungan, tanggal, penanggung jawab dan tautan
bukti; status vendor disetujui saja tidak menandai baris teknis sebagai lulus.

| Verifikasi | Kriteria lulus / keputusan jika tidak lulus |
| --- | --- |
| Keputusan Tavily | Simpan jawaban resmi mengenai endpoint yang diizinkan, SSRF/DNS/redirect, privasi/retensi, billing gagal/timeout dan batas akun. Jika ditolak/tidak jelas, Search/Extract terkait tetap OFF; jangan retry berbayar otomatis atau menjanjikannya dalam paket. |
| Biaya Tavily nyata | Data sintetis, budget kecil yang ditentukan sebelum eksperimen, kredit per endpoint tercatat dan cocok usage dashboard/statement; tidak menganggap free tier subsidi permanen. |
| Keputusan Midtrans | Merchant, kategori digital/subscription, metode bayar, fee/pajak, refund/chargeback dan settlement dikonfirmasi tertulis. Jika ditolak, checkout tetap OFF; jangan memberi entitlement paid dari frontend/manual status tanpa bukti. |
| Webhook Midtrans | Signature dan Status API server-to-server cocok order, merchant, mata uang/amount, dan status. Uji invalid signature, replay, out-of-order, duplicate settlement, pending/expired/deny/cancel/refund/chargeback. Satu pembayaran memberikan satu grant; tidak ada kredit dobel. |
| FX checkout | Harga USD -> total IDR terkunci server, expiry quote dan pembulatan jelas, fee tercatat. Nilai historis tidak dihitung ulang memakai kurs baru; browser tidak dapat mengubah harga/tier/kredit. |
| Invoice seluruh API | Verifikasi source statement dan lineage attempt atau alokasi agregat yang disetujui, semua retry/multi-agent/tools/media/konversi tercakup. Aggregate match saja tidak men-debit pelanggan atau melepas hold. |
| Margin | Masukkan biaya akun aktual, pajak, Free, overhead, kasus 1/10/100/1.000 pelanggan, semua metode bayar dan 100% redemption. Plafon kredit/top-up/rollover diputuskan ulang jika gagal; rollover default OFF. |
| Kontrol akses | Staging autentikasi nyata; expired/revoked session/key, salah origin, lintas akun, webhook palsu dan pemalsuan tier/amount gagal. Operator minimal privilege, enrollment/rotasi/revocation, finance/security berbeda dan nonce persisten diverifikasi. |
| Staging D1 | DB disposable baru dengan identitas yang ditinjau, migrasi exact SHA, multi-instance, restart/putus koneksi, quota/cap, timeout, duplicate dan OFF diuji. Bukti lokal tidak menggantikan bukti hosted. |
| Pemulihan & pelanggan | Inventori hold, drill invoice-backed operator, hasil tidak terkirim, status akun ketika eksekusi OFF, audit immutable, eskalasi dan kontak bantuan tersedia; jangan retry request ambigu. |
| Keamanan #156 | Lengkapi matriks negatif hosted dan review independen. Selama belum lulus, URL Reader tetap OFF; setiap rilis dengan fitur itu dikeluarkan dari cakupan harus ditinjau eksplisit. |
| Privasi & backup | Tetapkan retensi chat/memori/citation/log/provider/artifact/backup, verifikasi deletion/export/restore dan akses backup, disclosure lokasi/subprocessor; peninjau independen menyetujui. |
| Media | Fitur tetap OFF sampai semantic moderation, usage/invoice, licensing, runtime adapter, delivery/recovery dan retention lolos. Lulus codec PNG tidak mengesahkan konten. |
| Deploy & rollback | Full CI pada SHA final hijau, migrasi/rollback diuji staging, flag dan monitoring biaya/error/hold diverifikasi, batas cohort/rate/provider/global ditetapkan, owner merekam keputusan GO sebelum produksi. |

Dokumen pendukung: `STAGE-3-HOSTED-D1-ACCEPTANCE.md`,
`STAGE-3-SECURITY-FINANCE-AUDIT-20261118.md`,
`security/issue-156-production-release-gates.md` dan
`BOR-AI-COST-ENTRYPOINT-INVENTORY.md`.

## 5. Verifikasi pekerjaan ini

- Baseline lokal: 983 lulus / 0 gagal / 1 skip.
- Regresi final termasuk perbaikan Gateway #267: 1.006 lulus / 0 gagal /
  1 skip (fixture DNS eksternal opt-in). Sebelumnya 117 tes terarah lulus.
  Cek hasil CI pada SHA commit laporan ini sebelum menyatakan seluruh CI hijau.
- Empat tes cascade privasi SQLite lulus.
- Integrated staging Workerd, restart dua kali dan dua Worker/D1 bersama
  masing-masing PASS dengan AI/payment sintetis dan nol panggilan provider.
- Syntax dan dry-run bundle lulus; tidak deployment.
- Proof PNG via Wrangler lokal tidak dapat dimulai di host ini karena
  `uv_interface_addresses`; tidak diklaim lulus lokal. Browser Chromium lokal
  mengalami unduhan rusak; CI GitHub pada SHA final harus memverifikasi PNG
  dan browser sebelum klaim hijau lengkap. Unduhan Chromium kemudian berhasil
  melalui fallback mirror; pengujian browser lokal dijalankan terpisah.

**Belum selesai secara eksternal:** persetujuan vendor, kontrak fee/invoice,
hosted staging exact SHA, identitas operator nyata, tinjauan keamanan/privasi/
finance independen dan keputusan rilis. Tidak ada merge ke main, deploy
produksi, migrasi remote, panggilan AI berbayar atau pergerakan dana dari
pekerjaan ini.
