# Storage API Specification

Status: **Implemented (untested), 2026-11-01.** Response envelopes follow the existing `{ success, data, message, meta }` convention.

**As built:** signed links are issued automatically inside API responses (no `POST /api/media/:id/signed-url` endpoint); query parameters are `e` (expiry), `v` (viewer), `s` (signature), TTL 900 s. Admin endpoints: only `GET /api/admin/media/health` is implemented — listing, deletion, migration report and audit queries are done with `backend/scripts/media/migrate.mjs` and MongoDB, not HTTP. Storage-full returns 507 `MEDIA_STORAGE_FULL`. Clients needed no changes: public URLs are absolute, private values arrive as signed absolute URLs (or an opaque `media:<id>` where the viewer may not open them).

Design principle: **existing upload endpoints stay exactly as they are** (paths, multipart field names, limits, response shapes). Clients need no changes for uploads. New endpoints exist only for media *delivery* and for admin/maintenance operations.

## 1. Existing upload endpoints (unchanged contract)

| Endpoint | Field(s) | Category | Response change |
|---|---|---|---|
| `PUT /api/users/profile`, `PUT /api/sellers/account-profile` | `avatar` | `customer.avatar` | `avatar` URL host changes from `res.cloudinary.com` to the media origin |
| `POST /api/users/addresses/upload-landmark` | `image` | `customer.landmark` | returns `media:<id>` ref **plus** a signed `previewUrl` for the uploader |
| `POST /api/products/:id/reviews` | `images[≤4]` | `customer.review` | none |
| `POST /api/returns` | `attachments[≤5]` | `customer.return` | attachment `url` becomes `media:<id>`; detail endpoints return signed `url` |
| `POST /api/tickets`, `POST /api/tickets/:id/messages`, admin `/tickets/:id/messages`, `/notes` | `attachments[≤5]` | `shared.ticket` | same as returns |
| `POST/PUT /api/products` | `images[≤5]` | `seller.product` | none |
| `POST /api/products/bulk/upload` | `excelFile`, `zipFile` | `seller.product` | none |
| `POST /api/products/:id/digital-file` | `file` | e-book store (unchanged) | none |
| `PUT /api/sellers/step/2,3,4` | `aadhaarFront`, `aadhaarBack`, `passbookUrl`, `pan_card`, `trade_license` | `seller.kyc` / `seller.bank` | stored values become `media:<id>`; seller-facing responses show `onFile: true` only |
| `PUT /api/sellers/profile` | `logo`, `banner` | `seller.branding` | none |
| `PUT /api/delivery/step/1,2,3` | `license`, `aadhaarFront`, `aadhaarBack`, `passbook` | `delivery.kyc` / `delivery.bank` | as seller KYC |
| `POST/PUT /api/banners` | `image` | `admin.banner` | none |
| `POST /api/admin/storefront/media` | `media` | `admin.storefront` | `{ url, type, duration? }` unchanged; video now validated not transcoded (decision D3) |
| `POST/PUT /api/categories` | `image`, `icon` | `admin.category` | none |
| `POST/PATCH /api/admin/campaigns` | `image` | `admin.campaign` | none |
| `POST /api/admin/broadcasts` | `media` | `admin.broadcast` | none |

### Upload error codes (all endpoints)

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `MEDIA_TYPE_NOT_ALLOWED` | Content type not allowed for this category |
| 400 | `MEDIA_CONTENT_MISMATCH` | Extension / declared MIME / actual bytes disagree |
| 400 | `MEDIA_INVALID` | File failed to decode (corrupt image, malformed PDF/MP4) |
| 400 | `MEDIA_VIDEO_UNSUPPORTED` | Video not H.264 MP4/WebM, longer than 15 s or wider than 1280 px |
| 413 | `MEDIA_TOO_LARGE` / `MEDIA_TOO_MANY` | Size or count limit |
| 400 | `MEDIA_UPLOAD_INTERRUPTED` | Client disconnected / timeout; safe to retry with the same `Idempotency-Key` |
| 507 | `MEDIA_STORAGE_FULL` | Free space below the reserve threshold; upload refused before writing |
| 503 | `MEDIA_STORAGE_UNAVAILABLE` | Storage root missing / not writable |

