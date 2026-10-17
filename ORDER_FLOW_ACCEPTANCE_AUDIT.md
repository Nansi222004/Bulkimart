# Bulkimart order-flow acceptance audit

Audit date: 17 October 2026 (Asia/Calcutta). Repository: `D:\Appzeto_Projects\Bulkimart1`; frontend: `forntend`. Audited revision: `b73e176cf399ff0b37cbb6a35a806233eb36a81c`.

## Decision

**Conditional acceptance; one confirmed Medium customer-experience defect.** All seven COD browser purchase combinations pass at 390px and 1280px. Real local HTTP/database tests pass for COD, sufficient/insufficient wallet balance, mocked online initiation/capture/failure, duplicate events, retries, grouping and rollback. No duplicate order, Payment, wallet debit or stock deduction was observed in the executed assertions.

**All seven combinations at both widths lose the pending-payment context when refreshed after order commit while online initialization is pending.** Checkout displays “Your Cart is Empty” without a pending-order message or recovery action. Persisted orders and the Payment remain correct; My Orders shows the orders, original-key replay is safe, and uncertain initialization blocks another provider attempt. This is a failed recovery experience, not evidence of a lost order or duplicate charge. See finding A01 and the recovery matrix evidence below.

No application implementation was changed or repaired. Only this report, audit test runners and evidence were added. Initial `git status --short` was empty. No commit, push, deployment, production restart, production data access or real payment credentials were used.

## Evidence scope and safety

- Checked available MCP tool metadata before exploring source: code-review-graph tools were unavailable. Used the AGENTS.md fallback to targeted source inspection. No graph-based coverage or impact result is claimed.
- Reviewed `backend/scripts/verifyIsolatedTests.mjs`, Jest configuration/setup and the Chrome runner before executing them. Jest clears database environment URLs, and DB-backed integration cases connect to their own memory-server database. Transaction suites use disposable replica sets. Some legacy suites use model mocks or a standalone disposable database; they are not all transaction integrations.
- Chrome uses a temporary MongoDB 7.0.14 replica set, synthetic identities/addresses, random loopback ports, an empty dotenv file, dummy payment configuration and mock OTP/freight/maps/push modes. Cloudinary upload is replaced locally. Browser external requests are blocked; Google Fonts was intentionally blocked. Normal cart/order HTTP controllers and models execute.
- The added recovery runner overrides the backend Razorpay SDK instance before routes load. Order creation waits six seconds and throws locally; lookup methods return controlled empty/unavailable results. It never calls the provider.
- Each added HTTP case clears fixture collections and creates new disposable customers/products/vendors. Each independent Chrome combination clears Orders, Payments, CheckoutAttempts and carts and restores product stocks to 100; it reuses synthetic fixture identities/products inside the disposable run. Thus scenarios start from identical reset data, not from the previous purchase's stock or basket.
- Audit HTTP evidence contains aggregate money/counts and safe messages. Browser traces contain HTTP method/path/status/timing, not Authorization headers, bodies containing addresses, OTPs or keys. Screenshots show only synthetic fixture data. A scan of audit logs found no Bearer/JWT patterns. Backend startup logs are classified rather than dumped with possible secrets.

Evidence directory: [`test-artifacts/order-flow-audit/`](test-artifacts/order-flow-audit/). Files there and the added HTTP test are ignored by existing repository rules; they remain on disk. The report and two added Chrome runners appear in `git status`. A copy of the HTTP audit source is included in the evidence directory.

## Seven-combination matrix

Q = Quick Commerce (`grocery`); E = E-Commerce; W = Wholesale. “HTTP pass” means actual routers/models with isolated persistence; online provider behavior is mocked. “COD browser pass” includes persistence assertions, not just rendering.

| Combination | COD browser 390 / 1280 | HTTP COD / wallet / mocked online | Expected = actual orders / vendors, distinct-vendor fixture | Overall acceptance | First failing journey step |
| --- | --- | --- | --- | --- | --- |
| Q | Pass / Pass | Pass / Pass / Pass | 1 / 1 | Fail: A01 | Step 17: pending-payment feedback after refresh; COD passes |
| E | Pass / Pass | Pass / Pass / Pass | 1 / 1 | Fail: A01 | Step 17: pending-payment feedback after refresh; COD passes |
| Q + E | Pass / Pass | Pass / Pass / Pass | 2 / 2 | Fail: A01 | Step 17: pending-payment feedback after refresh; COD passes |
| W | Pass / Pass | Pass / Pass / Pass | 1 / 1 | Fail: A01 | Step 17: pending-payment feedback after refresh; COD passes |
| Q + W | Pass / Pass | Pass / Pass / Pass | 2 / 2 | Fail: A01 | Step 17: pending-payment feedback after refresh; COD passes |
| E + W | Pass / Pass | Pass / Pass / Pass | 2 / 2 | Fail: A01 | Step 17: pending-payment feedback after refresh; COD passes |
| Q + E + W | Pass / Pass | Pass / Pass / Pass | 3 / 3 | Fail: A01 | Step 17: pending-payment feedback after refresh; COD passes |

