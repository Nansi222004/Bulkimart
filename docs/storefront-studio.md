# Bulkimart Storefront Studio

Implementation and verification report — 23 October 2026.

## Status  

The customer storefront, promotional splash, seasonal tokens, and management screens are integrated into the existing React/Express/MongoDB application. Routine publication needs no frontend rebuild after the initial application release. No production deployment, production database mutation, environment change, or credential change was performed.

The new feature tests and relevant focused regressions pass. The existing complete backend suite is **not green**; its remaining failures reproduce against the original revision. Details and remaining manual checks appear below.

## Architecture and reuse

The existing customer shell, header/search/location, Quick/ShopAll switch, bottom navigation, cart, wishlist, product detail, authentication, and portal separation remain in place. The repository uses UserContext/history navigation, not React Router. StorefrontProvider wraps the customer content and PromotionalSplash; ordinary navigation and authentication do not reset the splash launch guard.

On startup the shell renders normally, then the provider fetches the public experience. Published configuration supplies a responsive hero carousel, announcement, theme, optional splash, and ordered product sections. Without configuration or on expiry/outage, brand defaults and existing browsing/product shelves remain available. Images have text fallbacks; product sections have bounded loading, retry, and empty states.

Existing models retain their responsibilities:

- **Banner:** artwork and validated navigation, extended with mobile image, optional video, CTA, soft archive, and Studio placement.
- **Campaign / CampaignParticipation:** existing deal participation, accepted prices, dates, and eligibility. No new discount engine.
- **Product / Category:** actual stock, variants, ratings, catalog filters, category visibility and ordering.
- **Coupon:** authenticated offer discovery; fabricated frontend coupon codes were removed.
- **StorefrontExperience:** the one new presentation collection, with `kind=theme|campaign|section`, validated configuration, scope/device, dates, priority/order, revision, actor references, and at most 20 publication snapshots. A promotional campaign here references a Banner and optionally a Theme; it does not price orders.

The implementation reuses ModalPortal (focus trapping/restoration), FeedbackProvider, admin API helpers, authentication/permission middleware, boundedFetch, Cloudinary, sharp, existing product and wholesale APIs, and the current CSS approach. It introduces no styling framework, Redis dependency, or process-local scheduling job. The requested code-review graph tools were unavailable in this session; repository searches and reads were used instead.

## Admin guide

Open **Admin → Marketing & CMS → Storefront Studio** (`/admin/storefront-studio`). Tabs cover Themes, Promotional campaigns, and Homepage sections. Banner library and Deal pricing open the existing managers. Lists support search, status filtering, pagination, schedule display, edit, duplicate, publish, pause, archive, and rollback.

### Header categories and the default banner

Open **Admin → Categories → Header Categories**, select Quick or ShopAll, and add or edit a header category. Upload its category image or icon, enable **Show in header navigation (beside Smart Buy / My Home)**, keep it active, and choose its display order (lower numbers first). New header categories have this visibility option selected initially. Every selected category appears as a compact tab in the header below search, alongside Smart Buy/Hot Deals in ShopAll or My Home/Coupons in Quick. This row scrolls horizontally when necessary. Clicking a category opens its existing category product feed. There is no duplicate category tile strip below the header and no built-in category records or automatic substitutes when none are selected. Categories belong to the selected storefront: an E-Book category created in ShopAll does not appear in Quick.

The supplied `forntend/src/assets/banner1.png` is the default banner when the selected storefront has no active admin hero banner, including when configuration is unavailable. The complete image is shown without cropping; tapping it opens the category browser. In **Banner library**, upload artwork, choose **Homepage hero** and the correct storefront, then publish and enable it. An eligible admin hero replaces the default completely. Studio-only artwork requires a published hero campaign in Storefront Studio. Draft, disabled, expired, or future banners do not replace the default. Header categories and banners use the existing public experience refresh, so changes appear within approximately 30 seconds plus request latency without a rebuild.

