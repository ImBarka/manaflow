# Manaflow

Pengumpul dan dashboard pemakaian AI coding untuk satu tim. Tiap laptop member mengirim
metadata sesi (bukan isi prompt) ke satu server tiap 30 menit; lead melihatnya di dashboard.

Dibangun di atas [codeburn](https://github.com/getagentseal/codeburn).

Status: collector, jadwal otomatis, dan API penerima sudah berjalan dan teruji di lokal
(jadwal baru teruji di Windows). Belum di-deploy; dashboard belum ada.

## Coba di lokal

```bash
npm install && npm test                 # collector
cd server && npm install && npm test    # server
```

Uji ujung-ke-ujung: lihat [server/README.md](server/README.md) untuk menjalankan server lokal,
lalu `manaflow login --server http://127.0.0.1:8787` dan `manaflow push`.

## Dokumen

- [docs/PROJECT-BRIEF.md](docs/PROJECT-BRIEF.md) — tujuan, keputusan, arsitektur, urutan pengerjaan. Baca ini dulu.

## Struktur

| Folder | Isi |
|---|---|
| `collector/` | CLI `manaflow` yang diinstal member |
| `server/` | Cloudflare Worker + skema D1 |
| `dashboard/` | Tampilan web untuk lead |
| `docs/` | Dokumen proyek |

## Syarat

Node 22.13 atau lebih baru.

## Lisensi

Private, untuk pemakaian internal tim. Notice pihak ketiga ada di
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