The recovery matrix has 14 confirmed UX failures (7 combinations × 2 widths), 14 financial-safety passes and zero blocked cases. It creates 24 disposable orders across independent reset scenarios, with one Payment per scenario; all replays keep the original order count. Browser customer history is verified for every combination/width. The three affected seller detail screens are verified for the triple basket at both widths; ownership/history HTTP assertions cover every combination.

The COD runner creates 30 disposable orders across its 14 independent journeys and two additional legacy mixed-COD regression journeys. The original runner separately creates six orders. These are separate isolated databases, not production totals.

Primary evidence: [`browser/browser.json`](test-artifacts/order-flow-audit/browser/browser.json), [`browser/journeys.json`](test-artifacts/order-flow-audit/browser/journeys.json), [`http-state.json`](test-artifacts/order-flow-audit/http-state.json), and the 21 combination/payment cases in `backend/__tests__/api/wholesale.http.test.js:1094`.

## Payment-method matrix

P = executed isolated HTTP/database pass; M = executed with controlled provider mocks. Rejection and timeout are expected safe outcomes, not failed purchases counted as payment successes.

| Combination | COD | Sufficient wallet | Insufficient wallet | Online init + capture | Init timeout + recovery | Same-key replay | Failed event, retry, capture + duplicate events | Cancellation obligation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q | P | P | P: HTTP 400 | M | M: 503 then 409 | P | M | M |
| E | P | P | P: HTTP 400 | M | M: 503 then 409 | P | M | M |
| Q + E | P | P | P: HTTP 400 | M | M: 503 then 409 | P | M | M |
| W | P | P | P: HTTP 400 | M | M: 503 then 409 | P | M | M |
| Q + W | P | P | P: HTTP 400 | M | M: 503 then 409 | P | M | M |
| E + W | P | P | P: HTTP 400 | M | M: 503 then 409 | P | M | M |
| Q + E + W | P | P | P: HTTP 400 | M | M: 503 then 409 | P | M | M |

For every insufficient-wallet case: balance remains ₹1; zero Orders, Payments and WalletLedger debits; all cart lines and stock remain. For sufficient wallet: existing 21-case matrix asserts exactly one ledger entry and exact balance `10000 - total`, including replay. Each online success case asserts one recorded capture after duplicate signed mocked webhooks. The added seven failure/capture cases first deliver a failed event twice, verify unpaid state, initialize a new attempt, capture it twice, then cancel one order. Only that order's stock is restored and its exact amount becomes one pending refund obligation.

Timeout cases retain one `creation_unknown` attempt and zero captures. Recovery is authenticated/read-only; original-key replay does not recreate orders. Competing simultaneous mixed checkout requests are covered by the existing HTTP race test. Simultaneous duplicate-submit coverage is not separately repeated for all seven combinations; sequential same-key replay is.

Provider refund execution/reconciliation, extra captures, late captures and duplicate settlement guards also run in the existing Wholesale recovery, Razorpay and financial/lifecycle suites. These supplement the per-combination obligation checks; they do not prove live refunds or a browser Razorpay transaction. No COD cash collection was performed.

## Prices, quantities, delivery and persisted stock

The following browser values match at both widths. All figures are INR. Browser fixtures: Q is 2 × ₹75; E is 1 × ₹100; W is 10 × ₹95. No coupon, Coins or tip is applied. Q delivery is ₹15; E and W delivery are ₹40 each. These are actual fixture quotes, not a proposed production tariff.

