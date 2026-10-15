# Customer search by image

Implemented in the existing storefront header and SearchPage. Camera buttons open the same mobile-friendly action sheet. Take Photo uses a native image input with `capture="environment"`; Upload Image uses a separate gallery/desktop picker. File preview, removal, loading, retries, empty results and failures are included. Search results reuse the existing product cards and selected-product navigation. Text and microphone search remain available; other catalogue pages, filters and sorting were not changed. Image results rank by visual similarity and support twenty results per page.

No reference screenshot was present in the task's accessible attachments; styling follows the current theme variables and responsive header layout. Camera hardware behavior and final mobile layout still need real-device/browser verification.

## Matching actually implemented

This is a local **visual-fingerprint fallback**, not semantic object recognition, OCR or text search disguised as visual search. No paid vision provider, credentials or embedding API is required. The matching pipeline is implemented and tested against real decoded synthetic images and isolated MongoDB records.

Sharp fully decodes JPEG, PNG and WEBP with strict error handling, a twenty-megapixel input ceiling, a five-second processing timeout and EXIF orientation correction. Animated/multipage images are rejected. The image is flattened on white and converted to sRGB. Fingerprints contain a 64-bit difference hash, an 8×8 RGB spatial descriptor and per-channel colour histograms. The similarity score combines hash distance (40%), spatial colour distance (40%) and histogram distance (20%). A fixed threshold of 0.86 excludes weak matches. Version 1 fingerprints and eight hash-band tokens are stored in `ProductImageIndex` for existing catalogue photos only.

The MongoDB multikey `(version, bands)` index retrieves matching hash bands. Live product visibility and current image-URL checks run before a maximum of 500 fingerprint candidates enter application memory. Product matches are deduplicated and sorted by score with ID as a deterministic tie-breaker. Up to 100 best matches are paginated. No catalogue image is downloaded during a customer search. A second live product query returns the existing customer product fields, excluding private digital-file metadata, with category/seller display data populated.

This mode works best for the same or similar product photograph, including resized/re-encoded copies and modest visual changes. It can miss a product photographed from a different angle, against another background, or with a large crop; it cannot reliably recognize an object from its meaning. Shared backgrounds can cause false positives. Hash-band retrieval and the bounded candidate pool are approximate and may miss matches in large/crowded buckets. Evaluate relevance against the actual catalogue before rollout. A semantic CLIP/vision embedding provider and ANN index would be a separate extension; none is silently simulated here.

