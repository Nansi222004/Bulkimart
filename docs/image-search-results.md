# Image search verification — 26 October 2026

Implemented locally. No deployment or live catalogue changes were performed.

## Findings and repair

The existing upload flow already accepted JPG, PNG and WEBP files, validated decoded pixels, and searched a MongoDB index. Its candidate filter required a shared perceptual-hash band, which could miss a similar pack with a different layout. Its RGB comparison gave shared white backgrounds too much influence. Results always showed the first catalogue photo, even when another photo matched. Candidate processing stopped at 500 photos, results at 100 products, and indexing at five photos per product.

Search now retrieves candidates using perceptual hashes or foreground hue bands. Saturated packaging colours carry more weight than white backgrounds; a colour-overlap check rejects clearly different packaging colours. Layout and RGB appearance still contribute to ranking. Legacy index rows derive colour information from their existing RGB grid, so they remain searchable without an immediate rebuild. The index version remains 1 because the original fields are compatible; the API reports ranking mode `visual-fingerprint-v2`.

Every available catalogue photo is indexed. One broken download leaves the job retryable while allowing later photos to be indexed. Search streams eligible candidate photos, selects the best photo per product, and paginates all accepted products at up to 20 per page. Results expose `matchedImageUrl`, and the result card displays that photo. Live stock, approval, storefront, retail-channel and current-image checks remain in place.

## Verification

- Backend: `cd backend` then `npm run test:image-search` — **22 passed**. Uses real Sharp raster decoding, multipart HTTP requests, and a disposable MongoDB 7.0.14 database.
- Frontend: `cd forntend` then `npm run test:image-search` — **13 passed**. Uses actual React components with controlled hooks and mocked HTTP responses; includes the matching secondary photo, navigation, validation, errors and cancellation.
- Frontend production bundle passed using Vite's programmatic API with an explicit React plugin and `configFile: false`, writing to `test-artifacts/image-search/build`. The normal large-chunk warning remains. The repository's default build/config bootstrap was not used for this check.
- Red snack-pack fixtures return the original red pack and a red variant with a different size/layout, and reject blue, green and orange versions on the same white background.
- Coverage includes colour retrieval without shared hash bands, legacy records without colour fields, a matching sixth photo, deduplication, a broken first photo, and page six of 105 products / 525 indexed photos.

The fixture images are synthetic packaging. These tests establish the matching and upload behavior, rather than accuracy against a live product catalogue. Matching is based on visual appearance; snack identity, brand, flavour and category are not semantically recognized. Unrelated products with similar colours and layouts can still match. Busy backgrounds, very small objects and large lighting changes remain limitations.

## Catalogue readiness

A catalogue with no image index returns HTTP 503. New/changed products queue indexing through the existing worker. For a previously unbuilt catalogue, or to refresh existing rows with stored colour fields and photos beyond the former five-photo limit, run `npm run image-search:index` from `backend` with `MONGO_URI` set for the intended environment. This command downloads allowed catalogue photos and updates that database; it was not run against a live environment here.

Refreshes are recommended for catalogue performance: legacy rows without colour bands require broader scanning. Search cost grows with the number of eligible candidate photos. Catalogue CDN origins must be Cloudinary or explicitly configured through `IMAGE_SEARCH_CATALOG_ORIGINS`; unavailable/unsupported images remain queued for bounded retries.
