# Manaflow — Project Brief

Dokumen acuan proyek. Semua keputusan di sini berasal dari diskusi 6–7 Oktober 2026.
Kalau pekerjaan mulai menyimpang dari isi dokumen ini, berhenti dan perbarui dokumennya dulu.

Terakhir diperbarui: 2026-10-07

## 1. Tujuan

Manaflow adalah aplikasi internal untuk satu tim (tim data & IT, 27 member) yang
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
| Repo | https://github.com/ImBarka/manaflow, publik sejak 2026-10-07, akun pribadi (sementara) |
| Server | Cloudflare Workers + D1, paket gratis, akun pribadi (sementara) |
| Frekuensi kirim | Tiap 30 menit, hanya data yang berubah |
| Instalasi | npm, dipasang dari repo GitHub (`npm install -g github:ImBarka/manaflow`). File executable per OS menyusul bila Node jadi kendala |
| OS yang didukung | Windows, macOS, Linux |
| Data yang dikirim | Metadata saja (rincian di bagian 5) |
| Tool | Semua 41 provider codeburn dipertahankan. Yang dipakai tim: Claude Code, Codex, Antigravity, Hermes |
| Login dashboard | Token/password. Tidak pakai email, tidak pakai Cloudflare Access |
| Akses dashboard | Hanya lead dan orang yang diberi akses |
| Data member | Nama + posisi (jabatan). Semua member satu tim (data & IT), jadi tidak ada pembagian tim. Email tidak dikumpulkan |
| Retensi | 3 bulan |
| Identitas member | Token dibuat admin dan sudah terikat ke nama + posisi; member tidak mengetik nama. Nama device otomatis dari hostname, bisa diganti |
| Laptop kedua | Token disimpan sebagai hash dan tidak bisa ditampilkan lagi. Untuk laptop tambahan, admin membuat token tambahan ("Tambah device"); token lama tetap berlaku. "Ganti token" mematikan semua token member itu |
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

Kelemahan ketiga (ditemukan 2026-10-08): `codeburn status --format menubar-json --no-optimize`
menyimpan snapshot dan sengaja menahan pembaruan pada panggilan pertama setelah file sesi berubah
(debounce untuk menu bar yang memanggilnya tiap beberapa detik). Collector yang jalan tiap 30
menit selalu menjadi "panggilan pertama" itu, sehingga paket Usage tertinggal satu siklus dari
data harian. Collector mematikan penahanan itu dengan `CODEBURN_STATUS_SNAPSHOT_SETTLE_MS=0`.

Akar masalah yang kedua (diselidiki 2026-10-07): cache harian codeburn
(`~/.cache/codeburn/daily-cache.v34.json`) bisa kehilangan hari utuh tetapi tetap menandai dirinya
lengkap, dan semua tampilan "all tools" membaca dari cache itu. Dengan folder cache yang baru,
angkanya benar. Karena itu collector memakai folder cache codeburn miliknya sendiri
(`~/.config/manaflow/cache`), dan tiap kiriman membandingkan riwayat harian di paket Usage dengan
angka per-tool yang di-parse segar; bila berbeda, cache harian miliknya dihapus dan dihitung ulang.
Cache codeburn milik member sendiri tidak disentuh.

Karena itu angka di dashboard codeburn milik member bisa lebih kecil dari angka manaflow.

Yang sengaja dibuang collector sebelum kirim: nama branch, tautan PR, dan path lokal project.
Rincian sesi diringkas menjadi per hari + kategori task + model.

## 6. Collector

- Perintah: `manaflow login` (tempel token), `manaflow push` (kirim sekarang),
  `manaflow status`, `manaflow schedule on|off`, `manaflow uninstall`.
- `login` menampilkan ringkasan data yang dikirim dan tidak dikirim, lalu memasang jadwal:
  Task Scheduler di Windows, launchd di macOS, systemd timer (atau cron bila systemd tidak ada) di Linux.
- Jadwal Windows didaftarkan lewat XML supaya tetap jalan saat laptop memakai baterai, dan
  dijalankan lewat `conhost --headless` supaya tidak memunculkan jendela tiap 30 menit.
- Kiriman terjadwal mencatat satu baris per jalan ke `push.log` di folder config
  (`~/.config/manaflow/`), karena tidak ada terminal untuk menampilkan hasilnya.
- Jadwal menyimpan path Node dan path instalasi saat itu. Bila Node diganti versi lewat nvm atau
  manaflow dipindah, jalankan `manaflow schedule on` lagi.
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

Dua tampilan (keputusan 2026-10-07):

