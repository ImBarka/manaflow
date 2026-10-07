# server

Cloudflare Worker (API) dan skema D1.

## Endpoint

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/v1/health` | — | Cek server hidup |
| POST | `/v1/ingest` | Token member | Terima sesi dan ringkasan harian dari satu device |
| GET | `/v1/dashboard?from&to` | Token dashboard | Agregat tim untuk rentang tanggal |
| GET | `/v1/sessions?member&from&to` | Token dashboard | Daftar sesi satu member (maks 500) |
| POST | `/v1/admin/members` | `ADMIN_TOKEN` | Buat member; token dikembalikan sekali saja |
| POST | `/v1/admin/viewers` | `ADMIN_TOKEN` | Buat pemegang akses dashboard; token dikembalikan sekali saja |

Token dikirim sebagai `Authorization: Bearer <token>`. Di database hanya hash SHA-256-nya yang disimpan.
Token member berawalan `mf_`, token dashboard `mfv_`; keduanya tidak bisa saling menggantikan.

Dashboard (`../dashboard/public`) disajikan sebagai file statis oleh Worker yang sama, di alamat `/`.

Membuat member dan pemegang akses (belum ada halaman admin):

```bash
curl -X POST <url>/v1/admin/members -H "authorization: Bearer <ADMIN_TOKEN>" \
  -H "content-type: application/json" -d '{"name":"Nama","team":"data"}'
curl -X POST <url>/v1/admin/viewers -H "authorization: Bearer <ADMIN_TOKEN>" \
  -H "content-type: application/json" -d '{"name":"Nama lead"}'
```

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

- Cabut token member dan token dashboard.
- Hapus otomatis data di atas 3 bulan.
- Rate limit.
