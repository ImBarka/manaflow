# server

Cloudflare Worker (API) dan skema D1.

## Endpoint

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/v1/health` | — | Cek server hidup |
| POST | `/v1/ingest` | Token member | Terima sesi dan ringkasan harian dari satu device |
| POST | `/v1/admin/members` | `ADMIN_TOKEN` | Buat member; token dikembalikan sekali saja |

Token dikirim sebagai `Authorization: Bearer <token>`. Di database hanya hash SHA-256-nya yang disimpan.

Batas per kiriman: 256 KB, 50 sesi, 100 hari.

## Menjalankan

```bash
npm install
npm test          # memakai D1 lokal di memori, tanpa akun Cloudflare
npm run dev       # server lokal
```

## Deploy (belum pernah dijalankan)

```bash
npx wrangler login
npx wrangler d1 create manaflow            # salin database_id ke wrangler.toml
npx wrangler d1 migrations apply manaflow --remote
npx wrangler secret put ADMIN_TOKEN
npm run deploy
```

## Belum ada

- Endpoint baca untuk dashboard dan token dashboard.
- Cabut token member.
- Hapus otomatis data di atas 3 bulan.
- Rate limit.
