# Storage Migration Test Plan

Status: **Plan — no tests have been run.** All execution happens on staging from a trusted machine. Results are recorded in [STORAGE_WORKFLOW_CHECKLIST.md](STORAGE_WORKFLOW_CHECKLIST.md); a workflow is marked verified only with evidence (test output, screenshots, log excerpts).

## 1. Environments

- Staging backend with its own `MEDIA_ROOT` on a volume of the same type as production, `MEDIA_PROVIDERS` flags, a staging MongoDB restored from a sanitised production backup, and a **separate Cloudinary folder or account** for any test writes.
- Clients: customer web, admin web, seller web, delivery web (all in `frontend`), `mobile-user` debug build, `mobile-seller` debug build, plus the **currently released** Play Store builds of both apps (backward compatibility).

## 2. Automated backend tests (to add with implementation)

| Area | Cases |
|---|---|
| `mediaValidation` | JPEG/PNG/WebP accepted; renamed `.exe`→`.jpg` rejected; PNG declared as JPEG rejected; SVG rejected for avatar, rasterised for category icon; polyglot (JPEG + HTML) re-encoded clean; decompression bomb (huge dimensions) rejected; truncated PDF rejected; MP4 > 15 s / non-H.264 / > 1280 px rejected; WebM accepted |
| `mediaStorage` | path traversal keys (`../`, absolute, encoded, NUL) rejected; symlink target refused; atomic write leaves no file on simulated crash; hash verified on read; ENOSPC → `MEDIA_STORAGE_FULL` and no partial file; root inside repo refused in production mode |
| `mediaAccess` | policy matrix in §4 as table-driven tests |
| Signed URLs | valid; expired; tampered sig; viewer ID swapped; purpose swapped |
| Delivery routes | range requests (`bytes=0-`, `bytes=100-199`, suffix, invalid → 416); `nosniff`/CSP/cache headers; `/media/../` 404; unknown file 404 not `index.html` |
| Adapter | `uploadToCloudinary` with category flag `cloudinary` unchanged behaviour (existing tests stay green); with `server` writes to disk + `Media` |
| Existing suites | `backend/__tests__` and `backend/verification` that reference Cloudinary updated to cover both providers |

## 3. Functional matrix (per workflow, per client)

Run for every inventory row (C1–C6, S1–S9, D1–D4, A1–A8) on each client that has it:

| # | Case | Expected |
|---|---|---|
| 1 | Small image (≈100 KB) | Stored, displayed, correct MIME |
| 2 | Large image (≈4.9 MB, 6000×4000) | Stored, resized to category max, displayed |
| 3 | Five product images (S1) | All five stored in order; listing shows them |
| 4 | PDF (KYC, returns, tickets) | Stored privately; admin can open via signed link |
| 5 | E-book (S3) 25 MB | Unchanged private flow; purchase download works |
| 6 | Storefront video 15 MB (A3) | Accepted if compliant; plays and seeks on Chrome, Safari iOS, Android WebView |
| 7 | Unsupported type (`.exe`, `.html`, `.svg` where disallowed) | 400 `MEDIA_TYPE_NOT_ALLOWED`, clear message in UI |
| 8 | Wrong MIME (PNG bytes named `.jpg`) | 400 `MEDIA_CONTENT_MISMATCH` |
| 9 | Oversized (5 MB + 1 byte) | 413, clear message, form still usable |
| 10 | Interrupted upload (kill network mid-upload on phone) | No partial file on disk after sweep; retry succeeds |
| 11 | Retry with same `Idempotency-Key` | Single stored file/record |
| 12 | Duplicate upload (same bytes, same owner) | Deduplicated record |
| 13 | Replacement (logo, banner, avatar, KYC re-upload where allowed) | New file shown; old marked `replaced`; deleted after grace period |
| 14 | Deletion (product image removal, banner delete) | Not served after grace period; no orphan file |
| 15 | Upload progress and cancel (mobile-seller has `onProgress`) | Progress moves; cancel leaves nothing behind |

## 4. Authorization matrix

| Case | Expected |
|---|---|
| Anonymous → private media URL / ID | 401/404 |
| Customer A → Customer B's landmark, return, ticket attachment | 404 |
| Seller A → Seller B's KYC, bank, return attachments of B's orders | 404 |
| Seller → return attachment for own order line | 200 |
| Rider → landmark of order assigned to them | 200; after reassignment/completion → 404 |
| Rider → another rider's KYC | 404 |
| Admin without seller permission → seller KYC | 403 |
| Admin with permission → seller KYC | 200 via signed URL, audit row written |
| Customer/seller → admin internal-note attachment | 404 |
| Expired / tampered signed URL | 403 |
| Unpaid customer → e-book download | Existing entitlement denial unchanged |
| Directory listing `/media/`, `/media/public/` | 404 |

## 5. Platform behaviour

| Case | Expected |
|---|---|
| Disk full (fill a test volume to the reserve threshold) | 507 `MEDIA_STORAGE_FULL`; no partial writes; alert fired; reads still work |
| Storage root unmounted | 503 on upload; health endpoint red; app otherwise up |
| Backend redeploy (`deploy.sh` equivalent) | All media still present and served |
| Server reboot | Same |
| Backup restore to a fresh volume | Hash check of a sample + full count match |
| Concurrent uploads (20 parallel 5 MB) | Memory stays bounded; no 5xx |
| Reverse proxy limits | 50 MB bulk ZIP passes the proxy; 60 s+ slow upload not cut off |

## 6. Compatibility

| Case | Expected |
|---|---|
| Old Cloudinary product/banner/category images | Still display on all clients |
| Old orders (item images, landmark snapshot) | Display unchanged (or via read map) |
| Old seller/rider KYC in admin dossiers | Viewable by authorised admin |
| Old return/ticket attachments | Viewable by permitted parties |
| Released Play Store builds of `mobile-user` and `mobile-seller` | All upload and view flows work against new backend |
| Storefront Studio | Draft, publish, rollback, scheduling unchanged with server media |
| Push broadcast with image | Image renders in Android notification (FCM fetches public URL) |
| Image search | Products with server-hosted images are indexed and found |

## 7. Migration verification (Phase 9)

- Inventory counts reconcile: DB references = copied + failed + external-left-as-is.
- 100% hash + size verification; zero `failed` without an accepted reason.
- Sampled visual check ≥ 20 per category.
- Rollback rehearsal: cut over one category on staging, roll back via `mediamigrationlog`, confirm original values.

## 8. Sign-off

Each application (customer web, customer Android, seller web, seller Android, delivery web, admin) is signed off separately by a named tester with date and evidence link in the checklist.
