# Bulkimart — Application Audit

Audit date 2026-11-04 · commit `76e6bc8` · read-only.

## 1. System inventory

| Component | Directory | Stack | Entry point | Auth |
|---|---|---|---|---|
| Backend API + Socket.IO | `backend/` | Node ≥ 20.9, Express 5.2.1, Mongoose, Socket.IO, Razorpay, Firebase Admin, Cloudinary, node-cron, Jest | `backend/index.js` → `routes/index.js` (`/api/*`) | JWT bearer (HS256, 30 d); `type` admin/user; `role` buyer/seller/delivery |
| Web SPA: customer site, seller portal, delivery web, admin panel | `frontend/src/modules/{User,Seller,Delivery,Admin}` | React + Vite | `frontend/src/main.jsx`, `App.jsx` | Tokens in `localStorage` (`adminToken`, `sellerToken`, `deliveryToken`, customer token) |
| Customer mobile app | `mobile-user/` | Expo 58, React Native 0.88.1, React 19.3 | `app/` (expo-router) | Server JWT |
| Seller mobile app | `mobile-seller/` | React Native CLI 0.88.1 (no Expo) | `App.js` | Server JWT |
| Delivery mobile app | `mobile-delivery/` | React Native CLI 0.88.1 | `App.js` | Server JWT |
| Background work | `backend/services/orderSweeper.service.js` | In-process `setInterval`: advertising lifecycle, parcels, seller notifications, pickup sync, unaccepted orders, broadcasts, finance automation | started in `index.js` after DB connect | — |
| Shared | `shared/serviceLimits.mjs`, `backend/shared/` | — | — | — |
| Deployment | `deploy.sh` (git pull → npm ci → build → PM2 restart), `vercel.json` (frontend) | PM2 on Hostinger (per comments) | — | — |

**API surface** (from `backend/routes/index.js`):
- Core: auth, users, sellers, categories, products, admin, cart, wishlist, tip-setting, cod-charge, campaigns, orders, coupons, delivery, payments, geo, banners, promotions, packaging, returns, privacy-policy, wallet
- Integrations: courier-events (Shiprocket), digital (e-books), helpline, notifications, tickets, support-chat
- Domains: media, storefront, advertising, gst-assistance, parcel-delivery, customer-services (legal), services
- Placeholder: `/analytics`

**Data models:** 77 Mongoose models under `backend/models/`. The financially relevant ones are:
- `Order`, `Payment`, `CheckoutAttempt`
- `SellerLedgerEntry`, `SellerPayout`, `DeliveryPayout`
- `WalletLedger`, `Commission`, `CommissionCurrent`, `FinancePolicy`
- `Return`, `CodChargeSetting`, `Coupon`, `CouponRedemption`
- `TaxInvoice`, `QuickCommerceFinancialSnapshot`

**Configuration dependencies:** documented in `backend/.env.example`. Strict integration modes are `OTP_MODE`, `FCM_MODE`, `MAPS_MODE`, `SHIPROCKET_MODE`, `RAZORPAY_MODE` and `PAYMENT_GATEWAY`. Mocks are allowed only with `ALLOW_MOCK_SERVICES` plus `STAGING_DATA_ISOLATED`.

## 2. Per-application coverage and findings

| Application | Coverage | Findings | Notes |
|---|---|---|---|
| Customer website | Checkout and payment summary rendering; HTML injection scan | F-007, F-013 | Amounts come from server quotes (`CheckoutPage.jsx` uses `summary.*` from the API). Responsiveness not re-audited; see the earlier `BULKIMART_MOBILE_RESPONSIVENESS_AUDIT.md`. |
| Customer mobile | `lib/paymentSummary.js` | — | Uses the server's `codFeeTotal` and totals |
| Seller portal / app | Product ownership, fulfilment ownership, payouts | F-002 (admin side) | Seller app source not reviewed screen by screen |
| Delivery web / app | OTP completion, COD amounts | F-003, F-010, F-011, F-014 | — |
| Admin panel | Route guards, finance and payout handlers | F-002 | Most of `admin.controller.js` (3,101 lines) not reviewed |
| Backend | See financial and security reports | F-001…F-020 | — |
| Notifications | OTP push only | F-010 | — |
| Support / Live Chat | Ownership queries and socket joins | — | Agent assignment and attachments not reviewed |
| Marketing / CMS, storefront, advertising | Not audited | — | — |
| SHG / CDS / membership | Retired in code: commission rejects `vendorType: 'shg'`; `cdsDiscount` is fixed at 0; Coins retired at checkout | — | Legacy fields remain for historical reads |
| Parcel, Legal services, GST assistance, Packaging, Wholesale, E-books, Image search | Not audited | — | Each has its own Razorpay webhook handler dispatched from `payment.controller.js:433-440`; the handlers were not reviewed |

## 3. End-to-end workflow trace (Customer → Seller → Delivery → Finance)

| Step | Implementation | Status |
|---|---|---|
| Place order | `createOrder` transaction: fence sellers → CheckoutAttempt (idempotency key) → decrement stock → wallet debit (if wallet) → Payment → Order (snapshot frozen in `pre('validate')`) → coupon redeem → clear cart | ✔ (F-001 affects wallet funding) |
| Pay online | initiate → Razorpay Checkout → verify or webhook → `settle()` | ✔ |
| Abandon unpaid | Client-initiated only | ✘ F-004 |
| Seller notified / accepts | `publishEligibleSellerOrder`; acceptance window enforced by the sweeper (Quick only) | ✔ |
| Rider assignment | `broadcastNewOrderToRiders` (Quick); seller-selected carrier for e-commerce | Partially reviewed |
| Pickup → deliver | OTP issued to customer → rider verifies → one transaction marks delivered, stamps return windows, credits rider (held for v2) | ✘ F-003 |
| COD cash | collect (at OTP) → remit (rider) → verify (different admin) → payment `paid` | ✔ |
| Seller earnings | Automation posts held → releases after return window → weekly payout reservation → admin settle with UTR | ✔ (F-002) |
| Cancel | Restore stock and coupon; wallet refunded immediately; online refund queued as obligation | ⚠ F-006 |
| Return | Item-level request → seller/admin decision → pickup (OTP) → receipt and inspection → refund (wallet or Razorpay obligation) → seller reversal | ✔ (F-011) |
| Exchange | Not implemented | F-016 |

