# Seller Paid Ads — management foundations

Scope: versioned domain, dynamic packages, seller/admin authorization, moderation,
policy configuration and portal UI foundations. This is not the complete paid
advertising release. It implements the policy-independent scope confirmed by the
user after the original implementation request.

## Safety and baseline

The starting branch was `main`, with existing parcel/GST and related changes.
Those changes were preserved; overlapping route/UI files received narrow patches.
Graph MCP tools were unavailable, so targeted source inspection was used.
The retirement audit and removal report were read again before editing.

No deployment, service restart, live database access, data/index migration,
package installation, real payment, refund or notification was performed.
Tests used disposable MongoDB replica sets and synthetic identities. Application
bootstrap was never started (its database initialization contains writes).
The frontend build produced local generated assets, without publishing them.

## Classification

| Functionality | Status |
| --- | --- |
| Explicit v2 campaign/package schema in retained collections | Implemented and tested |
| Seller ownership, portal identity, live seller approval | Implemented and tested |
| Admin review/configuration permission separation | Implemented and tested |
| Draft editing, submission, review, change requests, rejection, suspension | Implemented and tested |
| Revision conflicts and concurrent moderation | Implemented and tested |
| Dynamic package prices/durations/product limits/categories | Implemented and tested |
| Package activation/deactivation and permanent archival | Implemented and tested |
| Versioned accepted price/duration/policy snapshots | Implemented and tested |
| Explicit seller confirmation of current package version | Implemented and tested |
| Seller/admin UI foundations | Implemented but not fully verified: component tests/build, no browser/device audit |
| Tax/pause/cancellation/refund/attribution configuration | Partially implemented: validated draft configuration and snapshots; no operational approval workflow |
| Customer serviceability and sponsored category serving | Not implemented |
| Razorpay advertising collection, settlement and ledger recognition | Blocked pending policy/configuration; integration not implemented |
| Advertising refunds and reconciliation | Blocked pending policy/configuration; integration not implemented |
| Impression/click events, attribution processing and analytics | Not implemented |
| Sponsored search, CPC/CPM and other placements | Not implemented |

## Files added

- `backend/models/advertising.schema.js`
- `backend/services/advertising.service.js`
- `backend/services/advertisingEligibility.service.js`
- `backend/services/advertisingPolicy.service.js`
- `backend/routes/advertising.routes.js`
- `backend/config/advertising.env.example`
- `backend/verification/advertising.test.js`
- `forntend/src/components/advertising/AdvertisingWorkspace.jsx`
- `forntend/src/components/advertising/advertisingApi.js`
- `forntend/src/components/advertising/useAdvertisingNavigation.js`
- `forntend/src/components/advertising/advertising.css`
- `forntend/verification/advertising-ui.test.mjs`
- This report.

## Existing files modified by this task

- `backend/models/SellerPromotion.js`: optional explicit v2 advertising subdocument;
  new records retain disabled legacy status; no defaults opt historical records in.
- `backend/models/PromotionPackage.js`: optional v2 configuration and category placement.
- `backend/routes/index.js`: mount separate advertising routers before broad portal routers.
- `backend/controllers/sellerPromotion.controller.js`: historical settlement cannot update a v2 promotion.
- `forntend/src/modules/Seller/components/LeftNav.jsx`: capability-gated navigation.
- `forntend/src/modules/Seller/pages/DashboardPage.jsx`: dedicated workspace tab.
- `forntend/src/modules/Admin/components/LeftSidebar.jsx`: permission/capability-gated navigation.
- `forntend/src/modules/Admin/routes/index.jsx`: dedicated workspace tab.

Existing Payment, product price, payout, ledger, delivery settlement, discount and
customer discovery code was not changed by this task. Pre-existing working-copy
changes in some of those areas belong to the earlier work.

## Domain and API behavior

`advertisingVersion: 2` is mandatory for new management queries. Legacy status is
kept `DISABLED`; review, funding and delivery are separate fields inside
`advertising`. Every mutation uses the current document version; material edits
advance the content revision, clear terms/approval and return to draft.

Submission requires a future requested start, eligible owned products/variants,
matching channel/category and the seller-confirmed package version. It freezes
package price in integer paise, duration, placement, module, description, limits,
and policy configuration. Admin changes do not reprice submitted campaigns.
Approval validates live product/seller eligibility again and records the approved
content revision. It does not create service dates or collect money.

Review decisions have actor, reason, timestamp, revision and resulting state.
Seller DTOs omit actor identifiers. There is no private-notes field exposed as
seller feedback. History is bounded; campaigns with 500 actions require a new
record rather than losing old audit events.

Management endpoints under `/api/sellers/advertising`:

- `GET /capabilities`, `/products`, `/packages`, `/packages/:id`
- `GET /campaigns`, `/campaigns/:id`
- `POST /campaigns`, `PATCH /campaigns/:id`
- `POST /campaigns/:id/submit`
- `POST /campaigns/:id/actions` (unpaid cancellation only)
- `POST /campaigns/:id/payment-attempts`, `/payment-verification`: owned-resource
  check followed by explicit 503; no gateway call or payment record is created.

Admin endpoints under `/api/admin/advertising`:

- `GET /capabilities`, `/campaigns`, `/campaigns/:id`
- `GET /packages`, `/packages/:id`, `POST /packages`, `PATCH /packages/:id`
- `POST /campaigns/:id/approve`, `/request-changes`, `/reject`, `/suspend`

Seller reads and edits derive seller identity from the live authenticated seller.
The signed seller portal role is mandatory. Admin operations require
`advertising_review` or `advertising_configure` as appropriate; `superAdmin`
retains its explicit bypass. Finance/reconciliation permissions do not grant
campaign review or configuration.

