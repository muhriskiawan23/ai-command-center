# Uji BOR AI Voice di perangkat fisik

## Cek gratis di HP

Buka tautan langsung di Chrome Android, di luar browser dalam aplikasi. Catat perangkat, versi Chrome dan hasil tiap langkah. Pakai suara singkat dan objek tanpa informasi pribadi.

| Cek | Langkah | Lulus jika |
| --- | --- | --- |
| Mikrofon, speaker dan WebRTC | Pasang earphone, buka [Audio loopback WebRTC](https://webrtc.github.io/samples/src/content/peerconnection/audio/), tekan **Call**, izinkan mikrofon, lalu ucapkan satu kalimat. Tekan **Hang Up** dan tutup tab. | Suara terdengar kembali dan grafik paket mulai bergerak. |
| Kamera | Buka [Demo kamera WebRTC](https://webrtc.github.io/samples/src/content/getusermedia/gum/), tekan **Open camera**, lalu izinkan kamera. Tutup tab setelah selesai. | Gambar bergerak tampil dan indikator kamera padam saat tab ditutup. |
| Berbagi layar | Pada Chrome desktop yang mendukungnya, buka [Demo berbagi layar WebRTC](https://webrtc.github.io/samples/src/content/getusermedia/getdisplaymedia/), tekan **Start**, pilih tab kosong, lalu hentikan berbagi. | Pemilih layar muncul, pratinjau tampil dan berhenti ketika sharing dihentikan. |

Chrome Android belum mendukung Web Screen Capture API menurut [tabel kompatibilitas](https://caniuse.com/mdn-api_mediadevices_getdisplaymedia). Verifikasi jalur screenshot melalui lampiran gambar pada build uji BOR AI. Menambahkan pintasan native Android yang benar-benar berbagi layar merupakan pekerjaan terpisah.

Cek pertama dan kedua menguji perangkat, izin dan browser. Hasilnya belum memverifikasi sesi GPT-Live atau integrasi BOR AI.

## Kriteria uji build BOR AI yang terisolasi

Gunakan origin HTTPS uji yang mengizinkan mikrofon dan kamera. Jalankan dahulu dengan data simulasi dan tanpa kredensial API.

| Alur | Kriteria |
| --- | --- |
| Mulai dan tutup sesi | Mikrofon aktif setelah sesi siap. Tombol Akhiri, perubahan chat dan penutupan halaman menghentikan track. Ulangi setelah menolak izin dan setelah koneksi terputus. |
| Dikte dan transkrip | Baca satu kalimat, periksa kedua transkrip, salin transkrip pengguna ke composer, edit, lalu kirim secara eksplisit. |
| Bacakan | Pilih balasan berbahasa Indonesia, dengarkan, hentikan di tengah kalimat dan buka chat lain. Catat jika perangkat tidak memiliki voice lokal yang cocok. |
| Kamera dan layar | Pratinjau bergerak, satu gambar masuk sebagai draf setelah menekan Lampirkan, dan sesi tangkap selesai. Periksa bahwa cuplikan tidak terkirim otomatis. |
| Sesi asli, setelah batas biaya tervalidasi | Periksa suara dua arah, interupsi spontan, follow-up yang memakai konteks dan satu jawaban pencarian bersumber. Catat penggunaan akhir provider. Jalankan uji analisis gambar melalui jalur visual dan catat status analisis video secara terpisah. |

Contoh hasil yang bisa dibalas lewat chat: `Chrome Android — audio terdengar, kamera tampil` atau tuliskan pesan galatnya. Jangan kirim rekaman, screenshot pribadi, atau kredensial.