Decoder settings follow the [Sharp constructor documentation](https://sharp.pixelplumbing.com/api-constructor/). Native Sharp packages require Node >=20.9.0; the backend manifest records this requirement.

## Setup and operational commands

Use Node >=20.9.0 and install the backend dependencies with the updated lockfile. Sharp's platform-specific optional dependencies must be available; do not omit all optional dependencies when installing. The existing MongoDB connection is reused.

Backend environment:

| Variable | Default / meaning |
| --- | --- |
| `IMAGE_SEARCH_ENABLED` | Disabled unless exactly `true`. Enables the search API and background index worker. |
| `IMAGE_SEARCH_MAX_BYTES` | `5242880` (5 MiB). Configurable from 1024 bytes to 10 MiB; restart the backend after changing it. The frontend reads this through the public configuration endpoint. |
| `IMAGE_SEARCH_CATALOG_ORIGINS` | Optional comma-separated **trusted public HTTPS CDN origins**, in addition to `https://res.cloudinary.com`. Example shape: `https://cdn.example.com`. Never allow internal/private hosts or arbitrary user-controlled fetch services. |
| `MONGO_URI` | Existing MongoDB connection, also used by the explicit index command. No connection value is included here. |

After configuring the intended local/staging environment, build the catalogue index explicitly:

```powershell
cd backend
node scripts/imageSearchIndex.mjs
```

The script reads that backend environment, connects to the configured database, creates the new index/job collections and indexes, queues catalogue products and drains currently available jobs. It writes **index/job data** and must be run only against an authorized environment. It reports counts only. It was **not** run against a real catalogue or production database during implementation. The backend's ordinary startup does not automatically enqueue the whole catalogue.

When enabled, normal product creation, image changes and soft deletion via `save()`, `updateOne()` or `findOneAndUpdate()` queue a durable per-product `ProductImageIndexJob`. Each worker processes one job at a time, checks every two seconds, and uses a two-minute database lease to coordinate processes. Up to five public product photos are decoded per product. Revisions preserve new work arriving while an older job runs. Failed jobs back off by minutes and stop after five attempts; running the explicit index command resets/requeues them. Queue failures do not fail an otherwise successful product write; they emit a generic operational message and require reconciliation.

Run the explicit command after initial enablement, after changing the fingerprint version, to retry exhausted jobs, and periodically to reconcile missed jobs or writes bypassing document middleware (`insertMany`, bulk imports, direct database writes, update pipelines, and updates without an exact product ID). It also refreshes images whose bytes changed at an unchanged URL. Relative local-upload fallback paths are not fetched; they require reachable public CDN images before indexing succeeds. Index old-photo rows are deleted when their product is refreshed; searches independently reject stale URLs and inactive/deleted products immediately. Hard-deleted orphan index rows cannot pass live product lookup and can be removed by an independently reviewed maintenance operation if needed. No destructive cleanup was added.

## APIs, visibility and security

- `GET /api/products/search-by-image/config` returns enabled flag, public byte limit and matching mode. It never returns credentials, server paths or catalogue data.
- `POST /api/products/search-by-image?type=grocery|ecommerce&page=1&limit=20` accepts exactly one multipart file named `image`, with no text multipart fields. Returns `{ success, data, message, meta: { page, limit, total, mode } }`; `data` contains existing product response fields plus `imageSimilarity`.
- Search is public, consistent with existing customer text search. A supplied bearer session must pass the existing authentication middleware; invalid or deactivated sessions are rejected. Anonymous requests are intentionally allowed.
- Live eligibility requires approved, active, non-deleted products, correct primary or active cross-listing channel, and excludes legacy SHG listings. Physical stock must be positive; digital products may appear in Shop All without physical stock and never appear in Quick. Private digital-file fields are excluded.
- All matches prioritize the similarity score. Paid text-search boosts do not override visual similarity. Existing text/voice endpoints and other filter/sort/pagination flows are preserved.
- Rate limit: ten attempts per minute per verified account, or per IP for anonymous callers. Maximum two active image-search operations per process and one per account/IP. Counters are in memory, like existing limiters; deployments with multiple processes must account for independent budgets.
- The existing bounded upload utility is reused with image-specific limits; service-management defaults remain unchanged. Exactly one image, no multipart text fields, one part, a file byte cap, a total streamed/request-length cap of `maxBytes + 16384`, and a sixty-second upload timeout are enforced. Interrupted and failed requests release buffers and concurrency slots in the utility's finally block.
- Client checks type, filename and byte size. Server checks extension, declared MIME, decoder-detected format, size, pixel count, frame count and actual raster decoding. SVG and mismatches are rejected. No customer search image is written to disk, MongoDB, Cloudinary or another provider, and no EXIF data is persisted. Memory buffers are released after the request; no temporary disk cleanup is necessary. Browser object URLs are revoked on replacement/removal/closure/unmount.
- Only the background indexer downloads existing public catalogue photos. Origins are allowlisted, credentials/ports/non-HTTPS URLs are rejected, redirects are forbidden, downloads have a ten-second timeout and streamed byte limit. Search uploads never supply a fetch URL. Index logs contain no uploaded image contents, API keys, signed URLs or customer information.
- Disabled search or an unbuilt index returns an actionable 503 configuration/readiness error. The storefront presents a plain-language unavailable message and offers text search. Other failures use 400/401/413/429 as appropriate with the existing response envelope.

## Files

| Area | Files |
| --- | --- |
| New backend | `backend/models/ProductImageIndex.js`, `backend/models/ProductImageIndexJob.js`, `backend/services/imageFingerprint.service.js`, `backend/services/imageSearch.service.js`, `backend/services/imageSearchIndexer.service.js`, `backend/routes/imageSearch.routes.js`, `backend/scripts/imageSearchIndex.mjs` |
| Backend integration | `backend/models/Product.js`, `backend/routes/product.routes.js`, `backend/index.js`, `backend/middlewares/serviceUpload.middleware.js`, `backend/package.json`, `backend/package-lock.json` |
| New frontend | `forntend/src/modules/User/components/ImageSearchSheet.jsx`, `forntend/src/modules/User/components/ImageSearchSheet.css`, `forntend/src/modules/User/utils/imageSearch.js` |
| Frontend integration | `forntend/src/modules/User/components/UnifiedHeader.jsx`, `forntend/src/modules/User/pages/SearchPage.jsx`, `forntend/src/modules/User/context/UserContext.jsx`, `forntend/package.json` |
| Tests | `backend/__tests__/api/image-search.http.test.js`, `forntend/scripts/image-search-ui.test.mjs`; existing `forntend/scripts/service-hookHarness.mjs` gained optional context support |
| Test tracking/docs | Root/backend `.gitignore` include the new API test; `IMAGE_SEARCH.md` |

## Local verification and limitations

| Command | Actual result |
| --- | --- |
| `cd backend; npm test -- --runInBand __tests__/api/image-search.http.test.js` | 15 passed, 0 failed |
| `cd backend; npm test -- --runInBand` | 47 suites passed; 331 tests passed, 7 skipped, 0 failed (338 total) |
| `cd forntend; npm run test:image-search` | 12 passed, 0 failed |
| `cd forntend; npm run test:services` | 16 passed, 0 failed |
| Backend `npm run build` | Passed (`node --check index.js`) |
| Frontend `npm run build` | Passed; existing large-chunk warning remains |
| `git diff --check` | Passed |

The backend tests use actual Sharp decoding, real fingerprints and real isolated MongoDB search/index collections, rather than fake provider IDs. Product image downloads in worker tests use synthetic response bytes; there are no live Cloudinary calls. Tests cover re-encoding/resizing, dissimilar images, all allowed formats, extension/MIME mismatches, truncated/malformed/oversized files, excessive pixels, empty results, feature readiness, anonymous/invalid sessions, rate limiting, visibility, stale entries, cross-listings, indexing/retries and pagination.

Frontend tests execute actual components with the existing deterministic React hook harness and synthetic context/file fixtures. They exercise camera/gallery input wiring, desktop selection, preview/removal, retry/loading, type/size checks, API multipart/bearer conventions, results navigation, empty/error states, text/voice preservation and late-response isolation. They do not activate physical camera hardware or render a browser DOM. A real mobile/desktop browser and production proxy/CDN still need verification. No production deployment, production writes, real customer documents or live catalogue indexing were performed.

The backend package installation reported 27 audit findings across its dependency tree. Their provenance was not independently assessed; no unrelated automatic dependency upgrades or `audit fix` were performed. The existing Vite large-bundle warning remains.
