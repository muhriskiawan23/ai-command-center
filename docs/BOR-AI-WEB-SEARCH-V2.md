# BOR AI Web Search V2

26 November 2026 WIB. Kandidat lokal untuk BOR AI pada branch `feature/web-search-v2`. Baseline GitHub `06832f3f`. Implementasi yang diuji dipublikasikan sebagai `0d65be14`, dengan Git tree `7a00827abd461c6060bf40edad441d6a4a98b667`.

## Audit awal

- Jalur pencarian lama memakai keputusan berbasis pola dari `detectResearchMode`. Pertanyaan yang terlewat masih bisa memperoleh jawaban dari basis pengetahuan terkurasi, tetapi jalur itu tidak membuktikan ketersediaan agensi atau lowongan saat ini.
- Tavily dan Brave adalah adapter cuplikan pada jalur lama. Pembacaan URL memakai jalur terpisah dengan kontrol sendiri. Baseline terbaru menolak Tavily Extract jika flag pembaca atau provider tidak cocok.
- Pada pemeriksaan metadata Cloudflare, deployment `2fe985c2-356d-457c-b829-268cfb38df4c` mengarahkan 100% trafik Worker `ai-command-center` ke versi `c6dcf354-46c3-4772-9521-55f97cb2fb78`. Versi tersebut mengaktifkan Tavily Search, batas percobaan bersama, Tavily Extract, dan Luna sebagai model teks utama.
- Versi aktif memiliki secret Tavily, kredensial Luna teks, dan token egress. Binding layanan `EGRESS_PROXY` serta kedua secret pencarian V2 tidak ada pada versi aktif. Ini pemeriksaan konfigurasi, tanpa permintaan chat atau panggilan berbayar.

## Status pekerjaan

| No. | Pekerjaan | Status |
| --- | --- | --- |
| 1 | Audit pencarian | Kode baseline dan metadata Worker aktif diperiksa. |
| 2 | Branch | `feature/web-search-v2` dibuat dari tip `main`. |
| 3 | Migrasi provider | OpenAI Responses Web Search dan Google Gemini Interactions Google Search terpasang di V2 dan diuji dengan mock. Cutover tertunda. |
| 4 | Luna | GPT-6 Luna menjadi default OpenAI Search. Jalur Luna utama untuk chat reguler dipertahankan. |
| 5 | Intelligent Search Router | Klasifikasi semantik dan kueri publik mandiri dengan konteks paling banyak dua pesan pengguna sebelumnya. |
| 6 | Pencarian otomatis | Terpasang untuk chat coordinator yang memenuhi syarat. Chat dengan lampiran, URL langsung, atau alat GitHub tetap memakai jalurnya sendiri. |
| 7 | Multi-query, pencarian lanjutan, failover, verifikasi lintas sumber | Hingga dua sudut kueri tambahan dan tiga panggilan tool per Responses request. Pencarian lanjutan dibatasi satu request OpenAI. Konfirmasi lintas sumber diukur dari sitasi pada rentang klaim yang sama dari domain berbeda. Google dipakai saat OpenAI gagal memberi hasil yang bisa dikutip dan akun memenuhi syarat. |
| 8 | Optimasi kategori | Instruksi pencarian khusus lokal, perusahaan, agensi, lowongan, berita, produk dan harga, teknologi, politik, kesehatan, pendidikan serta informasi umum. |
| 9 | Pembacaan sumber | Pencarian memakai pembacaan yang dikelola provider. URL langsung pada V2 memakai reader egress terverifikasi yang sudah ada. Binding dan uji egress staging masih diperlukan untuk menggantikan Tavily Extract. |
| 10 | Sitasi | Tautan inline dan daftar sumber OpenAI. Google tampil dengan sitasi dan saran pencarian asli dalam iframe terisolasi. |
| 11 | Indikator UI | Status provider muncul ketika panggilan dimulai lewat stream opsional. Klien JSON lama tetap kompatibel. |
| 12 | Batas dan kill switch | Output maksimum 1.200 token per request provider, batas ukuran input dan respons, timeout, kuota harian, serta reservasi biaya harian dan bulanan atomik di D1. |
| 13 | Pengamanan | Review kode dan uji lokal meliputi data sensitif, sumber palsu, URL privat, markup Google berbahaya, kegagalan provider dan konkurensi kuota. Uji egress hosted dan adversarial provider live tertunda. |
| 14 | Kepatuhan provider | Ketentuan tampilan dan penanganan data ditinjau. Persetujuan kelayakan Google serta verifikasi widget dan pengaturan data pada project provider aktual tertunda. |
| 15 | Unit, integrasi, regresi, E2E dan audit | Lulus lokal. Rincian bukti di bawah. |
| 16 | Kualitas lintas kategori dan bahasa | Enam skenario wajib lulus dengan fixture sintetis dalam bahasa Indonesia, Inggris, Prancis dan Spanyol. Kualitas, fakta dan kesegaran dari API live belum diverifikasi. |
| 17 | Kandidat, backup dan rollback | Build lokal, uji restore SQLite dengan ledger V2, pemeriksaan read-only D1 Time Travel, versi rollback Worker, dan prosedur cutover tersedia. Ambil ulang bookmark saat jendela rilis. |
| 18 | Penghapusan Tavily | Ditunda hingga hasil live lulus dan owner menyetujui cutover. Search dan Extract Tavily masih dipakai versi aktif. |
| 19 | Dokumentasi | Bukti, konfigurasi, dan prosedur rilis dicatat di dokumen ini. |

