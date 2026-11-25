# BOR AI Web Search V2 — live staging setelah izin Responses

26 November 2026 WIB. Baseline [8c98f21](https://github.com/muhriskiawan23/ai-command-center/commit/8c98f2166e7e5593579a8b8777244f267114f626). Batas pengujian US$0.50 dari saldo API yang tersedia.

- Dashboard menyimpan perubahan Responses ke Write pada `BOR AI Staging - Luna Test`. Verifikasi pascasimpan menunjukkan `api.responses.write` dan `api.responses.read` sebagaimana UI mengimplementasikan pilihan Write pada endpoint tersebut. Scope Chat Completions tetap `api.model.chat_completions.request`. Tidak ada perubahan scope API lain.
- Secret default Worker staging gagal di Responses dan pembandingan akhiran membuktikan bahwa ia berbeda dari key yang diedit. Cloudflare mewariskan secret dari versi terdahulu Worker staging langsung ke versi uji, tanpa mengekstrak nilainya. Pembandingan akhiran lulus di runtime. Header organisasi dan project mengarahkan panggilan ke BOR AI Staging. [Cloudflare versi dan inheritance](https://developers.cloudflare.com/api/go/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/create/) · [OpenAI API authentication](https://developers.openai.com/api/reference/overview)
- Enam classifier dan enam permintaan Responses Web Search pada putaran utama menerima HTTP 200. Model yang diminta adalah `gpt-6-luna`. Keenam hasil mempunyai sitasi provider. Biaya terukur awal US$0.142777, dihitung dari metadata penggunaan OpenAI pada tarif Standard. Pembukuan akhir provider tidak diperiksa.
- Skenario yang lulus tidak dipanggil ulang. Putaran ulang yang terarah membaca biaya kumulatif dari baris evaluasi sebelumnya sebelum mengirim permintaan baru.

## Penilaian manual

| Skenario | Hasil dan bukti |
| --- | --- |
| Agensi hotel Timur Tengah di Jakarta | Lulus. SISKOP2MI mengonfirmasi Timuraya Jaya Lestari aktif di Jakarta Timur dan mencatat kategori Barback Qatar serta Barista Saudi. Jawaban membedakan rekap kuota dari lowongan yang menerima lamaran. Situs ABP mengonfirmasi spesialisasi hospitality, dan pemeriksaan manual menemukan profil P3MI ABP yang mencantumkan alamat Jakarta Selatan. [Timuraya](https://siskop2mi.bp2mi.go.id/profil/lembaga/detail/697/p3mi) · [ABP](https://siskop2mi.bp2mi.go.id/profil/lembaga/detail/573171/p3mi) |
| Lowongan perhotelan Qatar | Lulus. Portal resmi mencantumkan posisi yang relevan. Halaman IHG untuk Commi 1 menunjukkan identitas lowongan, lokasi Doha, dan tautan Apply. Hasil tidak menjanjikan bahwa kuota agregat dan tenggat tetap. [IHG](https://careers.ihg.com/en/job-details/?jobref=PR) · [Marriott](https://careers.marriott.com/jobs?location_name=Qatar&location_type=4) |
| Dua ponsel Android maksimal Rp3 juta | Lulus. Xiaomi mencantumkan REDMI 17 4/128 GB Rp2.899.000, Samsung mengonfirmasi harga resmi Galaxy A07s 4/64 GB Rp2.699.000. Stok pengiriman tetap bergantung pada checkout. [Xiaomi](https://www.mi.co.id/id/product-list/phone/?productIds=22265%2C22863%2C19954%2C19917%2C23117%2C23346%2C22260%2C23115%2C19705) · [Samsung](https://news.samsung.com/id/samsung-galaxy-a07s-smartphone-samsung-paling-terjangkau-dengan-performa-responsif-dan-update-hingga-6-tahun) |
| Berita internasional terbaru | Lulus. Tanggal kejadian dipisahkan dari tanggal terbit. Klaim utama tentang Sudan, banjir tambang di Bogor, dan pembebasan sandera Cartagena diverifikasi pada Reuters/AP. [Reuters](https://www.reuters.com/world/africa/drone-strikes-kill-19-civilians-southeastern-sudan-says-rights-group-2026-11-25/) · [AP Bogor](https://apnews.com/article/f2dd241835ed9a3c2832a5b56fe00c89) · [AP Cartagena](https://apnews.com/article/c6b9c0ca799ff611148fc87d4b323628) |
| Kantor pusat Qatar Airways | Lulus. Kebijakan resmi menyebut tempat usaha utama di Tower 1, Airport Road, Doha dan PO Box 22550. Jawaban membedakan kantor dari terminal bandara. [Qatar Airways](https://www.qatarairways.com/en-cy/legal/cookie-policy.html) |

## Koreksi follow-up Doha

Putaran awal menyertakan Lusail. Ulangan pertama mengecualikan Lusail tetapi keliru menerima Al Samriya dari label kota pada portal karier, sementara Visit Qatar dan halaman properti Marriott menempatkannya di Shahaniya, di luar Doha. Ulangan kedua mempertahankan frasa `di Doha saja` secara eksplisit dalam payload, tetapi masih mengikuti label portal Hilton untuk properti bernama Waldorf Astoria Doha Lusail. Ketiga keluaran itu tidak diterima. Perbaikan terakhir meminta satu contoh yang bisa ditelusuri ke halaman lowongan individu dan lokasi fisik resmi, dan mewajibkan pengecualian saat label portal karier bertentangan dengan lokasi properti. [Visit Qatar: Al Samriya](https://visitqatar.com/intl-en/plan-your-trip/accommodation/al-samriya-hotel-doha-autograph-collection)

Tes lokal yang dijalankan terbatas pada regresi baru yang relevan, yaitu key yang salah ditolak sebelum API, ulangan menghitung ulang anggaran dari catatan yang selesai, dan batas kota tetap dikirim ketika router tidak menyalinnya.

Ulangan terakhir lulus pemeriksaan inti. Frasa `di Doha saja` masuk dalam payload. Jawaban hanya menampilkan properti di Doha, dengan posisi yang dapat dicocokkan pada portal Marriott. Pemeriksaan manual mengonfirmasi Captain dan Demi Chef de Partie di Sheraton Grand Doha, Guest Experience Expert di Marriott Marquis City Center Doha, serta Demi Chef de Partie - Butcher dan Front Desk Agent di The St. Regis Doha. Model tetap memberikan lima posisi dan menautkan halaman daftar, meskipun instruksi tambahan meminta satu contoh dengan tautan langsung. Ini keterbatasan kepatuhan format yang tersisa. [Sheraton](https://careers.marriott.com/jobs?filter%5Bbrand%5D%5B0%5D=Sheraton&filter%5Bcountry%5D%5B0%5D=Qatar&page_number=1) · [Daftar utama](https://careers.marriott.com/jobs?filter%5Bcountry%5D%5B0%5D=Qatar&sort_by=external_posting_date) · [St. Regis, halaman lowongan](https://careers.marriott.com/demi-chef-de-partie-butcher/job/P1-7764201-0)

## Rekonsiliasi dan pemulihan

| Pengukuran | Hasil |
| --- | --- |
| Skenario lulus pada pemeriksaan inti | 6/6 |
| Permintaan berbayar HTTP 200 | 9 router dan 9 Responses Web Search |
| Token input / output | 169521 / 5574 |
| Token input cache | 8890 |
| Item Web Search tercatat | 21. Tarif dihitung konservatif dari seluruh item yang dilaporkan, termasuk respons yang menyertakan lebih banyak item daripada parameter `max_tool_calls`. |
| Biaya penggunaan terukur | US$0.228947 dari batas US$0.50. |

Staging kembali ke versi aktif sebelum uji dengan 100% trafik dan 0 jadwal. Karena versi uji memakai secret staging historis, Cloudflare memerlukan rollback terarah ke versi awal untuk memulihkan binding asal. Izin Responses yang sudah disimpan tetap berlaku pada key di OpenAI Platform. Binding default Worker staging kembali ke key awal yang berbeda. Deployment dan Tavily produksi tidak diubah, serta tidak ada key OpenAI baru atau deposit. [Bukti terstruktur](evidence/web-search-v2-responses-20261126.json).
