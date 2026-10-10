# Seller Paid Promotion / Advertisement System — Implementation Notes

This document lists every file touched for this feature, why it changed, which
functions were added, and — separately — every new database field, why it
exists, and where it lives. Nothing here duplicates the existing Banner,
Campaign, PhonePe, Notification, or Upload systems; all of those are reused
as-is (see "Existing systems reused" at the bottom).

## Backend — new files

| File | Purpose |
|---|---|
| `backend/models/PromotionPackage.js` | Admin-managed price list a seller buys a promotion slot from (name, duration, price, placement, maxProducts, isActive). Mirrors `PremiumPlan.js`'s snapshot discipline. |
| `backend/models/SellerPromotion.js` | The promotion/advertisement request itself — the core new domain model. State machine, ownership (`sellerId`), banner image, selected products, package snapshot, admin feedback, timestamps. |
| `backend/services/sellerPromotion.service.js` | `syncPromotionBanner(promotion)` — creates/updates the one linked `Banner` doc for a promotion (mirrors `campaign.controller.js`'s `syncLinkedBanner`). `disablePromotionBanner(promotion)` — turns the banner off without touching promotion status. `isPromotionEffectivelyActive(promotion)` — the customer-visibility gate (ACTIVE + not expired). `expireDuePromotions()` — one-shot sweep used by the sweeper below. |
| `backend/services/sellerPromotionSweeper.service.js` | `startSellerPromotionSweeper()` / `stopSellerPromotionSweeper()` — a `setInterval` sweeper (same shape as `shgSubscriptionSweeper.service.js`) that flips ACTIVE promotions past `expiresAt` to EXPIRED and disables their banner automatically, every 15 minutes. |
| `backend/controllers/sellerPromotion.controller.js` | All the domain's request handlers, in four sections: **PACKAGES** (admin CRUD + active-list for sellers), **SELLER** (create/edit/submit/resubmit/cancel/list/detail), **PAYMENT** (`initiatePromotionPayment`, `settleSellerPromotionPayment`, `promotionPaymentReturn` — reusing `services/phonepe.service.js`), **ADMIN** (list/detail/approve/request-changes/reject/disable), **CUSTOMER** (`getActivePromotionsPublic`, `getPromotionPublic` — the promotion landing page's data source). |
| `backend/routes/promotion.routes.js` | Public routes: `GET /`, `GET /:id`, and `GET /payment/return/:merchantOrderId` (PhonePe's browser return, mounted before any auth — same placement `premium.routes.js` uses). |

## Backend — modified files

| File | What changed | Why |
|---|---|---|
| `backend/models/Banner.js` | Added `'SELLER_PROMOTION'` to `ACTION_TYPES`; added `targetPromotion` (ref `SellerPromotion`). | Lets a Banner point at a promotion, exactly the way it already points at a Campaign via `targetCampaign` — reuses the existing Banner engine instead of building a second one (Section 22/32 of the spec). |
| `backend/models/Payment.js` | Added `sellerPromotionId` (ref `SellerPromotion`). | A fourth payment-purpose discriminator, same pattern as `premiumMembershipId`/`shgSubscriptionId` — what the shared PhonePe webhook branches on. |
| `backend/controllers/payment.controller.js` | Imported `settleSellerPromotionPayment`; added an `else if (payment.sellerPromotionId)` branch inside `phonepeWebhook`. | Routes the seller-promotion payment purpose through the *existing* shared webhook — no second webhook endpoint created. |
| `backend/controllers/banner.controller.js` | `getBanners`: added `.populate('targetPromotion', 'status expiresAt')`; added a `SELLER_PROMOTION` case to the stale-target filter that calls `isPromotionEffectivelyActive`. | So an expired/disabled promotion's banner silently drops out of the customer feed, same as an expired Campaign banner already does. |
| `backend/routes/seller.routes.js` | Imported the new seller-side promotion handlers; added the `/promotions*` route block under `requireApprovedSeller` (same section style as the existing `/campaigns*` block). | Exposes the seller-facing API surface. |
| `backend/routes/admin.routes.js` | Imported the new admin promotion + package handlers; added `/promotions*` and `/promotion-packages*` route blocks. | Exposes the admin-facing API surface. |
| `backend/routes/index.js` | Imported and mounted `promotionRoutes` at `/api/promotions`. | Exposes the public/customer-facing API surface. |
| `backend/index.js` | Imported and started `startSellerPromotionSweeper()` alongside the other sweepers. | Automatic expiry (Section 28) without depending on any screen being opened. |

## Frontend — new files

| File | Purpose |
|---|---|
| `forntend/src/modules/Seller/components/SellerPromotionsTab.jsx` | Seller Dashboard → Promotions: list with status filters, a 5-step create/edit wizard (Banner → Shop (read-only, auto-loaded) → Products (own products only) → Package → Preview), detail view with the persistent admin-feedback banner, submit/resubmit/cancel/pay actions. |
| `forntend/src/modules/Admin/components/SellerPromotionsTab.jsx` | Admin Marketing & CMS → Seller Promotions: searchable/filterable queue, review drawer showing banner + seller + shop + products + package in one place, Approve / Request Changes (with feedback textarea) / Reject / Disable actions. |
| `forntend/src/modules/Admin/components/PromotionPackagesTab.jsx` | Admin Marketing & CMS → Promotion Packages: CRUD table for the price catalog. |
| `forntend/src/modules/User/pages/PromotionLandingPage.jsx` | The customer-facing page a promotion banner click lands on — shop name, seller name, address, description, and the live (not snapshotted) list of selected, still-available products. |

## Frontend — modified files

| File | What changed | Why |
|---|---|---|
| `forntend/src/modules/Seller/components/LeftNav.jsx` | Added a `promotions` nav item. | Makes the new tab reachable from the sidebar (spec's "not simply a component left inaccessible" requirement). |
| `forntend/src/modules/Seller/pages/DashboardPage.jsx` | Imported `SellerPromotionsTab`; added `promotions: 'Promotions'` to `TAB_TITLES`; added the `case 'promotions'` branch. | Wires the nav item to the actual component. |
| `forntend/src/modules/Admin/components/LeftSidebar.jsx` | Added `seller-promotions` and `promotion-packages` links to the existing "Marketing & CMS" group. | Places both new admin screens where the spec asks for them (Section 13/14). |
| `forntend/src/modules/Admin/routes/index.jsx` | Imported both new admin tabs; added their `case` branches. | Wires the nav links to the actual components. |
| `forntend/src/modules/User/context/UserContext.jsx` | Added `selectedPromotionId`/`setSelectedPromotionId` state (and exported it), same overlay pattern as the existing `selectedCampaignId`. | Lets a banner click open the promotion landing page as an overlay, exactly the way a Campaign banner already does. |
| `forntend/src/modules/User/components/HeroBanner.jsx` | Added a `SELLER_PROMOTION` branch to `handleBannerClick` that calls `setSelectedPromotionId`. | The actual click → navigation wiring (Section 24). |
| `forntend/src/modules/User/pages/LandingPage.jsx` | Imported `PromotionLandingPage`; added a `{selectedPromotionId && ...}` overlay block, same pattern as the existing Campaign overlay. | Renders the landing page when a promotion is selected. |

## New database fields — what and why

**`PromotionPackage` (new collection)**
- `name`, `durationDays`, `price`, `placement` (`'HOME_HERO'` only — the one slot any frontend component actually renders), `maxProducts`, `isActive` — the admin-configurable price list itself (Section 12/13). No hardcoded ₹500 anywhere; every price a seller sees comes from this collection.

**`SellerPromotion` (new collection)** — `backend/models/SellerPromotion.js`
- `sellerId` — ownership, always derived server-side from `req.seller` from the authenticated session, never trusted from the request body (Section 30/31).
- `title`, `description`, `bannerImage`, `selectedProducts[]` — the advertisement content itself.
- `packageId` + `packageNameSnapshot`/`durationDaysSnapshot`/`amountSnapshot`/`placementSnapshot` — a frozen copy of the package terms at submission time, so a later admin price edit never rewrites what a seller already agreed to (same discipline as `PremiumMembership.planName/durationMonths/amount`).
- `status` (state machine: DRAFT → PENDING_REVIEW → CHANGES_REQUESTED → PENDING_REVIEW → APPROVED → PAYMENT_PENDING → ACTIVE → EXPIRED, plus REJECTED/CANCELLED/DISABLED) — never reused from Campaign's status enum, because the two are governed by different rules.
- `adminFeedback` — the persistent feedback text (Section 18: "must persist, not just a toast").
- `paymentId`, `linkedBannerId` — pointers into the existing `Payment` and `Banner` collections, never duplicated data.
- `submittedAt`, `changesRequestedAt`, `resubmittedAt`, `approvedAt`, `rejectedAt`, `activatedAt`, `expiresAt` — the audit-history timestamps the spec asks for (Section 36).

**`Banner` (existing collection, extended)** — `backend/models/Banner.js`
- `targetPromotion` (ref `SellerPromotion`) + `'SELLER_PROMOTION'` added to the `actionType` enum — the single new field needed to let the existing Banner engine point at a promotion, exactly like it already points at a Campaign via `targetCampaign`.

**`Payment` (existing collection, extended)** — `backend/models/Payment.js`
- `sellerPromotionId` (ref `SellerPromotion`) — the fourth payment-purpose discriminator (alongside the existing `orderId`/`shgSubscriptionId`/`premiumMembershipId`), so the one shared PhonePe webhook can tell which domain to settle into.

No field was added to `Product` — `Product.price`/`mrp`/`discountPercent` are never read or written anywhere in this feature (Section 31/43's hard scope boundary).

## Existing systems reused (nothing rebuilt)

- **Banner engine** — `Banner.js`/`banner.controller.js`/`HeroBanner.jsx` — extended with one action type, never duplicated.
- **PhonePe payment integration** — `services/phonepe.service.js`, the shared `phonepeWebhook` in `payment.controller.js` — reused exactly as Premium Membership uses it (`createPayment`, `getOrderStatus`, `verifyWebhookSignature`, the transaction-wrapped idempotent settle pattern).
- **Upload pipeline** — `middlewares/upload.middleware.js` (`uploadSingle`) + `services/cloudinary.service.js` (`uploadToCloudinary`) — same call as every other image upload in the codebase.
- **Notification model** — `models/Notification.js`, used with `type: 'promotion'` (an enum value already defined, previously used by Campaign invitations).
- **Admin auth** — `protect, requireAdmin` on `admin.routes.js` (already applied once for the whole router).
- **Seller auth/ownership** — `requireApprovedSeller` middleware, `req.seller` — the same gate every other seller-panel route already uses.
- **Response envelope** — `ok`/`created`/`httpError`/`paginated`/`getPagination` from `utils/response.js`.

## What was deliberately left out (per the spec's hard scope boundary)

No CPC/CPM, bidding, ad auction, sponsored search ranking, ad wallet, impression/click billing, or product-price/discount logic was implemented — none of it was asked for, and Campaign (the discount system) was not touched.

## Verified (V0)

- `node --check` passes on every backend file listed above.
- `npx vite build --mode development` completes with no errors (only the pre-existing "chunks larger than 500 kB" warning, unrelated to this feature).
- A throwaway live test script (`backend/_tmp_test_sellerPromotion.mjs`, run once against the real database and then deleted, per this project's testing convention) exercised: package CRUD, draft creation, product-ownership rejection (cannot select another seller's product), submit validation (banner required), the full PENDING_REVIEW → CHANGES_REQUESTED → resubmit → PENDING_REVIEW → APPROVED cycle, payment settlement (promotion → ACTIVE, `expiresAt` computed from the package snapshot, linked Banner created and active), settlement idempotency (a second COMPLETED settle is a no-op), public visibility while ACTIVE and its disappearance after `disable`, and the REJECTED path — **33 assertions, 33 passed, 0 failed**.

---

## V1 refinement — module split (QUICK/E-COMMERCE) + approval-based start date

The client refined the business rules after V0 shipped. Two changes, applied on top of the same domain (no rebuild):

1. **"One advertisement = one module."** A promotion now commits to exactly `QUICK` or `ECOMMERCE` at creation and never changes — products, packages, and the synced banner are all scoped to it. A seller wanting both creates two separate promotions.
2. **CRITICAL — the package duration clock starts at Admin approval, not at payment.** `activatedAt`/`expiresAt` are computed once, in `approveSellerPromotion`, from `approvedAt + durationDaysSnapshot`. Payment settlement never recomputes them — it only flips `ACTIVE` (still within the approval-based window) or `EXPIRED` (seller paid too late). A seller waiting on review loses zero paid days; a seller who delays paying after approval gets no extra days either.

### Backend — modified files (V1)

| File | What changed | Why |
|---|---|---|
| `backend/models/SellerPromotion.js` | Added `module` (enum `QUICK`/`ECOMMERCE`, required, exported as `SELLER_PROMOTION_MODULES`) fixed at creation. Doc comment rewritten to state the approval-based-clock rule as a hard invariant. | Section 11's "one advertisement = one module"; documents the critical date rule at the source of truth. |
| `backend/models/PromotionPackage.js` | Added `module` (enum, required) + a `{module, isActive}` index. | Section 5/6 — QUICK and E-commerce packages are priced and listed completely separately. |
| `backend/services/sellerPromotion.service.js` | Added `MODULE_TO_CHANNEL` map (`QUICK`→`'grocery'`, `ECOMMERCE`→`'ecommerce'`, reusing the exact values `Product.type`/`Banner.type` already use) and `productMatchesModule(product, module)`. `syncPromotionBanner` now sets the synced Banner's `type` from the promotion's module instead of `'general'`, so a QUICK ad's banner only ever appears in the Quick customer feed. `expireDuePromotions` now also expires `APPROVED`/`PAYMENT_PENDING` promotions whose approval-based window closed unpaid, not just `ACTIVE` ones. | Section 29/30 (module-correct banner placement); Section 26/28 (an unpaid approved ad must not sit in the queue forever once its window has passed). |
| `backend/controllers/sellerPromotion.controller.js` | `createPromotion` now requires `module` in the body. `updatePromotion` validates `selectedProducts` against `productMatchesModule` and `packageId` against `pkg.module === promotion.module`, both 400 on mismatch. `listActivePromotionPackages` requires a `?module=` query param (400 without one) so a seller only ever sees their own module's packages. `listPromotionPackagesForAdmin`/`listSellerPromotionsForAdmin` accept an optional `?module=` filter. **`approveSellerPromotion`** now computes and persists `approvedAt`/`activatedAt`/`expiresAt` (the critical change). **`settleSellerPromotionPayment`** no longer computes `activatedAt`/`expiresAt` at all — it only decides `ACTIVE` vs `EXPIRED` by comparing `now` against the already-fixed `expiresAt`, and its post-commit notification is now conditional on which of those it landed on. `createPromotionPackage`/`updatePromotionPackage` validate/accept `module` (rejected as immutable on update). | Implements both V1 rules end to end; `module` immutability protects against a package's pricing history moving between modules after purchases exist against it. |

### Frontend — modified files (V1)

| File | What changed | Why |
|---|---|---|
| `forntend/src/modules/Seller/components/SellerPromotionsTab.jsx` | Rewritten wizard: **Module** is now step 1 (creates the promotion immediately on confirm, since the backend requires `module` at creation) and is locked/un-back-able afterwards; **Products** and **Package** steps now fetch module-scoped data (`/api/products/seller/mine?type=<grocery|ecommerce>`, `/api/sellers/promotions/packages?module=...`). List rows and the detail view show a module badge; the APPROVED-state banner now tells the seller their window started at approval and won't move. | Mirrors the backend's module-first, approval-clock rules in the actual flow the seller experiences. |
| `forntend/src/modules/Admin/components/SellerPromotionsTab.jsx` | Added a Module filter dropdown and a Module column in the queue table and the review drawer's title. | Section 18/19 — admin needs to review/report per module. |
| `forntend/src/modules/Admin/components/PromotionPackagesTab.jsx` | Added a Module filter dropdown, a Module column, and a Module select in the create/edit form (disabled once a package exists, matching the backend's immutability rule). | Section 4-8 — packages are configured per module. |

### Verified (V1)

- `node --check` passes on every file touched above; `npx vite build --mode development` completes cleanly.
- A second throwaway live test script (`backend/_tmp_test_promo_v1.mjs`, run once and deleted) specifically exercised the two new rules: creating QUICK/ECOMMERCE packages and confirming a seller's package list for one module never includes the other's; rejecting an E-commerce product/package on a QUICK promotion (400 in both cases); and, the critical date test the client asked for by name — approving a promotion after simulating a 1-day review wait and confirming `expiresAt = approvedAt + durationDaysSnapshot` (not `submittedAt`-based), then paying it and confirming `expiresAt`/`activatedAt` are **byte-identical** before and after settlement, then a second scenario where payment happens after the approval-based window has already closed and confirming the promotion lands on `EXPIRED` (paid but not activated) rather than granting a fresh window. **24 assertions, 24 passed, 0 failed.**
