# Bulkimart — Complete System Audit (Main Report)

| | |
|---|---|
| Audit date | 2026-11-04 |
| Repository state | `main` @ `76e6bc8` ("website ui fix"), working tree clean at start |
| Mode | Read-only analysis. No source code, database, payment, refund, payout or deployment action was performed. |
| Evidence base | Source code in this repository, one isolated local probe (no database), and the existing backend Jest suite (in-memory MongoDB). No production database, gateway dashboard, server, PM2 or Nginx access was available. |

Companion reports in this folder:

- [BULKIMART_FINANCIAL_AUDIT.md](BULKIMART_FINANCIAL_AUDIT.md): money flows, formulas and verdicts
- [BULKIMART_SECURITY_AUDIT.md](BULKIMART_SECURITY_AUDIT.md): authentication, authorization and abuse paths
- [BULKIMART_APPLICATION_AUDIT.md](BULKIMART_APPLICATION_AUDIT.md): inventory, per-app coverage, workflows, deployment, tests
- [BULKIMART_RECONCILIATION_REPORT.md](BULKIMART_RECONCILIATION_REPORT.md): reconciliation formulas, read-only queries, scenario matrix
- [BULKIMART_REMEDIATION_PLAN.md](BULKIMART_REMEDIATION_PLAN.md): staged fix plan

---

## 1. Executive summary

**Overall condition.** The core financial engine is well designed: checkout pricing, Razorpay verification, the frozen per-order financial snapshot, the seller ledger, payout reservation and settlement, and refund compensation. It uses integer paise, transactions, idempotency keys, immutable snapshots and compensating reversal entries. In the paths read, no arithmetic defect was found in pricing, commission, GST-inclusive splitting, or refund allocation.

The serious problems are outside the arithmetic. They are an exposed developer endpoint, an authorization gate that can be bypassed, a delivery-OTP weakness, and lifecycle gaps.

**Production readiness: NOT READY.** One P0 finding allows unlimited free money:

| ID | Severity | Status | Summary |
|---|---|---|---|
| F-001 | **P0** | Confirmed (code) | `POST /api/wallet/dev-topup` lets **any signed-in customer credit any amount to their own wallet**. Wallet balance is accepted as payment at checkout, so goods can be obtained free and sellers are paid from platform funds. The route has no environment guard and has existed since the first commit. |
| F-002 | P1 | Confirmed (local probe) | The `manage_finance` gate on admin routes is a case-sensitive regex, but Express routing is case-insensitive. Any admin account (including `moderator`) can reach payout settlement, finance policy, commission rules, COD write-off and refund recovery by changing letter case in the URL, e.g. `/api/admin/Finance/policy`. |
| F-003 | P1 | Confirmed (code) | The rider can regenerate the delivery OTP without limit, and each regeneration resets the 5-attempt counter. The 4-digit code can therefore be brute-forced, so a delivery (including COD) can be marked complete without the customer. |
| F-004 | P1 | Confirmed (code) | Unpaid online orders are never expired server-side. Stock and coupon uses taken at checkout stay locked until the customer manually abandons the order. |
| F-005 | P1 | Confirmed in repo; production impact unverified | `deploy.sh` and `backend/index.js` reference `forntend/`, which does not exist in the repository (`frontend/` does). Under `set -e` the deploy script aborts before `pm2 restart`. |

**Critical financial risks:** F-001 (direct monetary loss), F-003 (false delivery completion), F-004 (inventory and coupon lock-up), F-006 (cancellation refunds depend on manual admin processing).

**Critical security risks:** F-001, F-002, F-003; also 30-day non-revocable JWTs stored in `localStorage` (F-007).

**What was verified as sound** (details in the financial report):

- The server recomputes prices.
- The coupon is evaluated from the code only.
- Razorpay signatures (payment and webhook) use HMAC with timing-safe comparison.
- The live amount is re-fetched from Razorpay.
- A capture journal prevents double fulfilment.
- The frozen commission snapshot conserves every paisa.
- Payout reservation runs in a transaction behind a seller fence.
- Payout settlement requires a reservation, a unique transfer reference and beneficiary review.
- Refunds are capped at the captured or collected amount.
- Commission reversal is proportional and idempotent.

## 2. Application audit summary

