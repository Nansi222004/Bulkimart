# Storage Implementation Report

Running log of what has actually been done. Statuses follow the checklist vocabulary; nothing is marked Tested/Verified without recorded evidence.

## 2026-11-01 — Session 4: pre-deployment verification (server execution not possible from this session)

**Environment:** this session again ran on the Windows development machine (`khushi`), not the VPS. Nothing was executed on the server; no code was run locally.

**Git state (verified with `git ls-remote`):** the remote has only `main` (`eb15e59`). Branch `storage/server-media` **does not exist** locally or remotely; all storage files are uncommitted in a working tree that also holds ≈ 50 unrelated tracked changes (mainly `mobile-user/`). Consequently: nothing can be fetched on the server, `deploy.sh` must not be run for this work, and every category is still served by Cloudinary in production (the new code is not deployed).

**Review against the runbook and the server brief — fixes made:**
- Bug: the Cloudinary migration wrote its download into `MEDIA_ROOT/temp` without creating the directory, and multer's disk storage (storefront video) does not create a destination either. On a fresh volume both would fail with ENOENT. Both now create `temp/` (the media root itself must still exist).
- Test gap: the brief's list (KYC audit logging, cross-user access over HTTP, migration idempotency, ETag/checksum mismatch, own-account-only fetching, range requests, private files unreachable via public URLs, failed upload leaves nothing behind, health endpoint) was only partly covered by unit tests. Added `__tests__/api/media-delivery.http.test.js` — real routes, real in-memory MongoDB, real filesystem and `sharp`; only auth and the Cloudinary download are stubbed.
- Runbook used `<DB_NAME>` placeholders; replaced by [STORAGE_FINAL_SERVER_COMMANDS.md](STORAGE_FINAL_SERVER_COMMANDS.md) (sections A–L, every command literal, purpose / expected result / production impact stated). Backup remote names aligned across documents.

**Test status:** 0 tests executed. Four suites ready: `media-storage`, `media-routing`, `cloudinary-upload` (unit) and `media-delivery.http` (integration).

**Active provider per category (production):** all 17 categories on Cloudinary (code not deployed). **Assets copied/verified:** 0. **Failed/skipped:** none (not run).

## 2026-11-01 — Session 3: central storage implemented (not yet executed)

Context: owner approved `/var/lib/bulkimart/media`, treats `srv2104110` as production, and deferred backups to before client launch. Code was written and reviewed on the Windows development machine; **no code was executed there** (PolinRider containment). All tests and server steps are commands in [STORAGE_DEPLOYMENT_RUNBOOK.md](STORAGE_DEPLOYMENT_RUNBOOK.md) for the operator to run.

### Phase 0 — reconciliation with the audit

The 23 live workflows in the audit still match the code; no new upload paths were found. One correction: the order landmark snapshot field is `Order.shippingAddress.landmarkImage` (audit said `deliveryAddress`). Not implemented (do not exist, not created): delivery pickup/delivery/handover/failed-delivery photos, vehicle photos/RC/insurance, rider avatar, variant-specific images, seller pickup photos, ad creatives, GST certificate as a separate upload (GST documents go through the existing private service store).

### What was built