- **Ringkasan tim** di `/` (`dashboard/public/`, HTML/JS polos): total, tren, per model, per tool,
  rekap harian (klik tanggal untuk rincian per member), tabel member, rincian member.
- **Usage dan Context per member** di `/u/` (`dashboard/app/`, React): salinan dashboard web
  codeburn dengan warna yang sama dan nama diganti Manaflow. Sidebar berisi daftar member; pemegang
  akses memilih orang dan melihat Usage serta Context orang itu seperti di codeburn miliknya.
  Yang dibuang dari aslinya: sharing/pairing device, dan filter "All tools" (paket data dikirim
  untuk semua tool sekaligus; rincian per tool tetap ada di panel By Tool).

Untuk tampilan kedua, collector mengirim paket Usage codeburn untuk enam periode (today dan week
tiap kiriman; 30 hari, bulan, 6 bulan, lifetime tiap 6 jam) serta pohon Context untuk semua sesi
Claude Code dan Codex dalam jendela 35 hari yang baru atau berubah. Membangun pohon Context makan
±1 detik per sesi, jadi tiap kiriman dibatasi 45 detik untuk itu (terbaru dulu) dan sisanya
menyusul di kiriman berikutnya. Sebelum dikirim dibuang: nama branch, tautan PR, sesi live,
path folder lokal (nama file dan nama project tetap). Pohon Context hanya berisi jumlah token per
jenis blok dan per tool, bukan isi percakapan.

Periode: halaman tim memakai Today, 7 hari, 30 hari, Bulan ini, 90 hari; halaman per member
memakai periode codeburn (Today, 7 days, 30 days, Month, 6 months, Lifetime). Di halaman Context,
tombol periode menyaring daftar sesi menurut waktu terakhir aktif.

Tampilan minimum ringkasan tim:

- Ringkasan tim untuk periode yang dipilih.
- Per member, dengan rincian per device.
- Per model dan per tool, untuk tim maupun tiap member.
- Daftar sesi tiap member: judul, project, model, biaya, token, durasi.
- Tren harian.

## 9. Yang diambil dan dibuang dari codeburn

Dipakai: parser dan dedup sesi, pricing, klasifikasi 13 kategori task, one-shot rate,
seluruh 41 provider, serta tampilan Usage dan Context dari dashboard web codeburn (disalin ke
`dashboard/app/`).

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
- **Repo publik** (keputusan 2026-10-07), supaya member cukup menjalankan
  `npm install -g github:ImBarka/manaflow` tanpa akun GitHub. Konsekuensinya: tidak boleh ada
  token, daftar member, atau data asli yang masuk repo, dan riwayat git bersifat permanen.
  Keamanan bergantung pada token, bukan pada kode yang dirahasiakan. Alamat server jadi diketahui
  umum; server belum punya rate limit.
- **Node di 27 laptop.** Perlu survei siapa yang belum punya Node 22.13 atau lebih baru.
- **Daftar member** (nama + posisi) ada di `docs/list_karyawan.md`, di-ignore git karena berisi nama asli.

## 11. Urutan pengerjaan

1. ✅ Kerangka repo: `collector/`, `server/`, `dashboard/`, README, `.gitignore`, notice MIT.
2. ✅ Skema D1 dan API server: terima kiriman, token per member. Ter-deploy 2026-10-07 di
   https://manaflow.manaflow-server.workers.dev (D1 region APAC).
3. ✅ Collector: `login`, `push`, `status`, `uninstall`. Teruji ujung-ke-ujung dengan server lokal.
4. ✅ Pemasang jadwal. Windows teruji di mesin nyata; macOS dan Linux baru teruji sebatas isi
   file yang dihasilkan, belum pernah dijalankan di mesin sungguhan.
5. ✅ Dashboard: ringkasan tim, tren harian, per model, per tool, tabel member, rincian member
   (per model, kategori, tool, device, daftar sesi). Teruji di lokal dengan data asli satu laptop;
   belum pernah diuji dengan banyak member.
6. ✅ Halaman admin di `/admin` dan hapus otomatis data di atas 92 hari (cron harian). API-nya
   teruji; halaman admin belum pernah dicoba di browser.
7. Uji dengan dua laptop pemilik proyek, lalu 27 member.

## 12. Aturan kerja

- Tidak ada commit atau push tanpa konfirmasi pemilik proyek.
- Kerja dilakukan di branch dari `dev`, bukan langsung di `main`.
- Kode dibuat seringan dan sesederhana mungkin: tanpa dependensi yang tidak perlu, tanpa
  fitur di luar dokumen ini.