| Application | Location | Coverage in this audit | Key issues | Build/test status |
|---|---|---|---|---|
| Backend API | `backend/` (Express 5.2.1, Mongoose, Socket.IO) | **Deep** for payments, checkout, commission, ledger, payouts, COD, refunds, auth and delivery OTP. **Partial** for admin, seller and support. **Not audited:** parcel, legal, GST assistance, advertising billing, packaging, wholesale, e-book, image search. | F-001…F-009 | See §7 |
| Customer website, seller portal, delivery web, admin panel | `frontend/` (React + Vite, one SPA with `User`, `Seller`, `Delivery`, `Admin` modules) | **Light**: checked whether displayed amounts come from the server (they do), checked for HTML injection (none outside static `<style>`), and checked token storage | F-007, F-014 | Not built in this audit |
| Customer mobile app | `mobile-user/` (Expo 58, RN 0.88.1) | **Light**: payment summary uses server quotes | none confirmed | Not built |
| Seller mobile app | `mobile-seller/` (RN CLI 0.88.1) | **Inventory only** | README states "never installed, built or run" (may be stale) | Not built |
| Delivery mobile app | `mobile-delivery/` (RN CLI 0.88.1) | **Inventory only** | Same README caveat | Not built |
| Background jobs | `backend/services/orderSweeper.service.js` (in-process `setInterval`) | Read | F-004, F-009 | — |
| Notifications | `notification.service.js`, FCM | Not audited in depth | F-010 | — |
| Support / Live Chat | `supportChat.*`, `ticket.*`, `socket/` | Ownership checks sampled; socket room joins are bound to the token identity | none confirmed | — |

## 3. Financial audit summary

| Area | Verdict | Notes |
|---|---|---|
| Order pricing | **Correct in code** | `pricing.service.js`: subtotal − coupon + delivery (+ same-day) + tip, in paise; GST is inclusive and only extracted, never added |
| Payment (Razorpay) | **Correct in code** | Amount and currency are checked against both the attempt and `payment.amount`; capture is idempotent; late or extra captures become refund obligations |
| Wallet payment | **BROKEN: P0** | F-001: wallet credit can be self-issued |
| COD | Correct with minor gaps | Fee is charged once; collection is capped at the rounded due amount; verification is two-person. The rounding residual is not booked (F-012). |
| Commission | **Correct in code** | Current-rule pointer; product > category > channel precedence; frozen at order creation; a missing rule holds the order (`held_missing_rule`) |
| Seller earnings | **Correct in code** | Platform-funded discount policy: seller is paid on gross; commission is charged on the discounted base; TCS/TDS withheld |
| Escrow / return hold | **Correct in code** | Earnings move held → eligible only after the return window and resolution of open returns |
| Refunds | Correct; process gap | Proportional allocation matches the snapshot. Cancellation refunds of online orders wait for manual admin processing (F-006). |
| Settlement / payouts | **Correct in code**; authorization gap | F-002 lets non-finance admins reach settlement endpoints |
| GST | Implemented consistently; **tax policy unverified** | No CGST/SGST/IGST split; delivery fee is untaxed by policy; Easy Returns charge sits inside the item price (F-018, F-019); needs professional validation |
| Delivery finance | Correct in code; integrity risk | F-003 can create earnings for an undelivered order |
| Reconciliation | **Not executed on data** | No database access. Read-only queries are provided in the reconciliation report. |

Platform financial correctness **cannot be declared**: F-001 is open, and no reconciliation was run against production data.

## 4. Critical findings (P0 and P1)

### F-001 — P0 — Customer-callable "dev" wallet top-up in production

