# BOR AI Web Search V2 — Laporan Sesi 26 November 2026

Status: **sebagian selesai, berhenti di batas akses** (tidak ada pengujian live yang dijalankan, biaya baru USD 0).

## Checkpoint yang dirujuk
- Repo: muhriskiawan23/ai-command-center, branch feature/web-search-v2
- Commit: 18f6402459b0b85dd72440297cf8b4a85f3ba638
- Worker staging: bor-ai-luna-staging (versi 30, rollback versi 29)
- Model utama: GPT-6 Luna (tidak diubah)

## Yang berhasil dilakukan
Pembacaan read-only kode Worker staging lewat konektor Cloudflare. Tidak ada deploy, perubahan secret, atau perubahan production.

- Worker bor-ai-luna-staging ada dan bundelnya berisi **41 modul**, sesuai catatan checkpoint.
- Pemindaian pola secret (sk-, tvly-, AIza, ghp_, Bearer panjang) pada 41 modul: **tidak ada yang cocok**.
- Hanya bundel yang ter-deploy yang dibaca. Kecocokan dengan commit 18f6402 dan nomor versi 30 **tidak dapat diverifikasi** dari sini.

## Temuan audit (kode staging yang ter-deploy)
Kontrol yang terlihat baik:
- Semua perbandingan token/digest memakai hash SHA-256 dan perbandingan tanpa percabangan awal.
- Jalur smoke search: kill switch, flag enabled, digest 64 hex, kedaluwarsa maksimum 5 menit, cek Origin dan header intent, serta klaim satu kali di D1. Gagal tertutup (reservasi tetap ditahan saat kegagalan atau timeout).
- Pemanggilan OpenAI: `store: false`, `redirect: "manual"`, satu percobaan saja pada smoke, model dikunci ke pola gpt-6-luna pada receipt.
- Receipt hanya menyimpan metadata, bukan isi respons penyedia.
- Tautan sitasi hanya https dan melewati filter URL sensitif.

Catatan risiko rendah:
- Pemicu evaluasi live (`/__staging-evaluation`) memeriksa kedaluwarsa tetapi tidak membatasi seberapa jauh tanggal kedaluwarsa boleh ditetapkan, berbeda dengan bridge smoke (maks 5 menit). Rekomendasi: tambahkan batas maksimum yang sama.
- Reservasi per panggilan live adalah USD 0,26. Batas kampanye di kode USD 0,50 dan biaya terdahulu USD 0,228947, sehingga hanya **satu** panggilan live lagi yang muat (0,228947 + 0,26 = 0,488947). Margin sisa USD 0,011053. Reservasi bukan jaminan tagihan penyedia, jadi rekonsiliasi dengan dasbor penagihan tetap perlu.

## Yang tidak bisa diselesaikan (kendala)
1. Membaca laporan/bukti di repo: repo tidak bisa diakses dari sini (tidak ada kredensial GitHub; API 403, raw 404).
2. Uji live kandidat terbaru: butuh trigger digest, token sekali pakai, dan ID kampanye yang dipegang operator. Tidak dijalankan, tidak ada biaya.
3. Integrasi aplikasi dan browser E2E: butuh akses repo dan URL staging.
4. Verifikasi Google Grounding dan URL Reader: butuh secret kunci Google, binding EGRESS_PROXY, dan token proxy. Keberadaan secret tidak terlihat lewat konektor. Dipisahkan sebagai terkendala kredensial/tunnel.
5. Menyimpan ke GitHub: tidak ada akses tulis. Berkas ini perlu diunggah manual.

## Biaya
- Biaya sebelumnya: USD 0,228947
- Biaya sesi ini: USD 0
- Sisa anggaran: USD 0,271053
