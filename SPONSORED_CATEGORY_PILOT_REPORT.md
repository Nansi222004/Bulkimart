# Sponsored Category — non-billable pilot

Date: 23 October 2026. Continues the management-foundation release.

## Outcome and usability

The pilot is implemented and usable in an isolated non-production environment
after explicit configuration and admin authorization. It is **not enabled in
this workspace or deployed** by this task. No production configuration changed.

An approved current v2 campaign can receive a separate, audited pilot window.
Its funding remains `UNPAID`, its paid delivery remains `NOT_SCHEDULED`, and its
legacy status remains `DISABLED`. This does not waive paid funding requirements,
consume purchased service time, activate legacy ads, or recognize revenue.

Customer rendering supports CategoriesPage and DynamicCategorySection (the
header-category browsing experience), using the same responsive React code.
The pilot uses the existing category product card, extracted unchanged into a
shared file, existing normalization, product selection, wishlist and cart paths.

## Explicit activation contract

Both `ADVERTISING_MANAGEMENT_ENABLED=true` and
`ADVERTISING_CATEGORY_PILOT_ENABLED=true` are necessary. They default off.
Production aliases in NODE_ENV, DEPLOYMENT_ENV, APP_ENV, VERCEL_ENV or RENDER_ENV
block the pilot even if both flags are true. No real environment was edited.

1. Configure a v2 category package and submit/approve a seller campaign through
   the existing workflow. Existing commercial snapshots remain frozen.
2. An administrator with `advertising_review` (or superAdmin) opens the campaign,
   supplies a reason and explicit pilot start/end dates, and authorizes the pilot.
3. The pilot interval must be valid, not already expired, and no longer than the
   accepted package duration. Its independent schedule can be used for testing
   without starting the requested future paid service period.
4. Browse the campaign's category/ancestor in the appropriate storefront.
   Provide an in-range browsing/delivery location when the seller has a radius.
5. Stop the pilot through its admin action or switch off either gate. Existing
   suspension/cancellation also suppresses delivery and disables the pilot.

API: `POST /api/admin/advertising/campaigns/:id/pilot` with current `version`,
`reason`, boolean `enabled`, and timezone-qualified `startAt`/`endAt` when enabling.
Version checks and the existing transactional moderation history apply.

Customer API: `GET /api/advertising/placements?type=ecommerce|grocery&category=ID`
with optional bounded `exclude` product IDs and `lat`/`lng`. It requires no
customer authentication or identifying tracking data. Responses use no-store.
Public DTOs contain product data, selected variant, Sponsored disclosure,
NON_BILLABLE_PILOT mode and expiry; they omit campaign budgets, payment references,
admin identity and customer identity.

## Eligibility and organic protection

Each request checks explicit v2 membership, disabled legacy status, approved
current revision, matching pilot revision, independent pilot authorization and
date window, unpaid/no-paid-delivery states, supported placement/module and
snapshot consistency. The shared authoring validator rechecks approved active
seller/account/role/channel, active category ancestry, owned approved active
undeleted physical products, channel visibility and selected-variant stock/price.

Serving additionally uses `isWithinRadius`, the same helper used by cart/checkout,
and `resolveInventoryItem`. A configured radius with unknown coordinates fails
closed. An unconfigured radius retains the existing unrestricted meaning.
No rider availability, courier serviceability, same-day promise or delivery-time
guarantee is invented. Checkout continues to enforce its authoritative rules.

Cross-type listings are conservatively suppressed because the existing cart
chooses a basket from Product.type. Quick and Shop All primary-channel pilot
products are both tested. Digital, wholesale, SHG and image/search placements
are outside scope.

Organic queries, result order, totals and pagination were not changed. Loaded
organic product IDs are excluded from sponsorship; repeated sponsored IDs are
also removed. No organic products are dropped. If every candidate is already in
the organic batch, the sponsored block is intentionally absent. A small catalogue
may therefore show no extra block even with a valid pilot. To exercise the block,
use an eligible campaign product outside the loaded organic batch.

Category matching includes active descendants resolved server-side. Serving is
bounded to 2,000 category records, 40 candidate campaigns and four cards; it is
not a paid allocation/fairness mechanism. Large catalogues require a later indexed
serving design. A group with an ineligible selected product is conservatively
suppressed as a whole.

The optional frontend request has a four-second deadline and does not block
organic rendering. Failed/disabled requests leave no sponsored UI. Backend
infrastructure failures return an empty optional block without internal errors.
Client context/abort guards prevent stale category responses. Displayed pilots
refresh every 30 seconds and clear at schedule expiry; stock/suspension/flag
changes are reflected on the next refresh. This is not push-based invalidation.

## Telemetry and financial exclusions

Telemetry is explicitly deferred to the next task. No impression/click endpoint,
AdEvent collection, tracking identifier, signed event token, customer attribution,
or analytics claim was added. No API-returned card is counted as an impression.
Durable viewability/deduplication/privacy and retention semantics should be built
and verified together rather than inferred from this optional read API.