| Area | Files | Notes |
|---|---|---|
| Config | `backend/config/storage.js` | `MEDIA_ROOT`, `MEDIA_PUBLIC_BASE_URL`, `MEDIA_SIGNING_SECRET`, `MEDIA_MIN_FREE_BYTES`, `MEDIA_PROVIDER_DEFAULT`, `MEDIA_PROVIDERS` (per-category map), `MEDIA_LEGACY_READ_MAP`, `MEDIA_SIGNED_URL_TTL_SECONDS`. Startup refuses server storage if the root is inside the repo, the secret is < 32 chars or the base URL is not https. |
| Policy | `services/mediaPolicy.service.js` | One table: 17 categories → visibility, directory, accepted types, size, output format; maps every existing upload folder (incl. `seller-docs`, `delivery-bank`) to a category. |
| Validation | `services/mediaValidation.service.js` | Magic-byte sniffing; extension and declared MIME must agree with content; images decoded and re-encoded with `sharp` (strips EXIF/GPS, 40 MP limit); PDF header/trailer; SVG sanitised (scripts, handlers, external refs, entities rejected) and rasterised to transparent PNG ≤ 512 px; MP4 header parsed in JS — H.264 (`avc1`/`avc3`), ≤ 15 s (+0.5 s tolerance), ≤ 1280 px wide; WebM and fragmented MP4 rejected with clear messages. No ffmpeg. |
| Storage provider | `services/mediaStorage.service.js` | Filesystem provider behind a small interface (`put/openKey/remove/verifyKey/health`). Temp write → fsync → re-hash verify → atomic rename; 0640/0600 files; key pattern + containment check; refuses symlinks; root never auto-created (unmounted volume fails loudly); free-space reserve → 507. |
| Upload service | `services/media.service.js` | `storeUpload` (validate → store → register; nothing registered unless the file is durable), `mediaContext(req, file)` derives owner from the authenticated request only, `removeByReference` for failed-upload cleanup. No content de-duplication for uploads (prevents deleting a shared file). |
| Metadata | `models/Media.js`, `models/MediaAccessAudit.js` | Storage key `select:false`, unique; legacy URL unique (migration idempotency). |
| URLs & access | `services/mediaUrl.service.js`, `middlewares/mediaResponse.middleware.js` | Public media → stable absolute URL. Private media → `media:<id>` stored; every JSON response is resolved: signed 15-min URL for the viewer the endpoint served; identity/bank documents only for admins or the owner; others keep the opaque reference (so "on file" checks in apps keep working). Read-time legacy map for verified Cloudinary copies (historical records untouched). |
| Input safety | `middlewares/auth.middleware.js` (one call), `normalizeMediaInput` | After authentication, echoed signed links become stable references; raw `media:` references not owned by the caller are dropped (prevents attaching another user's file by ID). |
| Delivery | `routes/media.routes.js`, `index.js`, `routes/index.js` | `GET /media/<dir>/<yyyy>/<mm>/<file>` public (1-year immutable cache), `GET /media/s/<id>` signed private (no-store, audited for KYC), `GET /api/media/:id` owner/admin only, `GET /api/admin/media/health`. `nosniff`, sandbox CSP, `Cross-Origin-Resource-Policy: cross-origin`, range requests via express `sendFile`, PDFs as attachments, no directory listing, unknown paths 404 (never the SPA). |
| Adapter | `services/cloudinary.service.js` | `uploadToCloudinary` / `uploadFileWithMeta` route each category to server or Cloudinary per config; same return shapes. Local `/uploads` fallback removed (session 2 hotfix). `isSensitiveFolder` now derived from the policy table. |
| Workflows | 12 controllers + `routes/storefront.routes.js` | Each upload call passes `mediaContext(req, file)`; storefront uploads stream to `MEDIA_ROOT/temp` on disk (no 15 MB video in memory) when on server storage. Business logic untouched. |
| Cleanup | `services/mediaCleanup.service.js`, `productUploadCleanup.service.js` | Hourly temp sweep (> 24 h) and disk-reserve warning; failed product uploads remove server files. |
| Image search | `services/imageSearchIndexer.service.js` | Trusts the `MEDIA_PUBLIC_BASE_URL` origin for catalogue images. |
| Migration | `services/mediaMigration.service.js`, `scripts/media/migrate.mjs` | `inventory` (deep scan of every collection), `copy` (per category, batches, bit-for-bit, SHA-256 + size + ETag MD5 checks, quarantine for unexpected content, own-account URLs only, no redirects), `verify`, `cutover` (live collections only, guarded, logged), `rollback`, `orphans` (report only), `health`. Dry-run by default; `--database` guard. |
| Tests | `__tests__/services/media-storage.test.js`, `media-routing.test.js`, `cloudinary-upload.test.js` | ≈ 80 cases: policy mapping, config guards, validation (spoofing, double extension, executables, corrupt, oversize, SVG XSS, EXIF stripping), MP4 limits, storage atomicity/traversal/disk-full/unmounted root, signatures, KYC visibility, routing, legacy map, input normalisation. **Not yet run.** |

### Deliberate behaviour changes (when a category is switched to server storage)
- Storefront videos are validated, not transcoded: admins must upload H.264 MP4 ≤ 15 s, ≤ 1280 px wide. WebM uploads are rejected with a message (previously Cloudinary converted them).
- Uploaded images are re-encoded (WebP for most; JPEG for KYC and push images; PNG for icons). Visual quality ~82–85; metadata removed.
- Identity/bank documents are visible to the owner and admins only; other viewers receive an opaque reference.
- PDFs download instead of opening inline.

### Known limitations
- Multipart (form-data) request bodies are not normalised by `normalizeMediaInput` (runs before multer); no current multipart form echoes media links.
- A signed link shared by an authorised viewer can be attached by someone else within the input normaliser (signature is accepted ignoring expiry). Low risk: the holder could already view that file.
- Single disk, no backup yet (launch blocker).

### Status
Implemented, **not tested**. Next: runbook §3 (tests on the server) — results to be pasted here.

## 2026-10-31 — Session 2

### Environment gate: FAILED (wrong machine)

The brief states the session runs on `root@srv2104110:~/bulkimart` (Ubuntu). Actual verification:

| Check | Result |
|---|---|
| Hostname | `khushi` |
| OS | Windows 11 (MINGW64 / Git Bash), not Ubuntu |
| User | `nansi`, not `root` |
| Repository | `D:\Appzeto_Projects\Bulkimart1`, HEAD `eb15e59` |
| `/root/bulkimart` | does not exist |

This is the Windows development machine that the Phase 1 brief identified as previously compromised (Trojan:NPM/PolinRider). Consequences:

- Infrastructure steps 2–5 (server inspection, G1–G10 answers, persistence/capacity decision) **were not performed** — the server is not reachable from this session and no SSH target or credentials were provided.
- No `node`, `npm`, `npx`, Jest, build, migration or deployment command was run.
- `STORAGE_INFRASTRUCTURE_REQUIREMENTS.md` gate remains **Blocked**.
- The runbooks (deployment, rollback, backup/restore), migration results and production sign-off documents are **not created yet**: their content depends on the real server (paths, proxy, PM2, backup target). Writing them now would be guesswork.

### Security hotfix: Implemented, NOT tested

Separate, minimal change. Not committed, not deployed.

| File | Change |
|---|---|
| [backend/services/cloudinary.service.js](../backend/services/cloudinary.service.js) | Added `seller-docs` (PAN / trade licence) and `delivery-bank` (rider passbook) to `SENSITIVE_FOLDER_PREFIXES`. Removed `saveLocally()` and both local-disk fallbacks: `uploadToCloudinary` and `uploadFileWithMeta` now share one `streamUpload()` path that rejects with the existing sanitized errors (`503 UPLOAD_CONFIGURATION_MISSING/REJECTED`, `502 UPLOAD_PROVIDER_ERROR`) for every folder. Return shapes unchanged. |
| [backend/__tests__/services/cloudinary-upload.test.js](../backend/__tests__/services/cloudinary-upload.test.js) | Added: classification of all sensitive / non-sensitive folders; provider failure rejects (no `/uploads` URL) for product, banner, PAN and rider-bank folders; `uploadFileWithMeta` failure and success shape. |

Security report items addressed: **F2** (fixed), **F3** (fallback removed; storage outside deploy tree still to come with the central service). **F1** (KYC on public Cloudinary URLs) is *not* fixed by this hotfix — it requires the central private storage.

Behaviour change to be aware of: an environment **without** Cloudinary credentials (e.g. a local dev setup) now gets a clear 503 on product/banner/avatar uploads instead of a "successful" upload with a broken link. Nothing in the codebase serves `/uploads`, so no working behaviour is lost.

Not yet done for this hotfix:
- [ ] Run `npm test -- __tests__/services/cloudinary-upload.test.js` and the full backend suite on a trusted machine/server
- [ ] Owner approval to commit
- [ ] Owner approval to deploy

### Next phase prerequisites
1. Run this session (or the next) on the actual server, or provide its G1–G10 answers.
2. Owner approval of the storage location and backup strategy.
