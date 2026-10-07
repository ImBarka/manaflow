# Manaflow

Pengumpul dan dashboard pemakaian AI coding untuk satu tim. Tiap laptop member mengirim
metadata sesi (bukan isi prompt) ke satu server tiap 30 menit; lead melihatnya di dashboard.

Dibangun di atas [codeburn](https://github.com/getagentseal/codeburn).

Status: kerangka awal. Belum ada bagian yang berfungsi.

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