Verification for this header/banner update on 24 October 2026: backend storefront tests 56 passed; frontend storefront tests 31 passed; both builds passed. The updated browser runner could not reach application checks because both Chrome and Edge timed out on DevTools `Page.enable`; responsive browser verification remains pending. No real category/banner records were seeded or published by this update.

### Create a seasonal theme

1. Choose Themes → Create theme, enter a name and private description.
2. Select a preset: Default Bulkimart, Festive, Diwali, Holi, Eid, Summer, Monsoon, New Year, Wholesale, or Custom. Presets never activate automatically.
3. Adjust colors, approved font, card/button shape, gradient, decoration, and optional gentle motion. Text/background and white/button combinations require 4.5:1 contrast.
4. Choose Global, Quick, or ShopAll scope, device, priority, and optional dates. Preview mobile and desktop, save a draft, then publish.

Customer CSS variables stay within the customer wrapper (or explicit preview/splash). Admin, seller, delivery, and SHG portal themes are unaffected.

### Prepare media and destinations

In Banner library create or edit a banner. Choose **Studio only** for artwork that must not independently appear in the normal hero. Supply a desktop image (also the video poster), optional mobile image and video, title, subtitle, and CTA. Publish/enable the banner before publishing a reference to it.

Raster uploads accept JPEG/PNG/WebP, at most 5 MB, decode with a 25-million-pixel limit and re-encode through sharp. Protected Studio media upload also accepts MP4/WebM up to 15 MB, verifies extension/MIME/container signatures, and asks Cloudinary to produce H.264 MP4 limited to 15 seconds and 1280px width. Video requires the existing Cloudinary configuration; there is no local video fallback. Existing raster upload infrastructure retains its local fallback. Media binaries are not stored in MongoDB. Archiving never deletes uploaded assets.

Destinations use the existing category/product/deal selectors or HTTPS external URLs. Active, approved, scope-compatible targets are checked before display. External URLs cannot contain credentials or executable schemes; the current policy permits HTTPS hosts generally rather than a configurable domain allowlist. Supported historical internal routes remain mapped through a closed route list. There is no arbitrary HTML, JavaScript, or CSS input.

### Publish a promotional campaign or splash

Choose Promotional campaigns → Create campaign. Select published banner artwork, optional published theme, hero/splash/announcement placement, scope/device, priority, and dates. Splash additionally offers an auto-close duration of 2–15 seconds, optional end countdown, and frequency:

| Policy | Storage and meaning |
| --- | --- |
| Every eligible launch | Once during the mounted customer app launch; refresh starts another launch |
| Session | Once per browser tab session and publication revision, using sessionStorage |
| Daily | Once per IST calendar day and revision, using localStorage |
| Version | Once per publication revision, using localStorage |

All policies cap display at one splash per app launch. Publishing a new revision makes it eligible on a subsequent eligible launch. Ordinary renders and internal routes never reopen it. Clearing browser storage resets persistent frequency; storage denial still preserves the in-memory launch cap. No cross-device/account frequency promise is made.

Skip and Escape always work; auto-close is bounded. The splash does not interrupt checkout, product detail, campaign detail, or an existing dialog. Its CTA dismisses then navigates. Muted video loads only when active, falls back to poster on playback rejection/error, respects reduced motion, and releases playback on unmount. Pausing, replacing, or expiring its configuration dismisses it after revalidation.

### Manage homepage collections and offers

Create a Homepage section, choose its customer-facing title, scope, source, product limit (1–24), numeric display order, appearance, optional banner/CTA, and schedule. Lower order renders first. Publish to enable; pause/archive to hide. Once applicable published sections exist, they replace the default home shelves, while supported navigation and business/service shortcuts remain available.

| Source | Actual data and behavior |
| --- | --- |
| Recently added | Existing product catalog/default newest ordering |
| Featured / curated picks | Existing featured-product flag |
| Category collection | Active category in the selected Quick or ShopAll scope |
| Under a price | Existing catalog `maxPrice` filter, configurable INR threshold |
| Flash sale | Existing published/enabled Campaign and accepted participating products/prices |
| Wholesale | Existing public wholesale catalog, available tier prices/minimum quantities, existing wholesale variant/detail navigation; ShopAll only |