| Combination | Lines | Badge quantity | Items | Delivery | Quote = sum of Orders = Payment |
| --- | ---: | ---: | ---: | ---: | ---: |
| Q | 1 | 2 | 150 | 15 | 165 |
| E | 1 | 1 | 100 | 40 | 140 |
| Q + E | 2 | 3 | 250 | 55 | 305 |
| W | 1 | 10 | 950 | 40 | 990 |
| Q + W | 2 | 12 | 1100 | 55 | 1155 |
| E + W | 2 | 11 | 1050 | 80 | 1130 |
| Q + E + W | 3 | 13 | 1200 | 95 | 1295 |

For every purchased browser line, persisted variant stock changes from 100 to 98 (Q), 99 (E), or 90 (W). All purchased cart lines clear. Increasing then decreasing quantity, removal, re-addition and Refresh prices precede checkout in every independent browser case. Initial additions use product UI and explicit variant selection where the selector exists; re-addition after the removal check uses the real cart API. The legacy mixed regression increases W from 10 to 15, updates the badge from 13 to 18, and persists a retail seller instruction. Its final shared amount is ₹1770, including all three delivery charges.

The HTTP fixture intentionally differs: Q/E each use 2 × ₹100, W uses 5 × ₹80, and its quoted delivery is ₹40 per group. Recorded totals are Q ₹240, E ₹240, Q+E ₹480, W ₹440, Q+W ₹680, E+W ₹680, all three ₹920. Stock becomes 98/98/95 respectively. This difference reflects fixture products/serviceability, not disagreement between a browser quote and its own Payment. `http-state.json` records each subtotal, delivery charge, quantity and cancellation amount in paise.

## Vendor grouping and order ownership

| Fixture | Expected | Actual/evidence |
| --- | --- | --- |
| Three products, three vendors, three channels | 3 orders, 3 vendors, 1 Payment | Pass in HTTP and both-width Chrome |
| Same vendor Q + E | 2 fulfilment groups, 1 vendor | Pass in added same-vendor HTTP case |
| Same vendor Q + W or E + W | 2 financial/fulfilment groups, 1 vendor | Both pass in added HTTP cases |
| Same vendor across all three | 3 groups, 1 vendor | Pass; underlying types are grocery/ecommerce; sales channel remains retail/wholesale |
| Another compatible product, same vendor/channel | Existing group gains a second line | Existing mixed grouping test: still 3 groups/orders |
| Additional vendor in one channel, each of seven combinations | Original order/vendor count + 1 | Seven added HTTP cases pass: 2 for singles, 3 for pairs, 4 for triple |
| Same retail/W product and variant | Separate prices, combined inventory demand | Existing test: ₹100 retail / ₹80 W; stock 25 → 18 for quantities 2 + 5 |
| Seller becomes inactive during transaction | Reject entire basket | Existing real concurrent deactivation test passes with zero Orders/Payments |
| Price/unavailability change | Stale composition rejected | Existing six pre-submit invalidation cases and stock race pass |

Order counts follow actual seller, fulfilment type/mode and sales channel. The channel count alone is insufficient. HTTP tests verify actual seller ownership, order amounts, shared Payment association and stock. Additional audit history/seller tests fetch customer history, retrieve each owner's seller detail, and verify an unrelated approved seller receives 404. The recovery Chrome run also opens the affected seller detail screens using isolated mock seller sign-ins; its evidence records the screens actually visited.

## Customer journey and integrity coverage