Payment collection, paid serving, CPC/CPM, refunds, tax calculations, invoices,
ledger recognition, attributed sales and ROAS remain disabled/unimplemented.
The public serving path is read-only, including variant inventory reads; it never
calls catalogue repair writes, gateway APIs, notifications or financial services.

## Exact files changed in this phase

Added:

- `backend/services/advertisingServing.service.js`
- `backend/routes/advertisingPublic.routes.js`
- `forntend/src/modules/User/components/CategoryProductCard.jsx`
- `forntend/src/components/advertising/SponsoredCategoryBlock.jsx`
- `forntend/verification/sponsored-category-ui.test.mjs`
- `forntend/verification/sponsored-category-browser.mjs`
- `forntend/verification/sponsored-category-browser-entry.jsx`
- `SPONSORED_CATEGORY_PILOT_REPORT.md`

Modified (some foundation files were already untracked at the start):

- `backend/models/advertising.schema.js`
- `backend/services/advertisingPolicy.service.js`
- `backend/services/advertisingEligibility.service.js`
- `backend/services/advertising.service.js`
- `backend/routes/advertising.routes.js`
- `backend/routes/index.js`
- `backend/config/advertising.env.example`
- `backend/verification/advertising.test.js`
- `forntend/src/components/advertising/AdvertisingWorkspace.jsx`
- `forntend/src/components/advertising/advertising.css`
- `forntend/src/modules/User/components/DynamicCategorySection.jsx`
- `forntend/src/modules/User/pages/CategoriesPage.jsx`
- `forntend/verification/advertising-ui.test.mjs`
- `SELLER_PAID_ADS_IMPLEMENTATION_REPORT.md` (historical report retained; continuation link appended)

Existing working-tree parcel/GST/payment/other changes were preserved. Existing
legacy 410 guards, paid-ranking exclusions, settlement behavior, pricing, ledgers,
discount campaigns and permissions were retained. Graph MCP tools were unavailable;
source was inspected directly after discovery. No dependencies were installed.

## Tests and builds actually executed

Baseline: existing advertising management suite **20 passed** before edits.

Latest backend advertising command, from backend:

```text
node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --runTestsByPath verification/advertising.test.js --silent --noStackTrace
```

**49 passed**, including 29 new pilot checks and the original 20. Covers explicit
authorization, permissions, schedules, flags/production aliases, revision binding,
legacy isolation, stock, seller suspension/activity/role, category/channel, ancestry,
Quick, cross-type exclusions, radius, duplicates, read-only behavior and fail-open.

Backend regressions:

```text
node verification/run-shopping-capacity-tests.mjs --config __tests__/jest.config.js --runInBand --runTestsByPath __tests__/api/seller-marketing-retirement.http.test.js __tests__/api/razorpay-webhook.http.test.js __tests__/services/inventory.service.test.js __tests__/api/wholesale.http.test.js __tests__/api/image-search.http.test.js --silent --noStackTrace
```

**202 passed, 5 suites.** Isolated test-owned databases; no application bootstrap.

Frontend command, from forntend:

```text
node --test --test-concurrency=1 verification/sponsored-category-ui.test.mjs verification/advertising-ui.test.mjs tests/image-search-ui.test.mjs tests/portal-startup.test.mjs
```

**42 passed** at that run. After adding the admin pilot action check, the two
advertising suites were rerun: **18 passed** (10 management, 8 customer).
Combined unique passing frontend checks across these commands: **43**.
These component/API tests use the repository hook harness, not a browser DOM.

Browser command:

```text
node verification/sponsored-category-browser.mjs
```

Passed at **320, 390, 768 and 1280 px**: no horizontal overflow, Sponsored disclosure,
keyboard focus/Enter navigation and selected-variant cart callback. Also passed
error/disabled/duplicate scenarios with organic content unchanged. Zero network
writes and no runtime exceptions. Actual components and shared card were exercised
with a test context and local fixture API; this is **not full application E2E**.
External browser requests were blocked. Temporary test-owned browser files were
cleaned after verifying their paths.

Both backend and frontend `npm run build` passed. Frontend retains the existing
large-chunk warning (main JS approximately 1.88 MB minified). `git diff --check`
passed with Windows line-ending warnings.

Known failures encountered:

- The extended original HTTP fixture hit the real mutation rate limiter; isolated
  routers per test fixed test interference without relaxing production limits.
- A new component assertion assumed text children were a single string; the
  actual DOM-class callback assertion replaced that assumption.
- Browser harness setup required the existing default FeedbackProvider export
  and explicit headless focus before keyboard dispatch; final browser checks pass.
- The additionally executed `tests/product-link.test.mjs` had **5 passes, 1 failure**:
  `document is not defined` in the hook test for pending/error content, originating
  in the untouched working-copy `LandingPage.jsx`. This task did not change that
  page or weaken its test. It remains an unresolved regression-suite limitation.
  No claim is made that the full repository test suite is green.

## Remaining blockers

No blocker remains for the explicitly gated non-billable category pilot in an
isolated non-production environment. Production is intentionally blocked. Default
flags remain off, and no campaigns/data/configuration were activated in this task.
Full application browser E2E and a real-device audit remain unverified. Telemetry,
signed event linkage and all financial/attribution phases remain separate work.