## Bukti lokal

| Pemeriksaan | Hasil |
| --- | --- |
| `npm test` dengan Node 24.22.3 | 1.128 lulus, 0 gagal, 1 dilewati. |
| `node --test tests/web-search-v2.test.js` | 11 lulus, termasuk keenam skenario wajib. SQLite memakai migrasi repo yang asli. |
| `npm run test:e2e -- --project=phone-360x800 --project=desktop-1280x800` | 220 lulus, 0 gagal, 6 dilewati oleh kondisi suite. Keenam kasus browser V2 lulus pada dua viewport. |
| `wrangler deploy --dry-run --outdir ../web-search-v2-worker --config wrangler.jsonc` | Wrangler 4.160.0 membundel 38 aset. SHA-256 Worker lokal `ed9d61058283f89393fdcbae8e5b42c02d06fe8182ff9f319eb006b01f24616e`. |
| Backup/restore sintetis | Suite restore 14 migrasi lulus, termasuk baris kuota dan biaya V2. Pemeriksaan Time Travel D1 melalui GET mengonfirmasi ketersediaan restore point pada 26 November WIB. |

Keenam skenario memeriksa jalur Worker, keputusan router dari stub model, kueri keluar yang terfokus, respons bersitasi, dan pemisahan konteks privat. Nama agensi, lowongan, produk, berita, dan perusahaan di fixture adalah data sintetis. Pemilihan situs resmi, kecocokan klaim dengan halaman, kesegaran, dan akurasi fakta masih memerlukan perbandingan manual terhadap sumber live. Browser V2 menjalankan Worker dan UI asli dengan mock provider. Browser offline melaporkan CDN eksternal yang tidak terbuka, tanpa menyebabkan kegagalan suite yang dijalankan.

## Konfigurasi dan batasan

| Nama | Penggunaan |
| --- | --- |
| `BOR_WEB_SEARCH_MODE` | `legacy` adalah default rilis kode. `v2` memakai provider baru. `off` mematikan pencarian. |
| `BOR_WEB_SEARCH_KILL_SWITCH` | `true` segera menonaktifkan jalur pencarian ketika versi konfigurasi itu aktif. |
| `BOR_WEB_SEARCH_OPENAI_KEY` | Secret project OpenAI untuk pencarian. `BOR_WEB_SEARCH_OPENAI_MODEL` opsional, dengan default `gpt-6-luna`. |
| `BOR_WEB_SEARCH_GOOGLE_KEY` dan `BOR_WEB_SEARCH_GOOGLE_MODEL` | Secret dan model Gemini yang mendukung Grounding pada Interactions API. |
| `BOR_WEB_SEARCH_GOOGLE_ELIGIBILITY_APPROVED` dan `BOR_WEB_SEARCH_GOOGLE_ALLOWED_USER_IDS` | Persetujuan owner untuk penggunaan yang memenuhi syarat dan daftar ID akun BOR AI yang dipisah koma. Google hanya tampil di chat web same-origin dengan sesi yang cocok. |
| `BOR_WEB_SEARCH_DAILY_CALLS` | Jumlah request provider global per hari UTC, termasuk percobaan lanjutan, kegagalan dan failover. |
| `BOR_WEB_SEARCH_DAILY_MICRO_USD`, `BOR_WEB_SEARCH_MONTHLY_MICRO_USD` | Plafon reservasi global per hari dan bulan UTC. 1 USD = 1.000.000 mikro-USD. |
| `BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD`, `BOR_WEB_SEARCH_GOOGLE_CALL_MICRO_USD` | Reservasi konservatif per request provider dengan tarif sesuai model, jumlah tool call atau kueri, serta biaya input/output. Invalid, nol, atau kosong membuat provider tidak dapat dipakai. |
| `URL_READER_ENABLED`, `EGRESS_PROXY`, `EGRESS_PROXY_TOKEN` | URL publik yang dikirim langsung pengguna memerlukan binding egress terverifikasi saat V2 aktif. Penggunaan jalur ini terpisah dari pencarian. |