Messages are user-readable and never contain paths, keys or provider details.

## 2. New delivery endpoints

### `GET /media/{category}/{yyyy}/{mm}/{file}` — public media
- No auth. Only files under `MEDIA_ROOT/public`. Name must match `^[0-9a-f-]{36}\.(webp|jpg|png|mp4|webm)$`.
- `200`/`206` with `Accept-Ranges: bytes`, `Content-Type` from the `Media` record / extension whitelist, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`.
- `404` for anything else (never `index.html`). No directory listing.
- Optional: media in `replaced`/`deleted` status return 410 after the grace period.

### `GET /api/media/:id` — private media with bearer auth
- `protect` middleware → `mediaAccess.authorize(viewer, media)` per category policy.
- `200`/`206`, `Cache-Control: private, no-store`, `Content-Disposition: inline; filename="<sanitised original>"` for images, `attachment` for PDF unless `?inline=1` and the viewer is admin.
- Every `private-kyc` read writes a `MediaAccessAudit` entry `{ mediaId, viewerId, viewerRole, purpose, ip, userAgent, at }`.
- `403` unauthorised, `404` unknown or not visible to the viewer (do not reveal existence across tenants: prefer `404` for cross-owner requests).

### `POST /api/media/:id/signed-url` — short-lived link
- Body: `{ purpose: 'review' | 'download' }`. Same authorisation as above; audit entry written here.
- Returns `{ url: '/media/s/<id>?exp=<unix>&v=<viewerId>&sig=<hmac>', expiresAt }`. TTL default 300 s, max 900 s.
- Signature: `HMAC-SHA256(MEDIA_SIGNING_SECRET, id|exp|viewerId|purpose)`.

### `GET /media/s/:id?exp&v&sig` — signed delivery
- No bearer header required (works in `<img>` and new tabs). Rejects expired or tampered signatures with `403`. Same headers as private delivery.

Serializers (admin seller/rider dossiers, return detail, ticket detail, order detail for rider/seller) call the signer directly and embed signed URLs, so the admin UI keeps using `url` fields with no client change other than tolerating `url: null, onFile: true`.

## 3. Admin and maintenance endpoints (admin only)

| Endpoint | Permission | Purpose |
|---|---|---|
| `GET /api/admin/media/health` | `superAdmin` | Root writable, free bytes, free %, `.tmp` size, provider flags per category, last backup marker age |
| `GET /api/admin/media?category=&owner=&status=` | `superAdmin` | Paginated metadata (never keys/paths) |
| `DELETE /api/admin/media/:id` | `superAdmin` | Soft delete (`status: deleted`); file removed by cleanup job after grace period |
| `GET /api/admin/media/migration/report` | `superAdmin` | Per-category counts: pending / copied / verified / cutover / failed |
| `GET /api/admin/media/audit?mediaId=&viewer=` | `superAdmin` | KYC view audit trail |

There is deliberately **no** generic "upload any file" endpoint; uploads only happen through the feature endpoints so each one keeps its business validation and ownership checks.

## 4. Client changes required

| Client | Change |
|---|---|
| `frontend` (all modules) | Extend the existing `/uploads/` → `apiUrl()` special case to `/media/` where `MEDIA_PUBLIC_BASE_URL` is relative; admin KYC viewers and return/ticket attachment views must handle `url: null, onFile: true` and refresh signed URLs on 403. |
| `mobile-user` | Same in [`mediaUrl`](../mobile-user/src/api/client.js#L20). No upload code changes. |
| `mobile-seller` | Already shows KYC as "on file" only ([KycDetailsScreen.js:12](../mobile-seller/src/screens/profile/KycDetailsScreen.js#L12)); no change. Ticket attachment view handles signed URLs. |
| Older installed app versions | Keep working: public URLs are absolute HTTPS; private fields they display (ticket/return attachments) receive signed absolute URLs from the server. |
