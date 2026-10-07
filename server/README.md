# server

Cloudflare Worker (API) dan skema D1.

## Endpoint

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/v1/health` | — | Cek server hidup |
| POST | `/v1/ingest` | Token member | Terima sesi dan ringkasan harian dari satu device |
| GET | `/v1/dashboard?from&to` | Token dashboard | Agregat tim untuk rentang tanggal |
| GET | `/v1/sessions?member&from&to` | Token dashboard | Daftar sesi satu member (maks 500) |
| GET | `/v1/admin/members` | `ADMIN_TOKEN` | Daftar member, jumlah device, kiriman terakhir |
| POST | `/v1/admin/members` | `ADMIN_TOKEN` | Buat member; token dikembalikan sekali saja |
| POST | `/v1/admin/members/:id` | `ADMIN_TOKEN` | Ubah nama dan tim |
| POST | `/v1/admin/members/:id/revoke` | `ADMIN_TOKEN` | Cabut token; data lama tetap ada |
| POST | `/v1/admin/members/:id/token` | `ADMIN_TOKEN` | Token baru; token lama langsung tidak berlaku |
| GET | `/v1/admin/viewers` | `ADMIN_TOKEN` | Daftar pemegang akses dashboard |
| POST | `/v1/admin/viewers` | `ADMIN_TOKEN` | Buat pemegang akses dashboard; token dikembalikan sekali saja |
| POST | `/v1/admin/viewers/:id/revoke` | `ADMIN_TOKEN` | Cabut akses dashboard |

Token dikirim sebagai `Authorization: Bearer <token>`. Di database hanya hash SHA-256-nya yang disimpan.
Token member berawalan `mf_`, token dashboard `mfv_`; keduanya tidak bisa saling menggantikan.

Dashboard (`../dashboard/public`) disajikan sebagai file statis oleh Worker yang sama: `/` untuk
dashboard, `/admin` untuk halaman admin (buat, ubah, dan cabut token member serta akses dashboard).

Cron harian (19:00 UTC) menghapus sesi dan ringkasan harian yang lebih tua dari 92 hari.

Batas per kiriman: 256 KB, 50 sesi, 100 hari.

## Menjalankan

```bash
npm install
npm test          # memakai D1 lokal di memori, tanpa akun Cloudflare
npx wrangler d1 migrations apply manaflow --local
echo "ADMIN_TOKEN=<token admin lokal>" > .dev.vars
npm run dev       # server + dashboard di http://127.0.0.1:8787
```

## Deploy

Sudah ter-deploy di https://manaflow.manaflow-server.workers.dev (sejak 2026-10-07).

Deploy ulang setelah ada perubahan:

```bash
npx wrangler d1 migrations apply manaflow --remote   # hanya bila ada migrasi baru
npm run deploy
```

Deploy ke akun Cloudflare lain, dari nol:

```bash
npx wrangler login
npx wrangler d1 create manaflow            # salin database_id ke wrangler.toml
npx wrangler d1 migrations apply manaflow --remote
npm run deploy
npx wrangler secret put ADMIN_TOKEN        # string acak panjang; simpan di tempat aman
```

Alamat `workers.dev` yang baru butuh beberapa menit sampai sertifikat TLS-nya aktif; selama itu
koneksi gagal dengan error SSL.

Token admin produksi tidak ada di repo. Di laptop pemilik proyek ia disimpan di `server/.admin-token`
(di-ignore git).

## Belum ada

- Rate limit.