| Requested step/check | Executed evidence and boundary |
| --- | --- |
| 1: eligible sign-in | Chrome uses real local mock OTP endpoints, then installs the returned customer session. It does not type OTP into the login form. HTTP cases use fixture buyer JWTs and real authorization middleware. |
| 2–4: catalog, product, variant, add | Every independent COD browser journey opens appropriate catalog/product routes and adds in the UI. Wholesale follows its catalog card. Retail product opening uses its product URL after the catalog route, not a catalog card click. |
| 5–7: badge, direct/navigation cart, contents | Both widths, all seven; persisted quotes/variant and channel identity, line count, stock and totals checked. No horizontal overflow in cart/checkout. Screenshots inspected. |
| 8: quantity/remove/refresh | Every independent browser combination increases/decreases its first line, removes/re-adds it, and refreshes quote; HTTP tests cover channel-specific mutation rules and invalid W quantities. |
| 9: reload, Back/Forward | Every independent browser combination reloads and navigates Back/Forward before submit. Legacy `/wholesale/cart` direct/reload/focus also passes. |
| 10–11: address/delivery/totals | Uses an existing valid default fixture address and default available delivery mode. Submitted shipping fields and persisted group amounts are exercised. Manual switching to a second address and every selectable mode is not repeated in Chrome; existing address/serviceability/Same-Day regression tests pass. |
| 12–13: submit/commit | One UI submit per case; actual HTTP and DB checks, exact group counts, shared amount, inventory changes, cart clearing. |
| 14–15: confirmation/history/seller | COD confirmation each combination; customer history HTTP for each; browser customer/seller history/detail coverage recorded in recovery evidence. Seller ownership and cross-seller denial tested through HTTP. |
| 16: cancel/refund | Added seven mocked-online cases restore only cancelled stock and create one exact pending obligation; existing cancellation/refund/capture races and recovery suites pass. No manual customer cancel/refund browser journey or real refund is claimed. |
| 17: timeout/refresh/recovery | HTTP financial invariants pass for all seven. Chrome post-commit refresh exposes A01; original-key recovery/replay and My Orders still work. |
| Empty/invalid lines | Empty Chrome cart has no checkout button; API invalid-line tests preserve stored lines, return invalid quote/no authoritative total, and prevent checkout. |
| W MOQ/increment/tier/stale quote | Existing HTTP preview/cart/checkout tests pass, including malformed quantities and changed live tier price. No time-based quote TTL is claimed. |
| Stock/quantity/seller concurrency | Real paused transaction races pass; shared retail/W variant demand cannot oversell. |
| One invalid group | Whole basket rejects; unrelated stored lines survive. |
| Payment, second Order or cart-clear failure | Injected failures roll back Orders, Payment, CheckoutAttempt and stock; cart remains; same-key retry succeeds. |
| Coupons/Coins/digital/tips | Existing regression and new mixed tests pass: grouped benefits reject, tip attaches once to retail, digital/physical mixed checkout rejects, digital preview shipping is zero. Policies were unchanged. |

## Finding A01 — pending-payment context disappears on browser refresh

**Severity: Medium. Status: Confirmed for all seven combinations at both 390px and 1280px. First failing customer-journey step: 17** (browser refresh after order commit, before initialization finishes). Financial safety assertions pass; the customer recovery experience fails.

Reproduction uses only fixtures:

1. Sign in to the isolated eligible customer; add the selected physical basket through product UI.
2. Proceed to checkout with the valid saved address and select Razorpay Online Payment.
3. Submit once. Wait until real DB state shows the expected Orders, one Payment and one provider-attempt journal entry. The SDK mock is still waiting before returning its timeout.
4. Reload `/checkout` before that SDK response returns.
5. Observe “Your Cart is Empty” / “Start Shopping”; no pending-payment message and no “Check checkout status” action.
6. After the mocked timeout, inspect DB: original order count, one Payment, `creation_unknown`, zero captures, empty purchased carts. Original-key `/api/orders/checkout-status` returns `completed`; replay creates no new records; another `/api/payments/initiate` returns 409. Opening `/orders` shows the committed orders.

Expected: the refreshed customer sees the already-created orders and a pending-payment/review action, with submission still disabled. Actual: financial records survive but checkout loses all pending-order feedback.

Root cause, supported by executed browser state and source:

- `forntend/src/modules/User/context/UserContext.jsx:1429` (`placeOrder`) and `:1491` (`placeUnifiedOrder`) clear the checkout session key immediately after a successful order response, before `CheckoutPage` finishes `initiateOnlinePayment`.
- `forntend/src/modules/User/pages/CheckoutPage.jsx:381` initializes recovery only from a retained checkout session. On reload it finds none.
- `CheckoutPage.jsx:449` starts payment after order creation; its confirmation/error data is component state. That state is lost on reload.
- `CheckoutPage.jsx:705` returns the generic `CartEmptyState` when the server basket is empty and no recovery session exists. Cart clearing at commit is correct; this UI branch overlooks the pending committed Payment.

Evidence: [`recovery-browser/journeys.json`](test-artifacts/order-flow-audit/recovery-browser/journeys.json), [`recovery-browser/browser.json`](test-artifacts/order-flow-audit/recovery-browser/browser.json), [`browser-recovery-matrix-final.log`](test-artifacts/order-flow-audit/browser-recovery-matrix-final.log). Each final row records `passed:false`, `financialSafetyPassed:true`, `firstFailingStep:17`, `checkoutSessionRetained:false`, `pendingMessage:false`, `recoveryButton:false`, `submitEnabled:false`, `empty:true`. The full final scope is enumerated in that JSON; no inference from a single screenshot is needed.

