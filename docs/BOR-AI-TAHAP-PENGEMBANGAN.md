# Tahap pengembangan BOR AI

BOR AI tetap melayani chat umum. Fokus pilot pertama adalah membantu pengguna Indonesia mencari dan memeriksa informasi praktis dari sumber resmi lewat ponsel. Kasus awal memakai kebutuhan yang sudah muncul dari pengguna, yaitu mencari lowongan perhotelan luar negeri dari Indonesia dan mempersempit pencarian ke Doha.

## 1. Kemampuan yang jelas di chat

Pertanyaan langsung seperti “Apa kekuranganmu?” dijawab berdasarkan pencarian dan pembacaan tautan eksternal yang dikonfigurasi. Jawaban menjelaskan cara memakai lampiran dan memberi umpan balik. Pengguna tetap bisa meminta analisis yang lebih luas. Kriteria lulus adalah status fitur sesuai skenario, nol panggilan model atau pencarian untuk ringkasan, serta jawaban tersimpan dan bisa diberi umpan balik di akun pemiliknya. Cakupan ringkasan mengikuti jalur pencarian di `main`. Saat Web Search V2 masuk, verifikasi juga pembatasan pilot dan kill switch.

## 2. Kualitas jawaban dan keandalan pencarian

Jalankan enam kasus pembanding dari Bahasa Indonesia dan Inggris lewat runner yang sudah ditinjau. Kelulusan mengikuti rubrik yang ada, minimal 90/100 pada tiap kasus dan tanpa kesalahan kritis. Catat akurasi fakta, pertanyaan yang terjawab, kegagalan, median dan p95 latensi dari aplikasi, serta biaya aktual per tugas dari pemakaian provider. Jika data biaya belum direkonsiliasi, tandai kolom biaya sebagai belum terverifikasi. Pisahkan hasil browser lokal, hasil staging dengan Google login dan riwayat, serta bukti runtime edge. [Kasus pembanding](https://github.com/muhriskiawan23/ai-command-center/blob/48ce4ce89c75353de559826d00ec682137216334/evaluation/answer-quality-smoke.json) · [Gate benchmark](https://github.com/muhriskiawan23/ai-command-center/blob/48ce4ce89c75353de559826d00ec682137216334/docs/BOR-AI-STAGING-BENCHMARK-ADAPTER.md)

Luna menjadi jalur OpenAI Web Search. Google Grounding menunggu bukti live untuk akun yang memenuhi syarat. URL Reader baru menunggu bukti koneksi egress yang aman. Pertahankan Tavily sampai verifikasi pengganti selesai dan hasil cutover disetujui. Eksekusi live masih bergantung pada izin staging dan kasus dukungan `#21221763`.

## 3. Pilot alur lowongan resmi

Uji alur Bahasa Indonesia untuk menemukan lowongan dari situs karier resmi, menyaring lokasi dan posisi, menautkan setiap lowongan yang masih bisa diperiksa, dan mempertahankan konteks saat pengguna menyebut “kalau di Doha?”. Tampilkan perusahaan, posisi, lokasi, tautan lamaran resmi, serta tanggal atau status jika sumber mencantumkannya. Jika sumber tidak mengonfirmasi status, nyatakan itu di hasil. Regresi Doha lokal sudah tersedia sebagai titik awal. [Regresi Doha](https://github.com/muhriskiawan23/ai-command-center/blob/48ce4ce89c75353de559826d00ec682137216334/tests/web-search-v2-release-pilot.test.js)

Target awal untuk pilot adalah 20 tugas yang layak dinilai, minimal 90% fakta penting sesuai sumber, nol klaim lowongan aktif tanpa bukti, dan pengukuran penyelesaian tugas serta tingkat penggunaan kembali. Catat kepuasan dari 👍/👎 bersama jumlah respons agar hasil dapat ditafsirkan. Gunakan temuan pilot untuk memilih perbaikan, menulis contoh alur pada produk, dan menentukan perluasan ke pekerjaan lain.

## 4. Kepercayaan, dukungan, dan distribusi

Uji umpan balik, riwayat, dan penghapusan data akun dengan dua akun uji terpisah. Tetapkan pemilik triase untuk feedback yang masuk, catat temuan yang sudah dipastikan, dan ukur waktu tanggapan. Publikasikan contoh hasil yang telah diverifikasi setelah pilot melewati target. Ukur berapa banyak pengguna mencoba alur dan kembali menggunakannya sebelum menambah saluran distribusi. Tambahkan integrasi eksternal jika kebutuhan berulang sudah terbukti dan izin serta konfirmasi tindakan pengguna sudah dirancang.

## 5. Lokalisasi dan ekspansi

Perluas ke satu kelompok pengguna atau satu pasar pada satu waktu setelah hasil Indonesia stabil. Uji bahasa, istilah, dan sumber lokal dengan penutur atau pengguna di pasar itu, dan periksa kesiapan bantuan pengguna, privasi, aturan setempat, serta kemampuan pelayanan dan kuota. Jika pembayaran sudah siap, gunakan USD sebagai acuan harga dan uji pembayaran lokal sesuai pasar. Tetapkan target kualitas dan biaya per tugas sebelum pilot pasar berikutnya.