## 4. Deployment, reliability and performance

- **F-005:** `deploy.sh` and `index.js` refer to `forntend/`; the repository has `frontend/`. This needs verification on the server.
- **F-008 / F-009:** in-memory OTP store and in-process sweepers. They are safe only with exactly one backend process. PM2 mode and instance count are not in the repository.
- **Startup:** fails fast on missing JWT, Cloudinary, storage or Razorpay configuration (good). Rates, delivery charge, COD charge, coin config and radius are cached in memory at boot and refreshed when an admin saves. With several processes, an admin save refreshes only the process that served it, while the COD charge cache has a 60 s TTL. Other caches were not checked for TTLs.
- **Graceful shutdown:** stops the sweeper. It does not close the HTTP server or the Mongo connection before the 10 s forced exit.
- **Logging and monitoring:** console only; no APM or alerting found in the repository.
- **Backups:** `backend/scripts/backupBulkimartTarget.mjs` exists; schedule and restore testing not verifiable from the repository.
- **Nginx, PM2 ecosystem, TLS:** not in the repository; not verifiable.
- **Supply chain (F-015):** backend `dependencies` all use `"*"`. `package-lock.json` exists, and `deploy.sh` uses `npm ci`, which honours the lock. The mobile READMEs record a past malware incident affecting `forntend/vite.config.js`. Keep pinned versions and review lockfile diffs.

## 5. Test inventory

| Suite | Location | Kind |
|---|---|---|
| Backend Jest (`npm test`) | `backend/__tests__/` (api, services, config, models, utils) | Mixed: supertest HTTP with mocked models, and mongodb-memory-server suites |
| Backend verification | `backend/verification/*.test.js` (≈ 60 files: financial-workflow, finance-gaps, coupon, advertising, parcel, reports…) | Separate jest config; run per script (`npm run test:financial-workflow`, etc.) |
| Backend scripts | `backend/tests/*.mjs` | Browser / live verification scripts (not run: they need running services) |
| Frontend | `frontend/tests`, `frontend/verification` (node:test plus browser scripts) | Not run in this audit |
| Mobile | `mobile-seller/__tests__`, `mobile-delivery/__tests__` | Not run |

**Coverage gaps observed:**
- No test references `/wallet/dev-topup` (F-001).
- No test sends mixed-case admin paths (F-002).
- No test covers OTP regeneration resetting attempts (F-003).
- No test covers expiry of unpaid online orders (F-004).
- `checkout-workflow.http.test.js` runs on mocked persistence, so it does not prove database-level atomicity.

## 6. Tests executed in this audit

**Command:** `cd backend && npm test -- --ci`. This is a Jest ESM run with an in-memory MongoDB 7.0.14; the setup deletes `MONGO_URI`/`MONGODB_URI`. It was run twice with identical results.

```
Test Suites: 11 failed, 58 passed, 69 total
Tests:       23 failed, 7 skipped, 960 passed, 990 total   (≈ 228 s)
```

| Failing suite | Cause (as observed) | Production-code defect? |
|---|---|---|
| `api/razorpay-webhook.http.test.js` | Suite fails to load: its `jest.unstable_mockModule('../../services/razorpay.service.js')` factory lacks `rupeesToPaise`, which `payment.controller.js` imports. The real service exports it (`razorpay.service.js:163`). | **No.** Stale test mock. Consequence: **webhook behaviour currently has no passing automated test.** |
| `api/checkout-workflow.http.test.js` (10 tests) | Every `POST /api/orders` returns 500 under the suite's mocked persistence. Root cause not isolated in this audit; likely mocks lagging behind newer checkout dependencies. | **Unverified.** Checkout idempotency, concurrency, coupon and cancellation-restore tests are therefore not passing. |
| `api/order-flow-acceptance.audit.test.js` (7 tests) | Timeout / read-only recovery assertions fail | Unverified |
| `api/checkout-address-contact.test.js` | `ENOENT …\forntend\src\modules\User\pages\CheckoutPage.jsx` | No. Test reads `../forntend` (same path mismatch as F-005). |
| `api/socket-transport.http.test.js` | `Cannot find module 'socket.io-client' from '../forntend/package.json'` | No. Same path mismatch. |
| `services/frontend-auth.static.test.js`, `services/referral-removal.static.test.js`, `services/onboarding-regressions.test.js`, `utils/seller-onboarding-draft.test.js`, `api/delivery-onboarding-upload.http.test.js` | Static/source tests over frontend files; failures consistent with the `forntend` path | Likely no; not individually confirmed |
| `api/seller-marketing-retirement.http.test.js` | 1 test (participation bookkeeping) | Unverified |

**Interpretation:**
- The suite is red. Several failures are test-infrastructure drift (the `forntend` → `frontend` rename, a stale mock), not proven product bugs.
- However, the two suites that matter most financially, the Razorpay webhook and the checkout workflow, are **not providing protection today**.
- The `verification/` finance suites (financial-workflow, finance-gaps, coupon-redemption, etc.) were not run in this audit.
- No frontend, mobile or browser tests were run, and no builds were produced.