Smallest safe fix recommendation, **not implemented**: persist a customer-scoped reference to the committed pending-payment group/order separately from the in-flight order-submission key. Restore its read-only status/review view on reload before showing the empty-cart state. Reuse existing authenticated order/payment status and attempt reconciliation; do not resubmit checkout, rebuild a cart, or bypass `creation_unknown`. Clear the reference only after an explicitly resolved outcome. Add the reproduced browser test as a regression.

## Harness failures and coverage gaps

| ID | Severity/status | Evidence and consequence |
| --- | --- | --- |
| H01 | Low, confirmed environment limitation | Sandbox attempts of original and extended Chrome runner timed out at `Page.enable`, before storefront execution. Repeating outside the sandbox passed. Initial failures are retained in `browser-original.log` / `browser-acceptance.log`; they are not application failures. |
| H02 | Low, corrected audit test error | Initial extension read `paymentId` from the grouped response's serialized order, yielding a null Payment lookup at W checkout. Audit harness now reads the persisted Order's `paymentId`. Application code was unchanged. Initial log: `browser-acceptance-retry.log`; final 14 journeys pass. |
| H03 | Low, resolved audit synchronization limitation | An intermediate recovery matrix stopped at Q+E before observing provider initialization (`browser-recovery-matrix.log`). The final runner waits for reviewed groups, allows a longer observation window and records each case independently. Final 14-case run completes with no blocked cases; no separate application defect is established by the earlier setup failure. |
| G01 | Medium, confirmed coverage gap | Existing frontend recovery tests simulate an uncertain order-submission session; they did not catch loss of context after a confirmed order response while provider initialization is pending. Added Chrome reproduction catches A01. |
| G02 | Medium, untested browser paths | Real Razorpay widget success/dismissal/error, browser wallet selection, typing OTP into the login form, selecting a second saved address, every available delivery option and manual cancellation/refund screens are not fully exercised by this audit's Chrome scripts. HTTP/component coverage exists for related behavior; it is not a browser pass for those paths. |
| G03 | Medium, untested permutations | Same-vendor and additional-vendor permutations pass through HTTP persistence/ownership assertions, not repeated complete visual browser journeys. Concurrent duplicate submission is exercised for mixed checkout and original single-flow tests, not every seven-way/payment Cartesian product. |
| G04 | Low, known skipped legacy coverage | Seven existing tests remain skipped: 2 in seller-payment API and 5 in seller-payment HTTP. Source identifies retired PhonePe routes (`describe.skip`), not newly verified Razorpay/basket scenarios. |

### External dependencies not verified

| Validation priority | Dependency and limit |
| --- | --- |
| High assurance gap; no confirmed defect | Real gateway account configuration, hosted payment widget, provider capture/signature delivery and actual refund execution were deliberately not tested live. SDK/webhooks use controlled mocks. No claim of real charging or refunding is made. A future authorized provider-sandbox check can validate integration without a real customer charge. |
| Medium assurance gap | Actual freight quotes/bookings/labels, provider delivery actions, payment reconciliation workers against a live provider, SMS/OTP delivery, FCM/native notification and socket fulfilment delivery, and external media upload are mocked or uninvoked. Existing lifecycle/mocking tests do not validate these external systems. |
| Medium operational prerequisite | Production replica-set/transaction availability, unique Cart/CheckoutAttempt indexes, production credentials/webhook setup and deployment runtime were not inspected or modified. Disposable tests initialize the required indexes successfully. |
| Low | Offline Google Fonts is intentionally blocked; frontend large-chunk warning remains. No functional failure was attributed to either. |

## Commands and results

Commands ran from the indicated directory. Output was redirected to the named evidence logs. `npm` and `node` invoked installed local dependencies; no dependency installation was performed.

From `backend`:

```powershell
node scripts/verifyIsolatedTests.mjs
# PASS: 57 suites; 705 passed; 7 existing skipped; zero failed/timeouts.
npm run build
# PASS: index syntax and backend service-package imports/limits.
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --runTestsByPath __tests__/api/order-flow-acceptance.audit.test.js --json --outputFile=../test-artifacts/order-flow-audit/http-tests.json
# PASS: 32 added acceptance cases; zero failed/skipped.
```

