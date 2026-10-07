# Memasang Manaflow di laptop

Panduan untuk member tim. Butuh waktu sekitar 5 menit.

## Apa yang dilakukan Manaflow

Manaflow membaca catatan sesi AI coding yang sudah ada di laptopmu (Claude Code, Codex,
Antigravity, Hermes, dan tool lain yang didukung codeburn), lalu mengirim ringkasannya ke
dashboard tim tiap 30 menit.

| | |
|---|---|
| **Dikirim** | Judul sesi, nama project, tool, model, jumlah call dan turn, jumlah token, biaya setara tarif API, kategori task, waktu mulai dan selesai, nama file yang sering diedit ulang (nama file saja), nama MCP server dan skill yang dipakai, ukuran context per jenis blok |
| **Tidak dikirim** | Isi prompt, jawaban model, kode, isi file, nama branch, tautan PR, path folder di laptopmu |
| **Dilihat oleh** | Lead dan orang yang diberi akses dashboard |
| **Disimpan** | 3 bulan, lalu dihapus otomatis |

Judul sesi dan nama project terkirim apa adanya. Kalau judul sesimu memuat hal yang tidak ingin
dibagikan, ganti judulnya di tool yang kamu pakai.

Manaflow tidak berjalan terus di background. Tiap 30 menit ia jalan sekitar 10–40 detik, mengirim,
lalu berhenti.

## Syarat

Node.js 22.13 atau lebih baru. Cek dengan:

```bash
node --version
```

Kalau belum ada atau versinya lebih lama, pasang dari https://nodejs.org (pilih LTS).

## Pasang

```bash
npm install -g github:ImBarka/manaflow
```

## Login

Kamu akan menerima token pribadi dari admin. Jalankan:

```bash
manaflow login
```

lalu tempel tokenmu saat diminta. Bisa juga dalam satu baris: `manaflow login --token <token kamu>`.

Token itu milikmu sendiri; jangan dibagikan. Punya laptop kedua? Minta token tambahan ke admin
(token pertamamu tetap berlaku), atau pakai lagi token yang sama. Login sekaligus memasang jadwal kirim otomatis
(Task Scheduler di Windows, launchd di macOS, systemd atau cron di Linux).

Lalu kirim data pertama:

```bash
manaflow push
```

Kiriman pertama memuat sekitar 35 hari terakhir dan bisa makan waktu hingga satu menit.

## Perintah lain

| Perintah | Fungsi |
|---|---|
| `manaflow status` | Lihat status login, jadwal, dan kiriman terakhir |
| `manaflow push` | Kirim sekarang tanpa menunggu jadwal |
| `manaflow schedule off` | Hentikan kirim otomatis |
| `manaflow schedule on` | Aktifkan lagi (jalankan juga setelah ganti versi Node) |
| `manaflow uninstall` | Lepas jadwal dan hapus token dari laptop ini |

Memperbarui ke versi terbaru: jalankan lagi perintah pasang di atas.

## Kalau ada masalah

- **`manaflow` tidak dikenali**: tutup dan buka lagi terminal. Di Windows, pastikan folder npm
  global ada di PATH.
- **Token ditolak**: minta token baru ke admin.
- **Tidak ada data yang muncul di dashboard**: jalankan `manaflow status`, lalu lihat isi
  `push.log` di folder config yang ditampilkan.
- **Berhenti mengirim setelah ganti versi Node**: jalankan `manaflow schedule on`.

Catatan: jadwal otomatis sudah diuji di Windows. Di macOS dan Linux belum pernah diuji di mesin
sungguhan; kalau jadwalnya tidak jalan, kabari admin dan pakai `manaflow push` manual dulu.