- **Where:** [backend/routes/wallet.routes.js:26](../../backend/routes/wallet.routes.js#L26) → [backend/controllers/wallet.controller.js:31-49](../../backend/controllers/wallet.controller.js#L31-L49) (`devQuickTopup`)
- **Evidence:** `router.post("/dev-topup", protect, requireCustomerSession, devQuickTopup)`. The handler accepts any `amount >= 1` and calls `creditWallet(...)` with type `WALLET_TOPUP`. There is no `NODE_ENV`, mock-mode or admin check, and no upper limit (`creditWallet` only rejects amounts ≤ 0: [wallet.service.js:220-223](../../backend/services/wallet.service.js#L220-L223)). The only other route-level reference anywhere is this line, and no test covers it.
- **Exploit path:** Sign up with any phone (OTP self-registration) → `POST /api/wallet/dev-topup {"amount": 100000}` → `POST /api/orders {"paymentMethod":"wallet", ...}`. Checkout then debits the wallet and creates a `paid` Payment ([order.controller.js:573-596](../../backend/controllers/order.controller.js#L573-L596)). The finance engine treats the wallet debit as valid funding ([orderFinance.service.js:270-273](../../backend/services/orderFinance.service.js#L270-L273)), so the seller is credited and paid out from platform money.
- **Impact:** Unlimited monetary loss and fraudulent wallet refunds. Wallet balance also appears as a platform liability.
- **History:** Present since `37319bd` ("first commit", 2026-10-11).
- **Fix:** Remove the route (or hard-gate it to `NODE_ENV==='test'` with mock integrations). Then run the read-only queries in the reconciliation report (§R-1) to find any production `DEV_TOPUP:` ledger rows. Freeze those wallets and the affected orders before any payout.
- **Tests required:** A route-absence test, and a test that wallet credits can only come from verified top-up, refund or admin adjustment.

### F-002 — P1 — Finance-permission gate bypass via URL letter case

- **Where:** [backend/routes/admin.routes.js:91-94](../../backend/routes/admin.routes.js#L91-L94)
- **Evidence:** The gate runs `/^\/(finance(?:\/|$)|…)/.test(req.path)` with no `i` flag. Express 5 routers match case-insensitively by default. An isolated probe using the repository's own Express 5.2.1 and the same gate shape returned:
  ```
  GET   /api/admin/finance/policy             403 GATED
  GET   /api/admin/Finance/policy             200 REACHED finance/policy
  PATCH /api/admin/Vendor-Payouts/1/settle    200 REACHED settle
  ```
- **Impact:** Any authenticated admin without `manage_finance` (role `admin` or `moderator`) can reach all of the following. The rider-payout route uses the same gate.
  - Seller payout settle and reject
  - Beneficiary review
  - Finance policy (TCS/TDS rates, payout schedule, independent-reviewer flag)
  - Commission rule changes
  - COD verify and write-off
  - Payment-recovery refund processing
  - Delivery rates, delivery charge and COD charge settings
  - Reports export (customer PII)
- **Fix:** Enforce permission per router (mount the finance routers behind `requireFinancePermission`) or use `express.Router({ caseSensitive: true, strict: true })`. At minimum add the `i` flag. Add defence in depth inside the payout settlement handlers.
- **Tests required:** Mixed-case and encoded-path requests from a non-finance admin must return 403 on every finance route.

### F-003 — P1 — Delivery OTP brute force via unlimited regeneration

- **Where:** [deliveryPartner.controller.js:1500-1512](../../backend/controllers/deliveryPartner.controller.js#L1500-L1512) (generate) and [:1582-1600](../../backend/controllers/deliveryPartner.controller.js#L1582-L1600) (verify). The route at [delivery.routes.js:83](../../backend/routes/delivery.routes.js#L83) has no rate limiter.
- **Evidence:** `generateDeliveryOtp` sets a new 4-digit code (`Math.random`) and `otpAttempts = 0` on every call, with no cooldown or issue cap. Verification allows 5 attempts per code.
- **Impact:** An assigned rider can loop generate → 5 guesses. On average about 900 cycles (≈4,500 requests) reach a match, with no server-side ceiling. The order becomes `delivered`, rider earnings are credited, and the seller earning moves toward release, for an order the customer never received. The customer receives a push per regeneration, which is noticeable but not preventive. The return-pickup OTP ([returnPickup.service.js:432-455](../../backend/services/returnPickup.service.js#L432-L455)) is weaker-impact: it uses `crypto.randomInt` and a 60 s cooldown but also resets attempts (P2).
- **Fix:** Cap total issued codes and total attempts per delivery. Add an issuance cooldown and a per-rider rate limiter. Use `crypto.randomInt`. Escalate to admin after the cap.

### F-004 — P1 — Unpaid online orders never expire

- **Where:** [orderSweeper.service.js:37-48](../../backend/services/orderSweeper.service.js#L37-L48). Stock and coupon are taken at placement in [order.controller.js:568-571](../../backend/controllers/order.controller.js#L568-L571) and [:644-653](../../backend/controllers/order.controller.js#L644-L653).
- **Evidence:** The sweeper only cancels Quick (`grocery`) orders that are either COD or already **paid**. No job cancels `placed` orders whose Payment stays `pending` or `failed`. The only release path is the client-initiated `POST /api/orders/:id/abandon-payment`.
- **Impact:**
  - Stock is decremented indefinitely, so a user can lock a product's inventory by placing unpaid online orders.
  - Limited-use coupons (`usedCount`) are consumed without payment.
  - First-order-only coupon checks count unpaid orders.
  - Dashboards and seller views can carry stale `placed` orders.
- **Fix:** Add a TTL sweep (e.g. 30–60 min). It should first reconcile with Razorpay (`getRazorpayPaymentStatus`) to avoid cancelling a captured payment, then call `cancelOrderAndRestore`. A late capture is already handled as a refund obligation ([payment.controller.js:104-109](../../backend/controllers/payment.controller.js#L104-L109)).

### F-005 — P1 — Deployment script and SPA path reference a non-existent `forntend/`

- **Where:** [deploy.sh:39](../../deploy.sh#L39) (`cd "$REPO_DIR/forntend"`), [backend/index.js:120](../../backend/index.js#L120)
- **Evidence:** `git ls-files` shows 619 tracked files under `frontend/` and 0 under `forntend/`.
- **Impact:** On a fresh checkout, `deploy.sh` (with `set -euo pipefail`) pulls and builds the backend, then exits at `cd forntend`, **before** `pm2 restart`. New backend code is installed on disk but the old process keeps running, so the next unrelated restart (crash, reboot) silently activates the new code. The backend also never serves the SPA. If the server still has a legacy `forntend/` directory, it would be built and served from stale sources instead.
- **Verification needed:** Server directory listing and PM2 process list (not available to this audit).

## 5. Complete findings register

| ID | Sev | Type | Module | Location | Summary |
|---|---|---|---|---|---|
| F-001 | P0 | Confirmed defect | Wallet | `wallet.routes.js:26`, `wallet.controller.js:31` | Self-service unlimited wallet credit |
| F-002 | P1 | Confirmed defect | Admin auth | `admin.routes.js:91-94` | Finance permission bypass by URL case |
| F-003 | P1 | Confirmed defect | Delivery | `deliveryPartner.controller.js:1500-1600` | Delivery OTP brute force via regeneration |
| F-004 | P1 | Confirmed defect | Checkout lifecycle | `orderSweeper.service.js:37` | Unpaid online orders never expire; stock and coupons locked |
| F-005 | P1 | Confirmed in repo / unverified in prod | Deployment | `deploy.sh:39`, `index.js:120` | `forntend` path mismatch aborts deploy before restart |
| F-006 | P2 | Process gap | Refunds | `paymentObligations.service.js:23`, `paymentRecovery.controller.js:43` | Online cancellation refunds only queued; executed manually by admin; no automation or ageing alert found |
| F-007 | P2 | Confirmed design risk | Auth | `config/jwt.js:32`, frontend `localStorage` | 30-day JWTs, no refresh, no revocation (logout, role removal, password change); admin token in `localStorage` |
| F-008 | P2 | Unverified risk | Auth / OTP | `sms.service.js` (`otpStore` Map) | Login OTPs and send limits are in-process memory; break under multi-instance PM2 and are lost on restart |
| F-009 | P2 | Unverified risk | Jobs | `orderSweeper.service.js:71-80` | All sweepers run in every process; duplicates if clustered (finance steps are idempotent; broadcasts and notifications may duplicate) |
| F-010 | P3 | Confirmed defect | Notifications | `deliveryPartner.controller.js:1537-1545` | Delivery OTP sent in push body, contradicting the in-code comment; visible on lock screens |
| F-011 | P2 | Confirmed defect (lower impact) | Returns | `returnPickup.service.js:442` | Return-pickup OTP attempt counter resets on each re-issue (60 s cooldown) |
| F-012 | P3 | Confirmed gap | COD finance | `financeMoney.js:29`, `orderFinance.service.js:121` | Whole-rupee COD rounding residual (≤ ₹0.50 per order) is never booked to a ledger account |
| F-013 | P3 | Confirmed | Customer API | `order.controller.js:1029-1039` | Buyer order detail returns `financialSnapshot` (commission, seller net, TCS/TDS) |
| F-014 | P3 | Confirmed | Delivery UI | `deliveryPartner.controller.js:703-707` | Rider sees rounded `codAmount` while the breakdown (`codOrderAmount + codFee`) is unrounded |
| F-015 | P2 | Confirmed | Supply chain | `backend/package.json` | All runtime dependencies pinned to `"*"`; reproducibility relies only on the lockfile; elevated concern given the machine's malware history |
| F-016 | INFO | Missing feature | Returns | — | No exchange workflow exists in the backend (no model, controller or service references) |
| F-017 | INFO | Placeholder | API | `routes/index.js:86` | `/api/analytics` returns a "Day 2 placeholder" message |
| F-018 | INFO | Policy ambiguity | GST | `easyReturns.service.js:98`, `productGst.service.js:45` | Easy Returns extra charge is folded into the GST-inclusive item price and the commission base; tax treatment needs professional confirmation |
| F-019 | INFO | Policy ambiguity | GST | `productGst.service.js:74-79` | `jurisdictionStatus: 'unverified'`, no CGST/SGST/IGST split, delivery fee untaxed by policy |
| F-020 | P3 | Confirmed gap | Payouts | `adminSellerFinance.controller.js:137-207` | `APPROVED` seller payouts are terminal; no bounced or returned bank-transfer reversal path |
| F-021 | INFO | Stale docs | Mobile | `mobile-seller/README.md`, `mobile-delivery/README.md` | READMEs state the apps were never built or run; current build status not verified here |

## 6. Data reconciliation

No production or staging database access was available, so **no reconciliation was executed and no data mismatch is claimed**. The [reconciliation report](BULKIMART_RECONCILIATION_REPORT.md) contains:

- 12 reconciliation formulas mapped to actual collections and fields
- read-only MongoDB queries (to be run by an operator against a replica or secondary)
- the 30-scenario matrix, with expected results derived from the code and the status of existing automated coverage

## 7. Tests run in this audit

The backend Jest suite (`npm test`, in-memory MongoDB 7.0.14, setup clears all real database URLs) was run twice with identical results: **69 suites, 11 failed; 990 tests, 23 failed, 7 skipped, 960 passed.**

- The Razorpay webhook suite does not load because its mock is stale (the mock lacks `rupeesToPaise`).
- The checkout-workflow suite returns HTTP 500 on every order under mocked persistence; root cause not isolated.
- Several suites read the non-existent `../forntend/` path.

The financially critical webhook and checkout paths therefore have **no passing automated tests right now**. Details are in [BULKIMART_APPLICATION_AUDIT.md §6](BULKIMART_APPLICATION_AUDIT.md). No frontend or mobile builds were run.

## 8. Production readiness

| Area | Classification |
|---|---|
| Overall | **NOT READY** until F-001 is fixed and production wallet data is checked |
| Payments (Razorpay) | Ready with risks (F-002, F-006) |
| Seller settlement | Ready with risks (F-002) |
| COD / delivery | Not ready (F-003) |
| Checkout inventory | Ready with risks (F-004) |
| Deployment | Blocked pending verification (F-005, F-008, F-009) |
| GST / tax | Blocked pending professional validation (F-018, F-019) |
| Parcel, legal, GST assistance, advertising, packaging, wholesale | **Not audited**: blocked pending verification |

## 9. Remediation plan (summary)

See [BULKIMART_REMEDIATION_PLAN.md](BULKIMART_REMEDIATION_PLAN.md). Order of work:

1. F-001 (remove route, investigate data).
2. F-002, F-003.
3. F-004, F-006.
4. F-005, F-008, F-009.
5. P3/INFO items.
6. Regression tests for every item.
7. Audit the modules not covered here.

## 10. Coverage limits (honest statement)

- Read in depth: payment controller and Razorpay service; checkout `createOrder`; pricing, coupon, COD, GST, Easy Returns, commission, discount allocation, order finance, ledger, payout, return hold, finance automation, refund execution, cancellation, sweeper; auth middleware, JWT, login OTP, CORS; delivery OTP completion; wallet routes; seller payout admin handlers; ownership checks on product, fulfilment, return, ticket and chat.
- Not audited: most of `admin.controller.js` (3,101 lines); `createUnifiedOrder` beyond its header; parcel delivery; legal services; GST assistance; advertising billing; packaging; wholesale; e-books; image search; Shiprocket; notifications; all mobile screens; responsive UI; Nginx/PM2/backup configuration (not in repo).
- Phase 13 simulations were not executed as new fixtures. Their expected values and existing coverage are documented instead.
- The `code-review-graph` MCP server failed to connect during this audit, so analysis used direct file reading.
