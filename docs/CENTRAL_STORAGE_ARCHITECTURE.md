# Central Storage Architecture

Status: **Implemented (untested), 2026-11-01.** File-by-file summary in [STORAGE_IMPLEMENTATION_REPORT.md](STORAGE_IMPLEMENTATION_REPORT.md).

**As built — differences from the design below:**
- Decisions: D1 `/var/lib/bulkimart` on the root disk (approved); D2 single PM2 fork instance (verified); D3 validate, don't transcode (ffmpeg absent); D4 Cloudinary kept until cleanup approval; D5 delivery proof not built; D6 same API origin (`https://api.bulkimart.in/media/...`), not a separate subdomain.
- Private references are resolved centrally for **every JSON API response** (`mediaResponse` middleware) instead of per serializer, so no client or serializer changes were needed. Non-KYC private media is signed for the authenticated viewer the endpoint served; KYC only for admins or the owner.
- The direct bearer route `GET /api/media/:id` allows only the owner or an admin (prevents ID guessing).
- Client echoes of media values are normalised after authentication (`normalizeMediaInput`).
- No upload de-duplication (it would make failed-upload cleanup unsafe); migration de-duplicates by legacy URL.
- `Media` fields: `storageKey`, `uploadStatus` (`stored`/`deleted`), `migrationStatus` (`not_applicable`/`verified`/`quarantined`), `legacy.{url,publicId,resourceType,sizeBytes}`.
- Category directories are fixed in the policy table, not overridable by env.

Inventory IDs (C1, S4, A3 …) refer to [PLATFORM_STORAGE_AUDIT.md](PLATFORM_STORAGE_AUDIT.md).

## 1. Goals and constraints

- One storage service for every upload; controllers never touch the filesystem or a provider SDK directly.
- Files live on our server in a persistent directory **outside** the repository and deploy directory.
- Public and private media are separated on disk and in routing.
- Existing Cloudinary URLs keep working throughout (dual read). No order, return, payout or ledger document is rewritten.
- Minimal client change: existing multipart endpoints and field names stay the same.
- Follows existing backend conventions: ESM, `services/*.service.js`, `httpError`/`fail`, `ok`/`created` responses, env-driven config with production refusal (as in `ebookStorage.service.js`).

## 2. Components

| Module (proposed path) | Responsibility |
|---|---|
| `backend/config/storage.js` | Reads and validates `MEDIA_*` env vars once at startup; refuses to run in production with a missing root, a root inside the repo/deploy tree, or one inside a public web directory. |
| `backend/services/mediaStorage.service.js` | Disk driver: `put(stream) → {key, sha256, size}`, `open(key, range)`, `remove(key)`, `stat(key)`. Atomic writes (temp → fsync → rename), path containment, no symlinks. Only module that knows filesystem paths. |
| `backend/services/mediaValidation.service.js` | Content sniffing (magic bytes), extension/MIME/content agreement, size and count limits per category, image decode + dimension limit + re-encode via `sharp` (already a dependency), PDF structure check (reuse `validateEbookPdf`), MP4/WebM container check and MP4 header parsing for duration/codec/width. |
| `backend/services/media.service.js` | Business API: `storeUpload({file, category, owner, entity})`, `replace`, `remove`, `resolveForViewer(ref, viewer)`, `signedUrl(mediaId, viewer, ttl)`. Creates `Media` records, applies the category policy table (§4). |
| `backend/services/mediaAccess.service.js` | Authorization policies per category (owner / related-party / admin permission) and audit logging of private views. |
| `backend/services/mediaUrl.service.js` | Read-time URL resolution: `/api/media/<id>` refs → public URL or short-lived signed URL; legacy Cloudinary URLs → migrated equivalent when the map says so, otherwise unchanged. |
| `backend/models/Media.js` | Metadata record (§5). |
| `backend/models/MediaAccessAudit.js` | Append-only log of private-media views (pattern of existing `DigitalDownloadAudit`). |
| `backend/routes/media.routes.js` | Delivery endpoints (see API spec). |
| `backend/middlewares/upload.middleware.js` | Kept; switched from `memoryStorage` to a disk-backed temp storage under `MEDIA_ROOT/.tmp` for large categories. Existing export names stay. |
| `backend/scripts/media/*.mjs` | Inventory, copy, verify, report, orphan-scan scripts for Phase 9 (dry-run by default). |

`cloudinary.service.js` stays during migration. Its exported `uploadToCloudinary(buffer, folder, options)` and `uploadFileWithMeta()` become thin adapters that call `media.service` when the folder's category is switched to `server` (§6). This lets every existing call site move without editing 13 controllers at once, and lets each category be switched and rolled back independently.

## 3. Directory layout

```
${MEDIA_ROOT}/                     e.g. /var/lib/bulkimart/media  (0750, owned by service user)
  public/                          product, review, branding, category, banner, campaign, storefront, broadcast
    <category>/<yyyy>/<mm>/<uuid>.<ext>
  private/                         KYC, bank, returns, tickets, landmarks       (0700)
    <category>/<yyyy>/<mm>/<uuid>.<ext>
  .tmp/                            in-flight uploads, swept after 24 h
${EBOOK_STORAGE_DIR}               unchanged (already server-private)
${SERVICE_STORAGE_DIR}             unchanged
```