Lists use server pagination. Campaign filters support review/funding/delivery.
The UI currently exposes review filtering. New responses use existing response
helpers and private/no-store caching. Mutation throttling is supplementary,
process-local protection, not a financial concurrency mechanism.

## Dynamic configuration and validation

Package prices and durations have no seeded values or fixed duration dropdown.
The UI accepts administrator-entered values. Backend safety bounds are 1–365
days, 1–20 products and 1–100,000,000 paise; these are validation limits, not
commercial packages. Categories must be active and belong to the package module.
Each package belongs to one module; create separate Quick and Shop All offers.
Only category placement is supported. Search/banner packages cannot be enabled
until their implementations and placement validation are added.

Policy drafts include seller pause, cancellation, rejection, suspension, unused
service, refunds, tax treatment/issuer/calculation/credit notes, and optional
attribution window, conversion event and model. No tax rate or attribution
duration is defaulted. Supported policy vocabulary is PAID/DELIVERED and
FIRST_CLICK/LAST_CLICK; these settings do not enable attribution processing.
Package version is the policy snapshot version. No operational approval is
inferred from saving policy text.

Archived packages cannot be reactivated. Price updates and archival do not
rewrite accepted snapshots. Newly submitted campaigns must select a currently
available package; approved historical commercial terms remain frozen.

## UI foundations

Seller and Admin workspaces reuse existing portal shells, bounded request helper,
session credentials and history-based tab routing. Advertising logic is outside
SellerContext. New navigation is hidden until server capabilities authorize it.
Direct routes show disabled or denied states safely.

Seller foundation includes paginated campaign cards, review filters, detail and
history, product/variant selection, module/category/package steps, schedule,
summary confirmation, draft save/edit, terms confirmation, submission and unpaid
cancellation. Product selectors use an owned, bounded API with minimal fields.

Admin foundation includes permission-separated review and package management,
versioned package edits, enable/disable/archive, policy drafts and moderation.
No pretend payment button or fabricated performance figures are present.

Remaining UI work: customer-style visual preview, product thumbnails/details in
campaign history, full analytics/billing tabs, delivery/funding filter controls,
all-status KPI aggregation, and browser/mobile/accessibility verification.
The package selector currently loads at most 100 active packages; larger
inventories need paginated selection. Non-billable customer placement testing
was permitted but is not included in this foundation release.

## Verification actually performed

Baseline before edits: retirement and account lifecycle suites, **15 tests passed**.

Latest backend commands:

```text
node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --runTestsByPath verification/advertising.test.js verification/gst-assistance.test.js verification/parcel-routing.test.js --silent --noStackTrace
```

**51 tests passed, 3 suites.** Includes 20 new advertising integration checks.

```text
node verification/run-shopping-capacity-tests.mjs --config __tests__/jest.config.js --runInBand --runTestsByPath __tests__/api/seller-marketing-retirement.http.test.js __tests__/services/account-lifecycle.test.js __tests__/api/razorpay-webhook.http.test.js --silent --noStackTrace
```

**19 tests passed, 3 suites.** No retirement tests were weakened or rewritten.

Frontend regression/component command:

```text
node --test --test-concurrency=1 tests/auth-role.test.mjs tests/portal-startup.test.mjs tests/seller-notifications.test.mjs verification/advertising-ui.test.mjs
```

**86 tests passed.** Includes 9 new actual-component/API-contract checks. These
use the existing hook harness, not a browser DOM or real device.

Backend `npm run build` passed. Frontend `npm run build` passed, with the existing
large-bundle warning (main JS approximately 1.87 MB minified). `git diff --check`
passed with Windows line-ending warnings. Full repository suites were not run.
Existing frontend fixtures emitted notification timeout warnings despite passing.

Early failures: the new backend fixture initially omitted the variant identity
generated by existing Product hooks; the fixture was corrected. One frontend
assertion required whitespace normalization. Existing retirement navigation tests
exposed an always-visible new link; capability-gated navigation fixed it without
changing the retirement tests.

## Feature flags, release dependencies and rollback

`ADVERTISING_MANAGEMENT_ENABLED` defaults off. The example file does not change
an environment. No enable flag can turn on payment or delivery in this release;
capabilities explicitly report both as false.

Before any real advertising release:

1. Approve tax/invoice/credit-note, pause/refund and recognition policies.
2. Implement dedicated v2 Payment purpose, verified Razorpay dispatch, ledger
   isolation, refund obligations and financial reconciliation tests.
3. Implement customer-context serviceability, disclosed category placement,
   signed serving tokens and durable deduplicated events.
4. Implement approved attribution policy and item-level return/cancellation
   reconciliation before reporting attributed revenue or ROAS.
5. Verify replica-set topology, indexes, multi-process behavior, browser/mobile
   behavior and full relevant regressions in isolated staging.
6. Keep search/CPC/CPM/banner releases separately gated and tested.

Rollback for this foundation is to disable management and hide navigation; no
records need deletion. Future financial rollback must retain authenticated
reconciliation/refund access even if new authoring/serving is disabled. Do not
remove schema support after v2 records have been saved. Existing legacy 410
guards, notification retirement filters and paid-ranking exclusions are intact.

## Subsequent non-billable category pilot

The foundation description above is retained as the historical release record.
The next phase adds separately gated, non-production pilot authorization and
customer category placements without changing funding or enabling paid delivery.
See [SPONSORED_CATEGORY_PILOT_REPORT.md](SPONSORED_CATEGORY_PILOT_REPORT.md) for the
exact continuation changes, verification results, activation requirements and
remaining limitations.