Fresh groceries and seasonal collections use real category/featured sources. The application has no new analytics-based bestseller, trending, or personalized recommendation engine; those are not fabricated. Use truthful curated titles. Category tiles retain existing category admin visibility/order/popularity settings; no new per-tile promotional metadata was added.

Flash-sale countdowns end at the earliest section/deal deadline. Expired deals disappear. Variant and deal products open their existing details before purchase. Wholesale cards display real tier minima as “From” with quantity context. Checkout remains authoritative for prices, stock, minimum quantities, coupons and participation. Payment, settlement, commissions, GST, delivery assignment and order-state business code was not changed.

**Saving any existing configuration creates a draft and removes that record from live resolution until republished.** The editor warns about this. To prepare a replacement without interrupting a current campaign, duplicate it and schedule/publish the replacement. Publish is a separate validation step; failed publication preserves the saved draft. Concurrent edits to the same record return 409 and require reload.

## Scheduling, priorities and freshness

Studio date inputs explicitly use Asia/Kolkata, independent of the workstation timezone. Dates are stored as UTC instants; API date inputs require `Z` or an offset. The existing Banner editor retains its browser-local datetime inputs. Check both banner and campaign schedules when associating them.

Persisted states are draft, published, paused, archived. Scheduled, active, and expired are computed from server time for published records: start is inclusive and end exclusive. Resolution queries MongoDB on each request, so multiple backend processes do not depend on timers to activate content.

Theme resolution: active eligible campaign-associated theme → active scoped theme → active global theme → Bulkimart brand defaults. Higher priority wins; stable ID ordering breaks ties. Same-priority overlapping theme scopes or campaign placements/devices are rejected at publication. Sections sort by order, then priority and stable ID. Hero campaigns can coexist as slides; splash and announcement each choose one winner. Legacy HOME_HERO banners are preserved and deduplicated.

Publication conflict checks are query-based across documents, so simultaneous publication of different conflicting records is not a serializable transaction. Deterministic resolution still applies. Coordinate concurrent publishers for the same placement. Per-record revisions and Mongoose optimistic concurrency protect edits to the same record.

The public API returns a content version/ETag, serverTime, validUntil and refresh interval, with `Cache-Control: no-store`. Clients refresh every 30 seconds or at the nearest known schedule boundary, and when visible/online. A healthy foreground client sees new publications within approximately 30 seconds plus request latency; browser throttling/network outages can extend that. Server clock offset drives current runtime deadlines. Per-scope/device/category session cache is usable only until validUntil (at most 30 seconds). Expired cache is discarded; defaults replace stale campaigns and countdowns. Catalog reads deduplicate concurrent requests with a bounded 15-second cache; checkout still revalidates.

## API and permissions

| Method/path | Purpose |
| --- | --- |
| GET `/api/storefront/experience?scope=quick&device=mobile` | Public resolved experience; also supports `scope=shop-all`, desktop and optional legacy category scope |
| GET `/api/admin/storefront?kind=theme&page=1&limit=12` | Protected search/status/paginated management list |
| GET `/api/admin/storefront/presets` | Protected presets |
| POST `/api/admin/storefront` | Create validated draft |
| PATCH `/api/admin/storefront/:id` | Save draft with expected revision |
| POST `/api/admin/storefront/:id/actions/:action` | publish/pause/archive/rollback with expected revision |
| POST `/api/admin/storefront/media` | Protected multipart upload, field `media` |

Existing `/api/banners` and `/api/admin/campaigns` remain the media and deal-management APIs. Banner deletion now soft-archives; restore returns it to draft. `/api/banners?all=true` requires admin authorization, closing the previous draft-list exposure. Normal public banner responses omit audit fields.

