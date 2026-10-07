# Manaflow — Project Brief

Dokumen acuan proyek. Semua keputusan di sini berasal dari diskusi 6–7 Oktober 2026.
Kalau pekerjaan mulai menyimpang dari isi dokumen ini, berhenti dan perbarui dokumennya dulu.

Terakhir diperbarui: 2026-10-07

## 1. Tujuan

Manaflow adalah aplikasi private untuk satu tim (tim data & IT, 27 member) yang
mengumpulkan data pemakaian AI coding dari laptop tiap member ke satu dashboard,
supaya lead bisa melihat pemakaian per member, per device, per model, dan per tool.

Manaflow dibangun di atas [codeburn](https://github.com/getagentseal/codeburn) (lisensi MIT),
yang sudah bisa membaca file sesi lokal dari 41 tool dan menghitung token serta biayanya.
Codeburn sudah memuat hampir semua yang dibutuhkan. Tiga hal yang belum ada, dan menjadi
alasan proyek ini:

1. Data sesi per device tidak bisa dilihat dari device lain. Fitur sharing codeburn sengaja
   membuang nama project, daftar sesi, branch, dan PR sebelum data dikirim.
2. Pembagian per model untuk tiap member tidak tersedia dalam satu tampilan tim.
3. Pengumpulan data bergantung pada pairing manual di jaringan WiFi yang sama. Tim butuh
   data terkirim otomatis dari mana pun setelah aplikasi diinstal.

## 2. Bukan tujuan

- Bukan pengganti codeburn untuk pemakaian pribadi. Member tetap bisa memakai codeburn sendiri.
- Tidak mengirim isi prompt, kode, atau isi file. Hanya metadata.
- Tidak ada aplikasi desktop, menu bar, atau tray.
- Tidak melacak ChatGPT versi web: tool itu tidak menulis file sesi lokal, jadi tidak ada yang bisa dibaca.
- Definisi "performa" belum ditetapkan (lihat bagian 10). Sampai ditetapkan, dashboard
  menampilkan data pemakaian apa adanya, tanpa skor atau peringkat.

## 3. Arsitektur

```
Laptop member                          Cloudflare                      Browser lead
┌──────────────────────┐   HTTPS    ┌───────────────────┐          ┌──────────────┐
│ collector (CLI)      │ ─────────> │ Worker (API)      │ <─────── │ dashboard    │
│  - mesin codeburn    │  + token   │ D1 (database)     │  token   │ (web)        │
│  - jalan tiap 30 mnt │   member   │ cron: hapus > 3bln│  akses   │              │
└──────────────────────┘            └───────────────────┘          └──────────────┘
```

Collector mengirim (push) ke server. Server tidak pernah menghubungi laptop. Karena itu
jaringan tidak jadi masalah: laptop cukup bisa menjangkau internet.

Tiga bagian dalam satu repo:

| Folder | Isi |
|---|---|
| `collector/` | CLI yang diinstal member. Membaca data lewat codeburn, mengirim perubahan. |
| `server/` | Cloudflare Worker + skema D1. Menerima kiriman, melayani dashboard. |
| `dashboard/` | Tampilan web untuk lead. |

## 4. Keputusan yang sudah diambil

| Topik | Keputusan |
|---|---|
| Nama | manaflow |
| Repo | https://github.com/ImBarka/manaflow, private, akun pribadi (sementara) |
| Server | Cloudflare Workers + D1, paket gratis, akun pribadi (sementara) |
| Frekuensi kirim | Tiap 30 menit, hanya data yang berubah |
| Instalasi | npm, dipasang dari repo private. File executable per OS menyusul bila Node jadi kendala |
| OS yang didukung | Windows, macOS, Linux |
| Data yang dikirim | Metadata saja (rincian di bagian 5) |
| Tool | Semua 41 provider codeburn dipertahankan. Yang dipakai tim: Claude Code, Codex, Antigravity, Hermes |
| Login dashboard | Token/password. Tidak pakai email, tidak pakai Cloudflare Access |
| Akses dashboard | Hanya lead dan orang yang diberi akses |
| Data member | Nama + tim. Email tidak dikumpulkan |
| Retensi | 3 bulan |
| Identitas member | Token dibuat admin dan sudah terikat ke nama + tim; member tidak mengetik nama. Nama device otomatis dari hostname, bisa diganti |
| Token dashboard | Satu token per pemegang akses, supaya akses satu orang bisa dicabut tanpa mengganti milik yang lain |
| Mesin collector | Paket `codeburn` sebagai dependensi, dipanggil lewat keluaran JSON-nya. Kode parser tidak disalin ke repo ini; pemangkasan dilakukan setelah alurnya terbukti |

## 5. Data

Yang dikirim dari tiap laptop:

- Per sesi: id sesi, judul, nama project, tool (provider), model, jumlah call dan turn,
  token (input, output, cache read, cache write), biaya, waktu mulai, waktu selesai, durasi.
- Per hari: total biaya, call, token, turn edit, turn edit yang sekali jadi (one-shot).
- Per model dan per kategori task: biaya, call, token, one-shot.
- Identitas: id device (acak, dibuat saat login), nama device, OS, versi collector.

Yang tidak dikirim: isi prompt, jawaban model, kode, isi file, path lengkap di luar nama project,
dan kredensial apa pun.

Judul sesi dan nama project bisa memuat nama klien atau hal sensitif lain. Ini harus disebut
terang-terangan dalam pemberitahuan ke tim.

Sumber data di codeburn (sudah dicek pada v0.9.25):

- `codeburn sessions --format json --contributions` — satu baris per sesi, memuat semua field sesi di atas.
- `codeburn report --format json` — ringkasan, harian, per model, per kategori, per tool.

Dua kelemahan codeburn 0.9.25 yang ditemukan saat uji coba, dan cara collector menghindarinya:

- `--period week` tidak konsisten antar-perintah. Collector selalu memakai `--from` dan `--to` eksplisit.
- `codeburn report` tanpa `--provider` (semua tool) bisa kehilangan hari utuh. Pada uji 2026-10-07
  laporan gabungan hanya memuat 16 dari 24 hari aktif ($405 dari $992); `sessions` dan
  `report --provider <tool>` memuat semuanya. Collector mengambil sesi dari `sessions`, dan
  ringkasan harian dari `report --provider` untuk tiap tool lalu menjumlahkannya.

Karena itu angka di dashboard codeburn milik member bisa lebih kecil dari angka manaflow.

Yang sengaja dibuang collector sebelum kirim: nama branch, tautan PR, dan path lokal project.
Rincian sesi diringkas menjadi per hari + kategori task + model.

## 6. Collector

- Perintah: `manaflow login` (tempel token), `manaflow push` (kirim sekarang),
  `manaflow status`, `manaflow uninstall`.
- `login` menampilkan ringkasan data yang dikirim dan tidak dikirim, lalu memasang jadwal:
  Task Scheduler di Windows, launchd di macOS, systemd timer atau cron di Linux.
- Tidak ada proses yang hidup terus. Tiap 30 menit collector jalan, mengirim, lalu selesai.
- Kiriman bersifat idempoten: server menyimpan dengan kunci (member, device, id sesi), jadi
  kiriman ulang tidak menggandakan data.
- Laptop offline tidak menghilangkan data. Collector menghitung ulang dari file sesi lokal
  dan mengirim yang belum ada di server saat online lagi.
- Batas pemulihan: Claude Code menghapus file sesi lokal setelah 30 hari. Data yang tidak
  terkirim dalam 30 hari tidak bisa dipulihkan.
- Syarat: Node 22.13 atau lebih baru (syarat dari codeburn).

## 7. Server

- Cloudflare Worker sebagai API, D1 sebagai database.
- Token (member dan dashboard) berupa string acak panjang, disimpan di database sebagai hash SHA-256.
  Jangan pakai hash password yang lambat (bcrypt, scrypt): batas CPU paket gratis hanya 10 ms per request.
- Cron harian menghapus data yang lebih tua dari 3 bulan.
- Halaman admin: buat dan cabut token member, buat dan cabut token dashboard.

Batas paket gratis Cloudflare (dicek di dokumentasi resmi pada 2026-10-07):

| Batas | Nilai | Perkiraan pemakaian |
|---|---|---|
| Request Worker | 100.000 per hari | ±1.300 per hari (27 member × 48 kiriman) |
| CPU per request | 10 ms | Kiriman harus kecil dan sederhana |
| Baris ditulis D1 | 100.000 per hari | Anggaran ±77 baris per kiriman |
| Baris dibaca D1 | 5 juta per hari | Bergantung pada query dashboard |
| Penyimpanan D1 | 5 GB | Jauh di bawah batas untuk 3 bulan |

Bila batas harian D1 terlampaui, semua query ditolak sampai hari berikutnya. Karena itu
collector hanya mengirim sesi yang berubah, dan sesi yang sudah selesai tidak dikirim ulang.
Ketersediaan Cron Trigger di paket gratis belum dicek.

Sumber: https://developers.cloudflare.com/workers/platform/pricing/ dan
https://developers.cloudflare.com/d1/platform/pricing/

## 8. Dashboard

Tampilan minimum:

- Ringkasan tim untuk periode yang dipilih.
- Per member, dengan rincian per device.
- Per model dan per tool, untuk tim maupun tiap member.
- Daftar sesi tiap member: judul, project, model, biaya, token, durasi.
- Tren harian.

## 9. Yang diambil dan dibuang dari codeburn

Dipakai: parser dan dedup sesi, pricing, klasifikasi 13 kategori task, one-shot rate,
dan seluruh 41 provider.

Tidak dipakai: aplikasi desktop (Electron), menu bar macOS, tray Windows, ekstensi GNOME,
sharing dan pairing LAN, tampilan TUI, MCP server, guard, quota, plan, dan `optimize --apply`.

Kewajiban lisensi: sertakan notice MIT codeburn di repo ini.

## 10. Risiko dan pertanyaan terbuka

- **Definisi performa belum ada.** Biaya dan token mengukur pemakaian, bukan hasil. Member yang
  mengerjakan tugas berat akan tampak boros. One-shot rate hanyalah heuristik dan butuh sampel
  cukup. Jangan membuat peringkat sebelum definisinya disepakati.
- **Akun pribadi.** Repo dan Cloudflare ada di akun pribadi pemilik proyek. Rancang supaya
  mudah dipindah: URL server bisa dikonfigurasi, database bisa diekspor.
- **Pemberitahuan ke tim.** Dikirim sebelum instal, bersama instruksi instal: apa yang dikirim,
  apa yang tidak, siapa yang bisa melihat, berapa lama disimpan.
- **Instal dari repo private.** `npm i -g github:ImBarka/manaflow` hanya berhasil bila member
  punya akses ke repo private itu, artinya 27 orang harus dijadikan collaborator. Alternatif:
  server menyajikan paket collector sebagai file `.tgz`, lalu member memasang dari URL server.
  Belum diputuskan.
- **Node di 27 laptop.** Perlu survei siapa yang belum punya Node 22.13 atau lebih baru.
- **Daftar member** (nama + tim) sedang disiapkan pemilik proyek.

## 11. Urutan pengerjaan

1. ✅ Kerangka repo: `collector/`, `server/`, `dashboard/`, README, `.gitignore`, notice MIT.
2. ✅ Skema D1 dan API server: terima kiriman, token per member. Teruji lokal; belum di-deploy.
3. ✅ Collector: `login`, `push`, `status`, `uninstall`. Teruji ujung-ke-ujung dengan server lokal.
4. Pemasang jadwal untuk Windows, macOS, Linux.
5. Dashboard.
6. Halaman admin.
7. Uji dengan dua laptop pemilik proyek, lalu 27 member.

## 12. Aturan kerja

- Tidak ada commit atau push tanpa konfirmasi pemilik proyek.
- Kerja dilakukan di branch dari `dev`, bukan langsung di `main`.
- Kode dibuat seringan dan sesederhana mungkin: tanpa dependensi yang tidak perlu, tanpa
  fitur di luar dokumen ini.
