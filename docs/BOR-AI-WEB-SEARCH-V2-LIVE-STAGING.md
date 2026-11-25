# Web Search V2 — bukti staging live

26 November 2026 WIB. Baseline `ab65eec`. Runner evaluasi `1393113`. Batas pengeluaran yang disetujui owner adalah USD 0.50 dari saldo yang sudah ada.

## Isolasi dan pengukuran

- Worker dan D1 target adalah `bor-ai-luna-staging`. Versi uji mewarisi binding key Luna dan token operator. Nilai secret tidak dibaca atau dicatat. Migrasi ledger 0017 dan tabel bukti dibuat hanya di D1 staging.
- Versi sementara `1242afa2-7d43-4dca-a561-ec466431bf18` memakai pemicu terjadwal untuk menjalankan satu evaluasi. Baris unik di D1 menolak eksekusi ganda dan konfigurasi uji kedaluwarsa. Tidak ada jalur HTTP baru untuk memicu pengeluaran.
- Router semantik dan adapter search berasal dari alur Web Search V2. Harness staging menggunakan Luna lewat Responses API untuk klasifikasi dua skenario berurutan, yaitu agensi perhotelan Jakarta untuk Timur Tengah dan follow-up khusus Saudi. Penilaian ini menguji backend dan konteks percakapan sintetis, sementara uji browser dengan mock tercatat di checkpoint.
- Setiap pencarian memakai maksimum dua tool call dalam satu permintaan. Per-request search dicadangkan USD 0.15. Runner berhenti saat router, provider, ledger, atau bukti pemakaian tidak memenuhi syarat. Telemetri menyimpan status, request ID provider, token input, token cached, token output, token reasoning dan jumlah tool call yang terlihat.
- 14 tes regresi relevan dan 2 tes evaluator baru lulus. Kedua tes baru membuktikan pemicu ganda tidak mengulang panggilan dan respons `insufficient_quota` menghentikan alur.
- Penyetoran, pembelian kredit, pengaktifan billing, deployment produksi, penghapusan Tavily dan eksekusi GitHub Actions tidak dilakukan.

## Pembanding manual untuk skenario prioritas

| Rujukan | Fakta yang dapat diperiksa |
| --- | --- |
| [PT Elshafah Adi Wiguna Mandiri](https://siskop2mi.bp2mi.go.id/profil/lembaga/detail/612/p3mi) | Registri menampilkan status Aktif, alamat Jakarta Timur dan kategori Hospitality Cleaner untuk Qatar. |
| [PT Diva Duta Indosa](https://siskop2mi.bp2mi.go.id/profil/lembaga/detail/601/p3mi) | Registri menampilkan status Aktif, alamat Cawang, Jakarta Timur, dan kategori Hotel Housekeeping Agent untuk Arab Saudi. |
| [PT Universal Recruitment Agency](https://siskop2mi.bp2mi.go.id/profil/lembaga/detail/568915/p3mi) | Registri menampilkan status Aktif, alamat Jakarta Selatan, dan kategori yang mencakup petugas kebersihan hotel di Saudi dengan kuota nol pada profil yang diperiksa. |
| [PT Sari Warti Agung](https://siskop2mi.bp2mi.go.id/profil/lembaga/detail/1050/p3mi) | Profil menyebut sanksi penghentian sementara bertanggal 1 Oktober 2026. Kemunculan kategori hotel tidak membuktikan kelayakan melamar melalui agensi tersebut. |
| [PT Penempatan Pemenang Asia](https://siskop2mi.bp2mi.go.id/profil/lembaga/detail/570689/p3mi) | Profil menunjukkan Aktif di Jakarta Pusat dan posisi F&B di Kuwait. Jenis pemberi kerja hotel secara spesifik memerlukan konfirmasi dokumen lowongan. |

Status agensi, rekap kuota, dan lowongan dengan tanggal buka/tutup adalah tiga bukti berbeda. Status lowongan yang menerima lamaran harus didukung detail lowongan spesifik.

## Persiapan Google

Kontrak REST sudah dicocokkan lagi dengan [dokumentasi Google Grounding](https://aistudio.google.com/docs/google-search). Adapter menggunakan Interactions v1beta, header `Api-Revision: 2026-05-20`, tool `google_search`, dan metadata sitasi serta saran pencarian resmi. Kandidat tetap `gemini-3.5-flash-lite`. Jumlah kueri yang terlihat pada respons dapat lebih rendah dari jumlah tertagih, sehingga uji Google harus memeriksa penggunaan di Cloud Billing. Key dan akses project Google masih diperlukan untuk smoke sesungguhnya.

## Hasil OpenAI dan pemulihan staging

| Panggilan staging | HTTP | Token yang dilaporkan | Web Search | Biaya terukur |
| --- | ---: | --- | ---: | --- |
| Router Luna untuk agensi kerja perhotelan Jakarta | 401 | Tidak ada metadata `usage` | 0 | USD 0.00 teramati |

Respons OpenAI pertama membawa ID permintaan `req_0e004328e013458e9df3995af5bbb94a`. Runner berhenti dengan `router_unverified`. Ledger search kosong, tanpa reservasi. Tidak ada respons model atau pencarian yang dapat dinilai. Saldo dan rincian tagihan project tidak diperiksa langsung. HTTP 401 menunjukkan OpenAI menolak autentikasi, dan belum membuktikan penyebab tepatnya. Rujuk [kode kesalahan OpenAI](https://developers.openai.com/api/docs/guides/error-codes).

Pemicu sementara dilepas serta versi sebelumnya `48c3e307-4c25-47b5-a164-5f2e222ed12e` dikembalikan ke 100% trafik staging. Deployment pemulihan adalah `7f140d7c-d497-4097-bc6a-379dfb13e4f1` dengan 0 jadwal aktif. Bukti dan ledger tetap ada pada D1 staging untuk audit. [Bukti terstruktur](evidence/web-search-v2-jakarta-20261126.json).

Langkah owner adalah memastikan project OpenAI untuk staging memiliki key yang masih berlaku, akses Responses dan GPT-6 Luna, serta saldo yang sudah tersedia. Perbarui binding `BOR_TEXT_BACKUP_API_KEY` di Worker staging jika key lama tidak berlaku. Kualitas jawaban, kesegaran dari API dan validitas sitasi model tetap tertunda sampai panggilan lolos autentikasi. Persetujuan anggaran US$0.50 yang sudah diberikan masih berlaku untuk validasi tersebut.