The existing runner discovered its 57 suites before the audit-only suite was added. The extra 32 were executed separately: **737 backend test passes in total**, with 7 legacy skips. Do not interpret this as a second full run of 58 suites. Existing runner results: [`backend-isolated.json`](test-artifacts/order-flow-audit/backend-isolated.json); per-suite reports/logs remain under `test-artifacts/unified-basket/backend-suites/`. Additional assertions and console diagnostics: [`http-tests.json`](test-artifacts/order-flow-audit/http-tests.json), [`http-tests.log`](test-artifacts/order-flow-audit/http-tests.log). Expected insufficient-wallet diagnostics identify `stage: wallet.debit` and `transactionState: TRANSACTION_ABORTED`; assertions verify zero persisted financial writes.

From `forntend`:

```powershell
node --test --test-concurrency=1 scripts/unified-basket-ui.test.mjs scripts/wholesale-ui.test.mjs scripts/checkout-ui.test.mjs scripts/product-wholesale.test.mjs scripts/auth-role.test.mjs scripts/service-ui.test.mjs scripts/portal-startup.test.mjs
# PASS: 128 tests; zero failures/skips.
npm run build
# PASS; existing Vite large-chunk warning.
```

From repository root:

```powershell
node backend/scripts/verifyUnifiedBasketBrowser.mjs
# Sandbox attempt: Page.enable timeout. Retry outside sandbox: PASS at both widths.
node backend/scripts/verifyOrderFlowAcceptanceBrowser.mjs
# Final execution: PASS, 14 independent COD journeys, 30 total fixture orders.
node backend/scripts/verifyOrderFlowRecoveryBrowser.mjs
# Final execution: exit 1 as expected; 14 UX failures for A01; 14 financial-safety passes; zero blocked cases.
git -c core.safecrlf=false diff --check
git diff --check
# Both PASS.
node --check backend/__tests__/api/order-flow-acceptance.audit.test.js
node --check backend/scripts/verifyOrderFlowAcceptanceBrowser.mjs
node --check backend/scripts/verifyOrderFlowRecoveryBrowser.mjs
# PASS.
```

The original Chrome success, the extension's initial failure, and the final acceptance/recovery runs are separate log files. Earlier `browser-recovery.log` labels financial safety as `passed:true`; **it predates explicit UX acceptance classification**. Use final `browser-recovery-matrix-final.log` and `recovery-browser/browser.json`, which report A01 as failure. No earlier positive flag overrides that finding.

## Browser artifacts

- Original-run evidence: [`browser-original.json`](test-artifacts/order-flow-audit/browser-original.json), `browser-original-retry.log`; screenshots under `test-artifacts/unified-basket/`.
- Full independent COD journeys: [`browser/browser.json`](test-artifacts/order-flow-audit/browser/browser.json), `browser-acceptance-final.log`. Includes sanitized HTTP metadata, expected/actual state, badge, quantities, quoted group charges, Payment totals and before/after variant stock.
- For every combination and width: `browser/review-<channels>-<width>.png` and `browser/confirmation-<channels>-<width>.png`. Examples: [all-three review, 390px](test-artifacts/order-flow-audit/browser/review-grocery-ecommerce-wholesale-390.png), [all-three confirmation, 1280px](test-artifacts/order-flow-audit/browser/confirmation-grocery-ecommerce-wholesale-1280.png). Also legacy, empty, digital and cart screenshots.
- Recovery reproduction: `recovery-browser/reload-after-commit-<channels>-<width>.png`, `pending-orders-<channels>-<width>.png` and affected seller screenshots. Examples: [all-three empty checkout after commit, 390px](test-artifacts/order-flow-audit/recovery-browser/reload-after-commit-grocery-ecommerce-wholesale-390.png), [pending orders, 1280px](test-artifacts/order-flow-audit/recovery-browser/pending-orders-grocery-ecommerce-wholesale-1280.png).
- Screenshots were inspected alongside actual HTTP results and persisted-state assertions. They are supporting evidence, not the basis for financial passes.

## Recommended next actions — no fixes implemented

1. Address A01 with a persisted committed-payment review reference and restore the existing status UI on reload. Keep order submission and provider reconciliation semantics intact.
2. Retain the new post-commit Chrome reproduction as a regression; validate both single and grouped endpoints and both widths after the fix.
3. Extend browser coverage for G02/G03, starting with wallet and a controlled hosted-payment widget, then address/delivery choices and cancellation UI. Reuse disposable state and exact financial assertions.
4. Validate external integrations only in a separately authorized provider sandbox/staging environment. None of the local results authorizes live charges, production data changes or deployment.