- File names are random UUIDs plus a server-chosen extension. Original names are only stored in MongoDB metadata.
- Owner IDs are **not** part of the path (avoids leaking IDs and makes ownership changes a metadata-only operation). Ownership lives in `Media.ownerId`.
- Category directory names come from the policy table and can be overridden by config; clients never see paths.
- The e-book and service stores keep their own modules and directories in phase 1 of implementation; folding them into `media.service` is optional later work, not a requirement, because they already meet the security bar.

## 4. Category policy table

Single source of truth, in code, used by validation, routing and authorization.

| Category key | Inventory | Visibility | Allowed content | Max size / count | Processing | Read access |
|---|---|---|---|---|---|---|
| `customer.avatar` | C1, S8 | public | JPEG, PNG, WebP | 5 MB / 1 | re-encode WebP, strip metadata, ≤ 1024 px | anyone |
| `customer.landmark` | C2 | private | JPEG, PNG, WebP | 5 MB / 1 | re-encode, **strip EXIF/GPS**, ≤ 2048 px | owner, admin, seller & rider on an order that snapshots it |
| `customer.review` | C3 | public | JPEG, PNG, WebP | 5 MB / 4 | re-encode, strip metadata | anyone (approved reviews) |
| `customer.return` | C4 | private | JPEG, PNG, WebP, PDF | 5 MB / 5 | images re-encoded | customer, seller of the line, admin (`manage_orders`/returns) |
| `shared.ticket` | C5, S9, D4, A7 | private | JPEG, PNG, WebP, PDF | 5 MB / 5 | images re-encoded | requester, admin (tickets); internal-note files admin-only |
| `seller.product` | S1, S2 | public | JPEG, PNG, WebP (SVG rasterised to PNG) | 5 MB / 5 | re-encode, strip metadata | anyone (live products) |
| `seller.branding` | S7 | public | JPEG, PNG, WebP | 5 MB / 1 each | re-encode | anyone |
| `seller.kyc` | S4, S6 | private-kyc | JPEG, PNG, PDF | 5 MB | images re-encoded; PDF structure check | owner may see "on file" only; admin with seller permission via signed URL; every view audited |
| `seller.bank` | S5 | private-kyc | same | 5 MB | same | as above + finance permission |
| `delivery.kyc` | D1, D2 | private-kyc | same | 5 MB | same | admin with rider permission; audited |
| `delivery.bank` | D3 | private-kyc | same | 5 MB | same | as above + finance |
| `admin.banner` | A1 | public | JPEG, PNG, WebP | 5 MB | re-encode | anyone |
| `admin.storefront` | A2, A3 | public | images; MP4 (H.264) / WebM | 5 MB image, 15 MB video | images → WebP; video validated, **not** transcoded (decision D3) | anyone |
| `admin.category` | A4 | public | JPEG, PNG, WebP, SVG (icon) | 5 MB | SVG rasterised to PNG with `sharp` | anyone |
| `admin.campaign` | A5 | public | JPEG, PNG, WebP | 5 MB | re-encode | anyone |
| `admin.broadcast` | A6 | public | JPEG, PNG | 5 MB | re-encode JPEG/PNG (FCM-safe) | anyone (must be fetchable by FCM) |
| `delivery.proof` (reserved) | — | private | JPEG, PNG, WebP | 5 MB | strip GPS? (product decision) | not wired: feature does not exist |

Re-encoding images through `sharp` is the main content-safety control: it proves the file decodes as an image, drops embedded payloads and metadata, and lets us serve a known MIME type.

## 5. `Media` record

```js
{
  _id: ObjectId,                 // the public media ID
  key: String,                   // storage key "public/seller.product/2026/11/<uuid>.webp" (select:false, never returned)
  provider: 'server' | 'cloudinary',
  category: String,              // policy key from §4
  visibility: 'public' | 'private' | 'private-kyc',
  mimeType: String, sizeBytes: Number, sha256: String,
  width: Number, height: Number, durationSec: Number,     // when applicable
  originalName: String,          // sanitised, display only
  ownerId: ObjectId, ownerRole: 'customer'|'seller'|'delivery'|'admin',
  entity: { kind: String, id: ObjectId },                 // e.g. { kind: 'Seller', id } once attached
  status: 'uploading'|'stored'|'attached'|'replaced'|'deleted'|'quarantined',
  legacy: { url: String, publicId: String, resourceType: String },  // Cloudinary source when migrated
  migration: { status: 'pending'|'copied'|'verified'|'cutover'|'failed', verifiedAt: Date, error: String },
  createdAt, updatedAt, deletedAt
}
```

Indexes: `{ sha256: 1, ownerId: 1 }` (dedupe), `{ 'legacy.url': 1 }` unique sparse (migration map), `{ status: 1, updatedAt: 1 }` (cleanup), `{ entity.kind: 1, entity.id: 1 }`.

### How existing string fields reference new media

Existing schemas store plain URL strings (`Product.images[]`, `Seller.aadhaar.frontUrl`, …). To avoid schema changes and keep old clients working:

- **Public media:** the string becomes the stable public URL `${MEDIA_PUBLIC_BASE_URL}/media/<key-without-visibility>`. Clients render it unchanged. If `MEDIA_PUBLIC_BASE_URL` is empty, a relative `/media/...` path is stored and the existing `apiUrl()` / `mediaUrl()` client helpers (which already special-case `/uploads/`) are extended to `/media/`.
- **Private media:** the string becomes the opaque reference `media:<mediaId>`. It is never a fetchable URL. Every serializer that returns a private field (admin dossiers, return detail, ticket detail, order landmark) passes it through `mediaUrl.service.resolveForViewer()`, which returns a short-lived signed URL only if the viewer is authorised, else `null` + an `onFile: true` flag.
- **Legacy Cloudinary strings** pass through unchanged until their category is cut over, after which `resolveForViewer()` maps them through `Media.legacy.url` at read time. The stored document is untouched (required for orders/returns snapshots).

## 6. Rollout switch

`MEDIA_PROVIDER_<CATEGORY>` (or one JSON `MEDIA_PROVIDERS` map) chooses `cloudinary` or `server` per category for **new uploads**. Defaults to `cloudinary` so deploying the code changes nothing. Rollback = flip the flag; uploads made on the server while switched on remain readable because reads never depend on the flag.

The silent `saveLocally` fallback is **removed** once `server` is available: a failed upload returns a clear 503 instead of producing a broken `/uploads/` link (see security report F3).

## 7. Upload pipeline

1. Route-level Multer (existing field names/limits) writes parts to `MEDIA_ROOT/.tmp` (disk storage) for categories over 5 MB; small images may stay in memory.
2. `mediaValidation` sniffs the bytes, checks extension/MIME/content agree, enforces policy limits, and processes (re-encode/rasterise/validate video header).
3. `mediaStorage.put` hashes while writing to `.tmp/<uuid>.partial`, fsyncs, renames into `public/` or `private/`. Same filesystem, so rename is atomic.
4. `Media` document created with `status: 'stored'`; controller saves the URL/ref on its entity; `status` → `attached`.
5. On any failure after step 3, the stored file and record are removed (generalises `removeFailedProductUploads`).
6. Replacement marks the old `Media` `replaced`; the file is deleted by the cleanup job after a grace period (default 7 days) so a rollback or in-flight page can still display it.

**Idempotency/retry:** clients already send `Idempotency-Key` on returns; the same header is honoured on all upload routes. Duplicate content from the same owner (same SHA-256) returns the existing media record instead of storing twice.

**Large files:** current maxima (50 MB ZIP, 25 MB e-book, 15 MB video) do not justify resumable/chunked upload. Disk-backed Multer plus client retry is sufficient. Revisit if the e-book cap is raised above ~100 MB (tus-style resumable upload would then be warranted).

## 8. Delivery

- **Public:** `GET /media/<category>/<yyyy>/<mm>/<file>` — served by Node (`fs.createReadStream` with range support) or, preferably, by Nginx `location /media/ { alias ${MEDIA_ROOT}/public/; }` with `autoindex off`, long-lived `Cache-Control: public, max-age=31536000, immutable` (names are content-unique), `X-Content-Type-Options: nosniff`.
- **Private:** `GET /api/media/:id` (bearer auth) or `GET /media/s/:id?exp=&sig=` (HMAC-signed, 5-minute TTL, for `<img>`/`<a>` tags that cannot send headers). `Cache-Control: private, no-store`, `Content-Disposition: inline` for images / `attachment` for PDFs, `nosniff`, range support. Optionally Nginx `X-Accel-Redirect` to an `internal` location after Node authorises.
- **Video:** HTTP range requests (206) required for seeking; served from the public path.
- `/uploads/*` legacy paths: a small handler that serves any existing `backend/uploads` files only after they have been moved into `MEDIA_ROOT/public` by migration; until then the SPA catch-all must not swallow `/uploads` and `/media` (return 404 instead of `index.html`).

## 9. Decisions needed before implementation

| # | Decision | Recommendation |
|---|---|---|
| D1 | Host and persistent volume (Section 15 gate) | See infrastructure doc. Blocking. |
| D2 | Single backend instance? | Local disk only works with one instance or a shared mount. Confirm PM2 runs one process (not cluster mode on multiple machines). |
| D3 | Storefront video transcoding | **Validate, don't transcode:** accept only MP4/H.264 (or WebM) ≤ 15 s, ≤ 1280 px, checked by parsing the container header in JS. No ffmpeg dependency. Admins export compliant clips. Alternative: install ffmpeg and transcode in a background job — only if the host allows it and admins need WebM→MP4 conversion. |
| D4 | Historical snapshot URLs (audit §4) | Keep Cloudinary on a free/read-only plan until a read-time map covers every serializer, then decide. |
| D5 | Delivery proof photos | Not existing; out of scope unless product approves a new feature. |
| D6 | Public media domain | `media.bulkimart.<tld>` subdomain (cookie-less, separate origin for safety) vs same origin `/media`. Subdomain recommended. |
