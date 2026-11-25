# Web Search V2 — preflight staging

26 November 2026 WIB. Kelanjutan [kandidat a5c9d9d](https://github.com/muhriskiawan23/ai-command-center/commit/a5c9d9d6cc5e2e9c6c4ad2368f9ba910eddc4370). Cakupan sesi ini adalah inspeksi metadata Cloudflare, persiapan staging, dan verifikasi lokal untuk perubahan baru.

## Kredensial dan pemilihan provider

- Cloudflare menunjukkan secret `BOR_TEXT_BACKUP_API_KEY` pada Worker produksi dan `bor-ai-luna-staging`. Nilai, kesamaan kedua key, izin project, serta saldo API tidak diketahui dari metadata. GPT-6 Luna mendukung `web_search` melalui Responses API. Key staging yang sudah ada merupakan kandidat untuk dipakai ulang jika project mengizinkan `POST /v1/responses`, model `gpt-6-luna`, Web Search, dan masih memiliki kuota atau saldo. Key baru hanya diperlukan jika izin atau cakupan key yang ada tidak sesuai.
- Worker produksi dan Luna staging yang diperiksa tidak menampilkan secret Google Search Grounding. `bor-ai-web-search-staging` dan `bor-ai-web-search-v2-staging` belum terdaftar dengan nama itu. Status key di Google AI Studio atau Cloud Console belum diperiksa. Gunakan key project Gemini yang sudah tersedia dan memenuhi ketentuan jika owner memilikinya.
- Pertahankan OpenAI sebagai provider utama agar jalur utama tetap menggunakan Luna dan bisa menangani akun di luar cakupan Google. Pertahankan Google sebagai failover bagi akun yang memenuhi syarat. Gemini 3.5 Flash-Lite adalah kandidat biaya rendah untuk uji ini. Jangan memulai integrasi baru dengan Gemini 2.5 Flash karena pengalihan model dijadwalkan 1 Desember 2026. Validasi respons, sitasi, markup saran asli, dan latensi sebelum mengubah urutan provider.

Referensi: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [izin project OpenAI](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform), [Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [Gemini API Terms](https://ai.google.dev/gemini-api/terms#grounding-with-google-search), [Gemini Pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Biaya minimum pengujian live

Asumsi rencana minimum adalah satu smoke key staging, enam giliran kualitas OpenAI termasuk follow-up, satu request pencarian lanjutan, dan satu Google live dari skenario failover dengan kegagalan OpenAI yang disimulasikan. Skenario kuota, kill switch, keamanan dan egress memakai fixture atau jalur tanpa API AI.

| Komponen | Estimasi USD |
| --- | ---: |
| OpenAI, 8 request dengan 1 tool call per request | 0.0800 untuk tool call |
| Token Luna, asumsi 9.000 input dan 600 output per request | 0.0096 |
| Gemini 3.5 Flash-Lite, 1.000 input dan 1.200 output | 0.0033 |
| Google Search dalam alokasi 5.000 kueri bulanan pada Paid Tier | 0.0000 |
| **Total rencana minimum** | **0.0929, sekitar 0.09–0.10** |

OpenAI mengenakan USD 0.01 per tool call serta tarif token pencarian dan model. Google mengenakan USD 0.014 per kueri setelah alokasi, dan satu request dapat menghasilkan beberapa kueri. Estimasi di atas memakai asumsi ukuran token, belum termasuk pajak, serta mengandalkan kuota Cloudflare yang sudah tersedia untuk inferensi router. Jumlah tool call aktual dapat lebih tinggi. Dengan 13 request OpenAI dan 3 tool call per request, biaya tool saja sekitar USD 0.39. Persetujuan anggaran uji sebesar **USD 0.50** memberi ruang untuk variasi dan perlu dipantau bersama saldo serta laporan penggunaan provider.

Saldo aktif yang cukup berarti tambahan setoran bisa **USD 0**. Jika kedua project harus mulai dari prepaid kosong, siapkan **USD 5 OpenAI + USD 5 Google = USD 10 kredit awal**, sebelum pajak atau konversi. Google dapat menawarkan Postpay yang berbeda tergantung akun. Kredit awal terpisah dari estimasi pemakaian.

Referensi: [OpenAI API Pricing](https://developers.openai.com/api/docs/pricing), [OpenAI prepaid billing](https://help.openai.com/en/articles/8264644-setting-up-and-managing-prepaid-api-billing), [Gemini Pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite), [Gemini Billing](https://ai.google.dev/gemini-api/docs/billing).

## Persiapan egress tanpa biaya

- Metadata Cloudflare mengonfirmasi VPC Service HTTP `bor-ai-termux-egress` dan bahwa binding `DB` Worker Luna mengarah ke D1 bernama `bor-ai-luna-staging`. Akun staging belum memiliki binding `EGRESS_PROXY` dan secret `EGRESS_PROXY_TOKEN` pada Worker tersebut.
- `node scripts/prepare-luna-staging.mjs <D1_STAGING_UUID> --vpc-service <EXISTING_VPC_SERVICE_UUID>` menghasilkan konfigurasi khusus Worker Luna staging. Wrangler 4.160.0 dalam mode dry run berhasil mengenali D1 staging, VPC Service, AI, dan paket Worker.
- Probe `POST /smoke/url-reader` mengecek bahwa proxy menolak autentikasi salah dan tujuan privat, lalu menguji satu URL publik tetap dengan bukti peer dan TLS. Probe memerlukan token operator Luna staging, flag `BOR_LUNA_STAGING_URL_READER_ENABLED=true` dan token proxy yang cocok dengan layanan Termux. Pakai nilai yang sudah disimpan di sisi owner dan masukkan sebagai secret Worker staging. Cloudflare tidak menyediakan pembacaan ulang nilai secret Worker lama. Binding service yang terdaftar belum membuktikan tunnel, token dan route masih sehat.
- Probe `POST /smoke/web-search` memakai secret Luna staging yang sudah terpasang, kueri tetap dan respons ringkas berisi status serta keberadaan sitasi. Probe memerlukan token operator, migrasi 0017 pada D1 staging, dan flag `BOR_LUNA_STAGING_WEB_SEARCH_ENABLED=true`. Ledger membatasi probe ke satu request pada hari/bulan UTC dengan reservasi aplikasi USD 0.15. Kedua flag mati secara default. Validasi scope live menunggu izin pengeluaran.
- Ketiga tes baru isolasi staging, penggunaan ulang key/limit dan egress mock lulus. Tidak ada deploy, pemasangan secret, migrasi D1 remote, aktivasi billing, atau panggilan AI provider dalam sesi ini.

Referensi: [Workers VPC binding](https://developers.cloudflare.com/workers-vpc/api/), [Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## Tujuh hasil skip pada checkpoint

| Jumlah | Tes | Alasan |
| ---: | --- | --- |
| 1 | Node, DNS rebinding authoritative | Opt-in `BOR_AI_LIVE_DNS_REBINDING=1`. Memerlukan resolusi DNS ke fixture eksternal. Status skip berasal dari flag, sedangkan DNS eksternal tetap di luar pengujian lokal terisolasi sesi ini. |
| 4 | Playwright desktop, kombinasi drawer, Back/Forward, backdrop dan riwayat | Skenario khusus mode drawer, dan padanannya lulus di ponsel. |
| 1 | Playwright desktop, tutup Memori lalu Profil melalui Back | Skenario khusus drawer, lulus di ponsel. |
| 1 | Playwright ponsel, tutup panel desktop dengan Back/Escape | Skenario khusus desktop, lulus di desktop. |

Suite yang lulus pada checkpoint tidak diulang. Sebelum smoke live, owner perlu mengizinkan biaya dan memastikan project OpenAI key staging memiliki akses. Untuk Google, owner perlu memilih project yang memenuhi ketentuan dan memasang key melalui secret staging. Untuk egress, owner perlu menyediakan cara aman memasang token proxy Termux yang sudah ada dan memastikan tunnel aktif. Nilai key, token operator dan token egress tetap berada di penyimpanan secret.
