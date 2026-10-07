# Manaflow

Pengumpul dan dashboard pemakaian AI coding untuk satu tim. Tiap laptop member mengirim
metadata sesi (bukan isi prompt) ke satu server tiap 30 menit; lead melihatnya di dashboard.

Dibangun di atas [codeburn](https://github.com/getagentseal/codeburn).

Status: collector, jadwal otomatis, API, dan dashboard sudah berjalan. Server dan dashboard
ter-deploy di https://manaflow.manaflow-server.workers.dev (halaman admin di `/admin`).
Jadwal baru teruji di Windows; halaman admin belum pernah dicoba di browser.

## Coba di lokal

```bash
npm install && npm test                 # collector
cd server && npm install && npm test    # server
```

Uji ujung-ke-ujung: lihat [server/README.md](server/README.md) untuk menjalankan server lokal,
lalu `manaflow login --server http://127.0.0.1:8787` dan `manaflow push`.

## Dokumen

- [docs/INSTALL.md](docs/INSTALL.md) — panduan pasang untuk member, termasuk apa yang dikirim dan tidak.
- [docs/PROJECT-BRIEF.md](docs/PROJECT-BRIEF.md) — tujuan, keputusan, arsitektur, urutan pengerjaan.

## Struktur

| Folder | Isi |
|---|---|
| `collector/` | CLI `manaflow` yang diinstal member |
| `server/` | Cloudflare Worker + skema D1 |
| `dashboard/public/` | Ringkasan tim dan halaman admin: HTML, CSS, dan JS polos, tanpa build |
| `dashboard/app/` | Usage dan Context per member (React, disalin dari dashboard web codeburn); hasil build masuk ke `dashboard/public/u/` saat deploy |
| `docs/` | Dokumen proyek |

## Syarat

Node 22.13 atau lebih baru.

## Lisensi

MIT, lihat [LICENSE](LICENSE). Notice pihak ketiga ada di
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Repo ini publik, tetapi tidak memuat token, daftar member, maupun data pemakaian: semuanya ada di
server dan di file lokal yang di-ignore git.
