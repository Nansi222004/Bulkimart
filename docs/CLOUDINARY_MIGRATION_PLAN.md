# Cloudinary Migration Plan

Status: **Plan — nothing executed.** Every step below that touches a database, Cloudinary or a server runs on staging first, from a trusted machine (not the PolinRider-affected installation), and production steps need explicit backend-owner approval.

Sequence (per category): **INVENTORY → COPY → VERIFY → DUAL READ → CUTOVER → MONITOR → RETENTION REVIEW → APPROVED CLEANUP.**

## 0. Preconditions (gate)

- [ ] Infrastructure gate passed ([STORAGE_INFRASTRUCTURE_REQUIREMENTS.md](STORAGE_INFRASTRUCTURE_REQUIREMENTS.md)): persistent volume, capacity, backups with a tested restore.
- [ ] Storage service, validation, delivery routes and access control implemented and passing the test plan on staging.
- [ ] Open decisions D2–D6 in the architecture doc answered.
- [ ] Fresh MongoDB backup taken and restore-tested (existing `backupBulkimartTarget.mjs` pattern).

## 1. Order of categories

Ordered by risk reduction first, then by ease:

| Wave | Categories | Why first |
|---|---|---|
| 1 | Stop the bleeding: flip **new** uploads to server for `seller.kyc`, `seller.bank`, `delivery.kyc`, `delivery.bank` | Largest exposure (security F1/F2). Few clients affected (admin dossier viewer). |
| 2 | `customer.landmark`, `customer.return`, `shared.ticket` (new uploads) | Private PII. |
| 3 | `seller.product`, `customer.review`, `seller.branding`, `customer.avatar` | High volume, public; needs image-search origin added first. |
| 4 | `admin.*` (banners, storefront images, categories, campaigns, broadcast) | Low volume; verify Studio draft/publish/rollback/scheduling. |
| 5 | `admin.storefront` video | After decision D3 (validate vs transcode). |
| 6 | Backfill existing assets for all categories (§3) | After new uploads are stable. |

Each wave: deploy with flag off → enable on staging → test → enable in production → monitor 7 days → next wave.

## 2. Inventory (read-only)

Script `backend/scripts/media/inventory.mjs` (dry-run only; writes a JSON/CSV manifest outside the repo):

For each source field in the audit inventory, list `{collection, docId, fieldPath, url, provider, category, ownerId, ownerRole}`:

| Collection | Field paths |
|---|---|
| `users` | `avatar`, `addresses[].landmarkImage` |
| `sellers` | `aadhaar.frontUrl/backUrl`, `bankDetails.passbookUrl`, `documents[].url`, `storeDetails.logo/banner` |
| `deliverypartners` | `drivingLicense.url`, `aadhaar.frontUrl/backUrl`, `bankDetails.passbookUrl` |
| `products` | `images[]`, `reviews[].images[]` |
| `returns` | `attachments[].url` (+ `publicId`) ; `productImage` (snapshot, map-only) |
| `tickets`, `ticketmessages` | `attachments[].url` (+ `publicId`) |
| `banners` | `image`, `mobileImage`, `video`, `mobileVideo` |
| `storefrontexperiences` | every media URL inside config (walk the document; validated by `mediaUrl()` in `storefrontPolicy.service.js`) |
| `categories` | `image`, `icon` |
| `campaigns` | `bannerImage` |
| `notificationbroadcasts` | `media.url` |
| `notifications` | `media.url` (snapshot, map-only) |
| `orders` | `items[].image`, `deliveryAddress.landmarkImage` (snapshot, map-only) |
| `packagingmaterials`, `packagingpackages`, `sellerpromotions`, `rationpackages` | `image` / `bannerImage` (legacy) |

Also:
- Cloudinary Admin API listing of `nhcone/` (image, video, raw) for size, format and orphan detection (assets with no DB reference). Read-only.
- `backend/uploads/` on the production server (fallback files, possibly lost on earlier deploys) — list only.
- Classify URLs: `res.cloudinary.com/<our cloud>`, `/uploads/...`, other external HTTPS (e.g. pasted Studio URLs — **left as-is**, not ours to copy), dead links.

Output: per-category counts, total bytes, expected disk need (feeds capacity check), list of DB references pointing at missing assets.

## 3. Copy and verify

Script `backend/scripts/media/copy.mjs --category <key> [--limit N] [--apply]`:

1. For each unique source URL (dedupe — snapshots point at the same asset as the live field):
   - Download the **original** asset (Cloudinary URL without transformations), stream to `.tmp`, compute SHA-256 and size.
   - Compare size with Cloudinary `bytes`. Mismatch → `migration.status = failed`.
   - Apply the same validation as new uploads, but **no re-encoding** of legacy files (bit-for-bit copy keeps the hash meaningful). Files failing validation (e.g. SVG stored as `.jpg` by old fallback) are quarantined for manual review, not served.
   - Atomic move into `public/` or `private/`; re-read and re-hash from disk; must match.
   - Upsert `Media { provider:'server', legacy.url, legacy.publicId, sha256, sizeBytes, migration.status:'verified' }`.
2. Idempotent and resumable: skips URLs already `verified`.
3. Rate-limited and resumable; logs never contain signed URLs or credentials.
4. Display check: automated decode of every copied image with `sharp`; MP4 header parse for videos; PDF header/trailer check. A sampled visual check (≥ 20 per category) by a person on staging.

## 4. Dual read

- `mediaUrl.service` resolves any stored string: server ref → server URL; Cloudinary URL with a `verified` mapping → server URL; anything else → returned unchanged.
- Apply in serializers category by category behind `MEDIA_READ_MAP_<CATEGORY>=on`. Off = original URLs (instant rollback).
- Snapshot fields (orders, returns `productImage`, notifications) are **only ever mapped at read time**; the stored values are never changed.

## 5. Cutover (live, non-snapshot fields only)

For each live field whose asset is `verified` and has been served via dual read without errors for 7 days:
- Write the new URL/ref into the field with a guarded update (`{_id, field: <old value>}` → only if unchanged, so concurrent user edits win).
- Record `{collection, docId, fieldPath, oldValue, newValue, at}` in a `mediamigrationlog` collection — the rollback source.
- Rollback script restores `oldValue` where the current value still equals `newValue`.
- Order, return, payout, ledger and settlement documents are **excluded** by construction.

## 6. Monitor

- 404/403/5xx rate on `/media` and `/api/media` per category.
- Image-search index failures (needs the media origin in `IMAGE_SEARCH_CATALOG_ORIGINS` or a storage-reading indexer before wave 3).
- FCM delivery with image (wave 4).
- Disk usage trend vs projection.
- Daily orphan report (files without `Media`, `Media` without files).

## 7. Retention review and approved cleanup

Cloudinary deletion happens only when **all** of these hold, per category, and the backend owner signs off in writing:

- [ ] 100% of referenced assets `verified`; failures resolved or explicitly accepted.
- [ ] Dual read + cutover live ≥ 30 days without media errors.
- [ ] Private access controls tested (test plan §4).
- [ ] Server backups include the category and a restore was tested.
- [ ] Snapshot fields: read-time map covers every serializer that returns them, **or** the owner explicitly accepts losing historical images (decision D4).

Cleanup order: KYC/bank copies first (they are a liability while public), then private PII, then public media, then orphans. Deletion via Cloudinary Admin API by `publicId`, logged, in small batches.

## 8. Cloudinary retirement (Phase 11)

After every category is cleaned up or explicitly retained:
1. Remove `uploadToCloudinary`/`uploadFileWithMeta` adapters' Cloudinary branch, `productUploadCleanup` Cloudinary branch, storefront video SDK call, `config/cloudinary.js` startup validation, `seed/checkCloudinary.js`.
2. Remove the `cloudinary` npm dependency (on a trusted machine).
3. Keep legacy URL *reading* (`mediaUrl.service` map) as long as any snapshot still references Cloudinary.
4. Remove `CLOUDINARY_*` env vars from servers, then revoke the API key — only after explicit approval and a week with no Cloudinary API calls in logs.
5. Update tests that mock Cloudinary (audit X5).

## 9. Rollback summary

| Stage | Rollback |
|---|---|
| New uploads on server | Flip `MEDIA_PROVIDER_<CATEGORY>` back to `cloudinary`; server-stored uploads remain readable. |
| Dual read | Flip `MEDIA_READ_MAP_<CATEGORY>` off. |
| Cutover | Run rollback from `mediamigrationlog`. Cloudinary originals still exist. |
| Cleanup | **Irreversible** — hence the approval gate and backup requirement. |