All Studio routes, banner mutations/admin listing, and admin deal-management routes require existing authenticated admin identity plus `superAdmin` or `manage_marketing`. Customer/seller credentials and an admin without that permission are denied. Public DTOs omit private descriptions, history and actors; draft/paused/archived/expired, broken references, retired seller ads, and invalid configuration cannot become live. Tests exercise actual Express routes, JWT roles, and isolated MongoDB records.

## Migration, release prerequisites and rollback

No data migration, broad rewrite, seed, or destructive index operation is required. New data uses the additive `storefrontexperiences` collection and compound index `(kind,status,scope,startAt,endAt)`. Banner additions are optional/defaulted; historical banners without placement continue as hero artwork. Existing records are not rewritten.

For a later authorized release: build frontend and backend from the same checkout, including `backend/shared/storefront.mjs` used during frontend compilation. Preserve existing database/auth/media configuration and raster upload storage. If automatic Mongoose index creation is disabled, have the normal database release process add the single declared index after inspecting existing indexes in staging; do not use destructive syncIndexes. No new environment variable or service is required. Check Cloudinary in staging for video. Routine subsequent content publication needs no release.

Validate against a disposable/staging database first using the commands below; this task did not connect to production. Roll back content by pausing/archiving an experience or using Rollback to republish the preceding saved publication after current validation. Expired historical schedules must be edited before publishing. Restore archived banners as drafts, then publish deliberately. For an application rollback, restore the previous application release through the normal release process and leave additive records/assets in place; no database deletion is necessary. Prefer retaining the admin-only banner-list permission fix when reverting presentation code.

## Verification evidence

Commands below were actually executed, from the indicated directory. The convenient test:storefront scripts were added and executed. The browser script intercepts API requests and blocks external resources against the production artifact; fixture values never enter runtime application code or a production database.

| Directory and command | Result |
| --- | --- |
| backend: `npm run test:storefront` | 43 passed |
| forntend: `npm run test:storefront` | 25 passed |
| forntend: `node verification/storefront-browser.mjs` after build | 18 scenarios passed, zero errors; 320/390/1440px |
| backend: `npm run test:financial-workflow` | 106 passed before and after |
| forntend: `npm run test:checkout` | 38 passed before and after |
| forntend: `npm run test:auth` | 36 passed before and after |
| forntend: `npm run test:startup` | 12 passed before and after |
| forntend: `npm run test:services` | 17 passed |
| forntend: `npm run test:socket` | 5 passed |
| forntend: `node --test verification/sponsored-category-ui.test.mjs` | 8 passed |
| backend: targeted Jest `__tests__/api/seller-marketing-retirement.http.test.js` | 9 passed after updating the draft-list expectation to require authorization |
| backend: `npm run build` | Passed syntax/service-package check |
| forntend: `npm run build` | Passed; Vite reports a large JS chunk, approximately 2.01 MB / 491 KB gzip |
| repository: `git diff --check` | Passed |

The browser checks cover responsive geometry, carousel controls, splash focus/trap/Escape, video/image failure, normal storefront on configuration failure, category routing, and Studio create/preview/publish. Screenshots and geometry reports are local ignored artifacts under `test-artifacts/storefront`. Unit/component checks additionally cover server-time freshness, frequency policies, storage denial, scope races, product variants, real coupon eligibility/expiry and wholesale tier navigation. `npm run test:storefront-browser` is a convenience wrapper for build plus the same browser runner. No lint/typecheck script exists in these manifests.

Complete backend run: `npm test -- --runInBand --silent` reported **53 passing / 7 failing suites; 778 passing / 11 failing / 7 skipped tests**. One failure was the former anonymous `?all=true` assertion; its local fixture now asserts 401 and authorized 200, and its nine-test suite passes. That existing `backend/__tests__` directory is ignored by Git; the new tracked verification suite independently asserts this security behavior. The complete suite was not rerun after updating that fixture.

