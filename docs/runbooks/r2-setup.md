# Cloudflare R2: buckets, tokens and CORS

Plan: 01 D-06, 08 §8.8, 12 §12.4. Verified against Cloudflare docs on 2026-09-27 (V-22).

## Buckets
- One **private** bucket per environment: `regchef-dev`, `regchef-prod`. No public access, no `r2.dev` URL.
  Actual names use the `chefskak` prefix instead of the product name: dev is `chefskak-dev` (created 2026-09-27, EU, token `chefskak-dev-app`).
- Location → **Specify jurisdiction → EU**. The jurisdiction cannot be changed after creation.
- EU buckets are reached only on the EU S3 endpoint `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`, so set `R2_JURISDICTION=eu`.
- Key layout (08 §8.8): `sources/`, `assets/`, `library/`, `renders/`, `imports/`, `tmp/`. Helpers: `storageKeys` in `@rc/lib/providers/storage`.

## API tokens
R2 → Manage API tokens → Create token:
- Permission **Object Read & Write**, scoped to **one bucket** (the environment's).
- Copy the Access Key ID and Secret Access Key once. Put them in `.env` (dev), Vercel and Trigger.dev (per environment). Never in git.

| Variable | Value |
|---|---|
| `STORAGE_PROVIDER` | `r2` |
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from the bucket-scoped token |
| `R2_BUCKET` | `regchef-dev` / `regchef-prod` |
| `R2_JURISDICTION` | `eu` |

## CORS (browser uploads with presigned PUT, previews with presigned GET)
Bucket → Settings → CORS policy. App origins only:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://<preview-domain>", "https://<prod-domain>"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```
Use one bucket's policy per environment (dev: localhost + preview domains; prod: prod domain).

## Presigned URLs (facts from V-22)
- Supported: GET, PUT, HEAD, DELETE. Expiry 1 s – 7 days. Our lifetimes: `PRESIGN_TTL` (upload 15 min, source download 10 min, preview 30 min, Meta fetch 2 h).
- They work only on the S3 API domain, **not on custom domains**. If Meta rejects presigned render URLs (V-14), only `renders/` moves to a public, unguessable location (`RENDERS_PUBLIC_BASE_URL`).
- PUT signs `Content-Type` (and `Content-Length` when given); a different header gives 403. `completeSourceUpload` also checks the size with HEAD.
- Single PUT limit ≈ 5 GiB; our uploads are far smaller.
- The SDK client uses `requestChecksumCalculation: "WHEN_REQUIRED"` so presigned PUTs do not demand checksum headers from the browser.

## Live check
With a dev bucket and the variables above in `.env`:
```bash
set -a; source .env; set +a; R2_LIVE_TEST=1 pnpm vitest run lib/src/providers/storage/r2.live.test.ts
```
It runs the storage contract against R2, checks that wrong Content-Type / Content-Length uploads get 403, and deletes everything it wrote under `tmp/contract-test/`.
