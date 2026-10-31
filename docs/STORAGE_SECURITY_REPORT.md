# Storage Security Report

Status: **Findings from static review of current code + required controls for the new design.** No exploit testing was performed; nothing was executed.

## 1. Findings in the current system

| # | Severity | Finding | Evidence | Fix in new design |
|---|---|---|---|---|
| F1 | **High** | All KYC and bank documents (Aadhaar front/back, PAN, trade licence, bank passbooks, driving licences) are stored on Cloudinary with the default public `upload` delivery type. Anyone with the URL can open them without authentication; URLs are returned in admin dossier API responses. | [cloudinary.service.js:137](../backend/services/cloudinary.service.js#L137) (no `type: 'authenticated'`); [admin.controller.js:177-183](../backend/controllers/admin.controller.js#L177-L183), [:951-955](../backend/controllers/admin.controller.js#L951-L955); acknowledged in [KycDetailsScreen.js:12](../mobile-seller/src/screens/profile/KycDetailsScreen.js#L12) | `private-kyc` category, `media:<id>` refs, signed 5-minute URLs, audited views. Migration should prioritise these. |
| F2 | **High** | The "sensitive folder" guard misses `seller-docs` (PAN, trade licence) and `delivery-bank` (rider bank passbook). On Cloudinary failure these PII documents fall back to `backend/uploads/` on local disk. | [cloudinary.service.js:55-59](../backend/services/cloudinary.service.js#L55-L59) vs folders at [seller.controller.js:281](../backend/controllers/seller.controller.js#L281), [deliveryPartner.controller.js:225](../backend/controllers/deliveryPartner.controller.js#L225) | Visibility comes from the category policy table, not a folder-prefix list. Independently of migration, adding the two prefixes is a one-line hotfix worth doing now. |
| F3 | Medium | Silent local fallback writes into the deploy directory and returns `/uploads/...` URLs that are not served; SPA catch-all returns `index.html` with 200. Files are lost on redeploy; uploads appear to succeed. | [cloudinary.service.js:11-34](../backend/services/cloudinary.service.js#L11-L34), [index.js:95-104](../backend/index.js#L95-L104) | Remove fallback; storage outside deploy tree; explicit 503 on failure; `/media` and `/uploads` never fall through to the SPA. |
| F4 | Medium | Generic upload filter trusts the client-declared MIME type only, and admits `image/svg+xml` and PDF for avatars, landmarks, logos, campaign images. SVG served from our own origin can execute script (stored XSS) — harmless on `res.cloudinary.com`, **dangerous once we self-host**. | [upload.middleware.js:6-23](../backend/middlewares/upload.middleware.js#L6-L23), [:44](../backend/middlewares/upload.middleware.js#L44) | Magic-byte sniffing + per-category whitelist; all images decoded and re-encoded by `sharp`; SVG accepted only for category icons/products and **rasterised to PNG** before storage; never serve `image/svg+xml`. |
| F5 | Medium | Landmark photos (photos of customers' homes) are public URLs and keep EXIF GPS metadata. | [user.controller.js:101](../backend/controllers/user.controller.js#L101) | `customer.landmark` is private; EXIF stripped on re-encode. |
| F6 | Medium | Return and ticket attachments (may include IDs, invoices, personal photos) are public URLs; admin internal-note attachments are equally public. | [return.controller.js:31](../backend/controllers/return.controller.js#L31), [ticket.controller.js:20](../backend/controllers/ticket.controller.js#L20), [admin.controller.js:1954](../backend/controllers/admin.controller.js#L1954) | Private categories with owner/related-party policy; internal notes admin-only. |
| F7 | Low | Replaced/removed media is never deleted (`deleteFromCloudinary` has no callers) — old KYC documents remain reachable after re-upload. | [cloudinary.service.js:161](../backend/services/cloudinary.service.js#L161) | Replacement lifecycle + cleanup job; legacy KYC copies deleted only in approved cleanup phase. |
| F8 | Low | Whole files are buffered in memory (up to 50 MB ZIP; e-book up to the 250 MB configurable cap). Concurrent large uploads can exhaust RAM. | Multer `memoryStorage()` throughout | Disk-backed temp storage for large categories; per-account concurrency limits (pattern already exists in `serviceUpload.middleware.js`). |
| F9 | Info | Bulk ZIP extraction: check for zip-bomb / path-traversal entry names when the controller is touched. Not reviewed in depth in this audit. | [bulkProduct.controller.js](../backend/controllers/bulkProduct.controller.js) | Validate entry count, total uncompressed size, and use only basenames. |

**Already good and to be preserved:** e-book and service-document stores (UUID names, path containment, refusal of public dirs, SHA-256 verified reads, 0600 files), `serviceUpload.middleware.js` request/concurrency bounding, storefront image re-encode via `sharp`, `safeCloudinaryUploadError` not leaking provider signatures.

## 2. Required controls (new system)

### Upload validation
- Content sniffing decides the type; extension and declared MIME must agree with it.
- Per-category whitelist and limits (architecture §4). Reject everything else, including executables, HTML, SVG (except rasterised categories), archives (except bulk ZIP), Office files.
- Images: decode with `sharp` (`limitInputPixels`, e.g. 40 MP), auto-rotate, resize to category maximum, re-encode, strip metadata.
- PDF: `%PDF-` header and `%%EOF` trailer check (existing `validateEbookPdf`); served only with `Content-Disposition: attachment` to non-admins.
- Video: container signature plus MP4 `moov` parse for duration/codec/dimensions.
- Server-generated UUID names; original name kept only as sanitised metadata; storage key never derived from user input; resolved path must stay under the root (`path.relative` check) and must not be a symlink (`lstat`).

### Access control
| Viewer | May read |
|---|---|
| Anonymous | `public` categories only |
| Customer | own avatar/landmarks/returns/tickets |
| Seller | own branding/products; return attachments for their own order lines; own tickets; own KYC shown as "on file" only |
| Delivery partner | landmark photo of an order **currently assigned** to them; own tickets; own KYC "on file" only |
| Admin | by `Admin.role` / `Admin.permissions` (`manage_sellers`, `manage_orders`, finance permission via `requireFinancePermission`, ticket handling). `private-kyc` reads require the matching permission and are audited. |

Cross-tenant requests return 404. Signed URLs bind media ID, viewer ID, purpose and expiry.

### Delivery hardening
- `X-Content-Type-Options: nosniff` on every media response; `Content-Security-Policy: default-src 'none'; sandbox` on media responses.
- Public media served from a separate cookie-less origin (recommended `media.` subdomain) so even a mis-served file cannot read app cookies or tokens.
- `Cache-Control: private, no-store` on all private media; never cached by the reverse proxy.
- No directory listing; `.tmp` and `private/` never mapped by Nginx except as `internal` (X-Accel) locations.

### Filesystem
- Dedicated service user owns `MEDIA_ROOT`; directories 0750 (`public`) / 0700 (`private`), files 0640 / 0600.
- Root outside the repo, deploy directory and any web document root; startup refuses otherwise (same check as `ebookStorage.service.js`).
- Backups of `private/` encrypted at rest (see infrastructure doc).

### Audit
- `MediaAccessAudit` for every `private-kyc` view and every signed-URL issuance for KYC/bank media.
- Upload, replace and delete of KYC/bank media recorded with actor and entity.
- Audit records are append-only; no API to delete them.

## 3. Residual risks after migration

- Single-server storage: disk loss = data loss without tested backups (infrastructure doc).
- Signed URLs can be shared within their TTL; keep TTL short and bound to viewer for audit.
- Historical Cloudinary copies of KYC stay public until the approved cleanup phase deletes them. Recommend prioritising KYC cutover **and** KYC cleanup approval, since this is the largest current exposure.