The other failures were reproduced in an isolated archive of the original HEAD, using the existing test fixtures:

| Existing suite | Original-revision failure |
| --- | --- |
| seller-payment.http | 1 assertion expects authentication for an already-public wholesale catalog |
| admin-workflows.http | 3 assertions do not match existing finance/rider permission enforcement |
| sms.service | 3 failures involving required runtime Shiprocket settings |
| checkout-workflow.http | Suite cannot import mocked `resolveReturnPolicyForCategory` |
| razorpay-webhook.http | 2 existing 500-versus-200 assertions |
| order-fulfillment-lifecycle | 1 commissions lookup timeout during schema validation |

These failures were not bypassed by weakening authorization or modifying financial/order logic.

## Remaining limits and manual verification

- Perform a real staging admin publication and customer refresh with approved artwork; automation used isolated database records and browser API fixtures.
- Verify actual Cloudinary video upload/transcoding, autoplay rejection, posters, and bandwidth on Android Chrome/PWA and iOS Safari. No real provider upload was performed here.
- Verify actual authorized admin/seller/delivery/SHG accounts, search/location, cart and checkout in staging; targeted automated regressions do not replace every cross-portal device scenario.
- No new behavioral audience segmentation, analytics rankings, or personalized recommendations. Targeting is all visitors by supported storefront/device; category/product targeting is via real collection sources and CTA references.
- Frequency is browser storage based; simultaneous tabs are not an atomic cross-tab frequency lock. Version history is capped at 20. Rollback restores the previous publication, not an arbitrary historical version picker.
- Admin list filtering currently occurs after fetching matching records; selectors load the first 100 themes/deals. Very large content libraries need server-side indexed pagination/search for selectors.
- Mobile/desktop preview is a visual preview, not a full checkout or offer-eligibility simulation. No supplied brand-specific festival artwork was created or automatically published.
- Banner library still uses its existing browser-local date UI; Studio itself explicitly uses IST. Publish/reference validation and server UTC checks govern both.
- Existing build chunk-size warning and baseline full-suite failures remain release considerations.

## File inventory

Added:

- `backend/models/StorefrontExperience.js`
- `backend/shared/storefront.mjs`
- `backend/services/storefrontPolicy.service.js`, `storefront.service.js`
- `backend/routes/storefront.routes.js`
- `backend/verification/storefront.test.js`
- `forntend/src/utils/storefront.js`
- `forntend/src/modules/User/context/StorefrontContext.jsx`
- `forntend/src/modules/User/hooks/usePromotionNavigation.js`
- `forntend/src/modules/User/components/StorefrontMedia.jsx`, `PromotionalSplash.jsx`, `StorefrontSections.jsx`
- `forntend/src/modules/User/Storefront.css`
- `forntend/src/modules/Admin/components/StorefrontStudio.jsx`, `StorefrontStudio.css`
- `forntend/verification/storefront-ui.test.mjs`, `storefront-browser.mjs`
- `docs/storefront-studio.md`

Modified:

- `backend/controllers/banner.controller.js`; `backend/models/Banner.js`
- `backend/middlewares/error.middleware.js`, `upload.middleware.js`
- `backend/routes/index.js`, `admin.routes.js`, `banner.routes.js`; `backend/package.json`
- `forntend/package.json`
- Admin `components/BannersTab.jsx`, `components/LeftSidebar.jsx`, `routes/index.jsx`
- User `components/HeroBanner.jsx`, `PopularCategories.jsx`, `TopProducts.jsx`, `CouponsSection.jsx`, `FashionSection.jsx`, `ElectronicsSection.jsx`, `GroceriesSection.jsx`
- User `hooks/useProducts.js`, `pages/LandingPage.jsx`, `pages/CategoriesPage.jsx`, `pages/CampaignLandingPage.jsx`
- Local ignored regression fixture `backend/__tests__/api/seller-marketing-retirement.http.test.js` (stronger draft-list authorization expectations)

No source files were removed. No commit or deployment was made.