D1 menyimpan tanggal, jumlah request, dan biaya yang dicadangkan. Jumlah yang dicadangkan tetap dihitung pada timeout atau error. Plafon ini membatasi reservasi aplikasi. Untuk membatasi tagihan provider, rekonsiliasi tarif aktual, tetapkan batas project jika tersedia, dan uji perbedaan biaya yang dilaporkan sebelum melepas trafik. Google Gemini generasi baru dapat mengenakan biaya per kueri internal dan jumlah kueri terlihat belum tentu mencakup seluruh kueri tertagih. Kuota routing model teks mengikuti kontrol inferensi yang sudah ada.

Hanya kueri publik yang lolos penyaringan yang dikirim ke search API. Lampiran, sesi, memori dan balasan asisten sebelumnya tidak disertakan. Provider diberi instruksi untuk mengabaikan instruksi dalam sumber. Backend tidak mengambil URL hasil pencarian secara langsung. Untuk OpenAI, hanya metadata sitasi native yang menjadi tautan sumber dan hasil tanpa sitasi tidak ditampilkan sebagai jawaban berbasis web. Jumlah publisher dan kecocokan rentang sitasi adalah heuristik. Independensi kepemilikan publisher dan kebenaran setiap klaim perlu diperiksa. Sesuai kebijakan riwayat BOR AI, query string serta fragmen tautan sumber dihapus saat penyimpanan riwayat.

Hasil Google tampil bersama saran asli dan disimpan sementara pada giliran di browser. Riwayat hanya menyimpan pesan status. Tidak ada pemrosesan ulang keluaran Google oleh Luna atau perpindahan hasil ke provider lain. Sebelum mengaktifkan Google, tinjau kelayakan pengguna, wilayah, usia, penanganan data, serta markup asli yang dikembalikan project tersebut. Penggunaan Google Search Grounding melalui Gemini API tunduk pada ketentuan layanan berbayar Google.

## Rilis dan rollback

1. Cocokkan branch dengan `main` terbaru, Worker yang aktif, dan D1 `bor-ai-chat`. Versi aktif memiliki konfigurasi yang berbeda dari default di repo, termasuk URL Reader aktif dan Luna utama. Pertahankan binding dan flag aktif yang relevan sebelum membangun versi uji.
2. Dengan izin kredensial dan anggaran, uji di Worker serta D1 staging terpisah. Terapkan migrasi `0017_web_search_v2_usage.sql` di sana. Verifikasi binding egress dengan jalur positif dan negatif, periksa widget Google yang dikembalikan API, uji kill switch, dan ulangi enam skenario dengan sumber terkini. Cocokkan hasil, bahasa, ID entitas, lokasi, tanggal, status ketersediaan, bukti situs resmi, latensi, tagihan dan perilaku saat provider gagal.
3. Sebelum perubahan produksi yang disetujui, catat versi Worker dan pembagian trafik saat itu, ambil bookmark D1 Time Travel tepat sebelum migrasi, dan simpan bukti sesuai prosedur backup privat. Bookmark hasil pemeriksaan sesi ini hanya membuktikan akses dan ketersediaan, karena dapat kedaluwarsa. Backup fisik D1 produksi dan restore produksi belum dijalankan.
4. Terapkan migrasi aditif pada D1 chat yang benar. Siapkan versi dengan V2 dalam kondisi nonaktif, validasi fungsi chat, lalu aktifkan V2 setelah persetujuan deployment. Pantau kuota, biaya, kegagalan per provider, kualitas sitasi, dan URL Reader. Jangan hapus Tavily selama periode rollback.
5. Bila pencarian perlu dihentikan, aktifkan kill switch di konfigurasi Worker. Bila layanan lama diperlukan, set `BOR_WEB_SEARCH_MODE=legacy` dengan kill switch nonaktif atau rollback ke versi sebelumnya yang sudah diverifikasi. Rollback Worker tidak mengembalikan state D1, dan tabel aditif ini dapat dibiarkan. Restore D1 hanya untuk insiden data dengan persetujuan terpisah karena dapat menghilangkan perubahan setelah bookmark.
6. Setelah cutover dan masa rollback disetujui selesai, hapus penggunaan Tavily Search dan Extract dari kode, konfigurasi deployment, dan secret secara terpisah. Validasi versi aktif sesudahnya.

Referensi resmi: [OpenAI Web Search](https://developers.openai.com/api/docs/guides/tools-web-search), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Google Search Grounding](https://ai.google.dev/gemini-api/docs/google-search), [Gemini API Terms](https://ai.google.dev/gemini-api/terms#grounding-with-google-search), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
