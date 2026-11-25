# Web Search V2 — verifikasi enam skenario staging

26 November 2026 WIB. Melanjutkan [checkpoint autentikasi sebelumnya](BOR-AI-WEB-SEARCH-V2-LIVE-STAGING.md) setelah owner memperbarui key Cloudflare `BOR_TEXT_BACKUP_API_KEY` di Worker `bor-ai-luna-staging`.

## Cakupan

- Runner memakai router dan adapter Web Search V2 dengan GPT-6 Luna di Responses API. Enam prompt sintetis mencakup agensi Jakarta, lowongan Qatar, dua ponsel di bawah Rp3 juta, berita internasional, alamat Qatar Airways, dan follow-up kontekstual Doha.
- Satu evaluasi diizinkan oleh klaim unik di D1 staging. Search dibatasi maksimal dua pemanggilan tool per request, dengan reservasi USD 0.24 per search dan saldo kampanye USD 0.50. Reservasi diselesaikan ke biaya berbasis token setelah penggunaan diketahui. Laporan biaya memakai tarif Standard, jumlah tool yang terlihat, dan tarif konteks panjang Luna bila berlaku. Nilai ini adalah kalkulasi dari penggunaan API, tanpa rekonsiliasi ke invoice project.
- Bukti QA lokal sebelumnya dipakai kembali. Tiga tes runner terdampak lulus, termasuk uji penolakan kuota, enam skenario melalui mock, dan penghentian pada reservasi konteks panjang.
- Validasi di bawah berlaku untuk staging backend. Validasi browser sebelumnya memakai mock. Google Grounding dan URL Reader bukan bagian pengujian OpenAI ini.

Rujukan biaya: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) dan [OpenAI API Pricing](https://developers.openai.com/api/docs/pricing).

## Hasil live

| Pemeriksaan | Respons | Penggunaan teramati |
| --- | --- | --- |
| Router Luna, percobaan awal setelah rotasi key | HTTP 429 | Tanpa metadata token, 0 tool calls. |
| Metadata `GET /v1/models/gpt-6-luna` | HTTP 200 | Pemeriksaan akses metadata, tanpa inferensi. |
| Router Luna `POST /v1/responses`, diagnostik | HTTP 429, `error.code=billing_not_active` | Tanpa metadata token, 0 tool calls. |

Key baru terautentikasi untuk membaca metadata GPT-6 Luna. Project menolak permintaan inferensi karena billing belum aktif. Ini merupakan bukti respons provider, berbeda dari 401 pada checkpoint sebelumnya. Runner berhenti di router skenario pertama. Ledger pencarian kosong dan biaya dari penggunaan API yang terlihat USD 0.00. Saldo atau invoice provider tidak diperiksa terpisah.

| Skenario wajib | Status |
| --- | --- |
| Agensi kerja perhotelan Timur Tengah di Jakarta | Router dicoba. Terblokir sebelum pencarian. |
| Lowongan terbaru di Qatar | Belum dikirim karena penolakan billing. |
| Rekomendasi produk dan harga terbaru | Belum dikirim. |
| Berita internasional terbaru | Belum dikirim. |
| Perusahaan dan lokasi | Belum dikirim. |
| Follow-up kontekstual Doha | Belum dikirim. |

Kualitas, kesegaran, serta validitas sitasi jawaban model belum bisa dinilai. [Registri P3MI](https://siskop2mi.bp2mi.go.id/profil/lembaga/detail/601/p3mi) dan [portal karier resmi Marriott Qatar](https://careers.marriott.com/jobs?filter%5Bcountry%5D%5B0%5D=Qatar) digunakan sebagai pembanding manual. Keduanya tidak dihitung sebagai keluaran Web Search BOR AI.

Cron staging belum tercatat menjalankan evaluasi saat diperiksa. Pemicu HTTP sementara menggunakan challenge satu kali dan klaim D1 yang sama untuk mencegah duplikasi jika cron mulai berjalan. Dua tes tambahan lulus untuk kegagalan billing setelah metadata sukses dan proteksi pemicu sementara. Bukti JSON berisi request ID, status, ledger, dan pemulihan, tanpa key atau challenge. [Bukti terstruktur](evidence/web-search-v2-six-20261126.json).

Versi staging `c760d7a2-40d9-42f8-a1dd-4b737a44b4ae` yang memuat rotasi key kembali menerima 100% trafik. Jadwal sementara sudah dilepas. Untuk melanjutkan tanpa deposit, gunakan key dari project OpenAI yang sudah memiliki billing aktif, saldo yang tersedia, serta izin Responses API dan GPT-6 Luna. Batas kampanye tetap USD 0.50.
