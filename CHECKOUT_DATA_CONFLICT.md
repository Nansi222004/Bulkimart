# Checkout data conflict — 2026-10-15

**Update after explicit Atlas authorization:** the two legacy indexes have now been safely replaced in `bulkimart`; no records were deleted or modified by the migration. Real-browser COD checkout, account history, idempotent replay and seller processing passed against an isolated backend/replica set. Local Razorpay settings were corrected and its unpaid test-order API probe passed. See [CHECKOUT_END_TO_END.md](CHECKOUT_END_TO_END.md) for the current result and remaining verification boundaries. The sections below retain the initial investigation and its original pre-authorization evidence/results.

The database configured by the local backend is a remote MongoDB cluster, not a disposable localhost database. It was inspected read-only. No remote indexes, documents, orders, payments or credentials were modified. Application changes and the unique-preserving index replacement were verified against isolated MongoDB replica sets only. The configured database still requires an approved index migration; restarting this backend alone will not resolve the checkout failure there.

## Confirmed cause

Current checkout writes `Payment.gateway.orderId` only when a gateway order exists; COD has no gateway ID. Orders use `_id` and generated `orderNo`. Neither current create path writes historical top-level `Payment.gatewayOrderId` or `Order.orderId`.

The configured database retains two obsolete, full-field, non-sparse unique indexes:

| Collection/index | Key | Read-only evidence | Reproduced failing write |
| --- | --- | --- | --- |
| payments / `gatewayOrderId_1` | `{ gatewayOrderId: 1 }` | One payment, with the indexed field missing | `Payment.create()` raises E11000; keyPattern `{ gatewayOrderId: 1 }`, keyValue `{ gatewayOrderId: null }` |
| orders / `orderId_1` | `{ orderId: 1 }` | Two orders; one string legacy ID and one missing ID | After fixing the first constraint in the fixture, `Order.create()` raises E11000; keyPattern `{ orderId: 1 }`, keyValue `{ orderId: null }` |

MongoDB's full unique index treats the missing optional identifier as an indexed null. Another normal COD payment therefore collides with the existing missing identifier. The order index would independently block the next stage. This is not evidence of a reused checkout key, an invalid address or a customer-selected delivery carrier problem.

At inspection, `checkoutattempts` had zero documents and its unique `(userId, key)` index existed. Canonical `orderNo` uniqueness also existed. No customer documents or identifying values were printed. The supplied request ID `d2588958-2c7c-4f1e-8d39-19bf07082db7` could not be correlated with saved server logs. Consequently, the exact historical request's original exception/persisted outcome cannot be independently certified. The identical index conditions and COD ecommerce/address-ID request were reproduced against genuine models and routing in an isolated replica set.

## Transaction and recovery verification

The reproduced payment failure aborted the transaction: zero new customer orders, payments and checkout attempts; unchanged inventory and cart. The separately reproduced order insertion failure rolled back the payment inserted earlier in that transaction. An injected failure clearing the cart, after order insertion, also rolled back orders, payments, checkout attempts and stock; no wallet ledger entry remained.

After the index replacement in the isolated fixture, a fresh COD checkout returned 201 and persisted exactly one order/payment. Repeating the identical key returned that same order with one stock deduction. COD, wallet and online single/grouped checkout and seller-first fulfilment remain covered. These online tests persist pending payment records; they do not invoke or verify a live payment provider.

`POST /api/orders/checkout-status` is authenticated and read-only. It looks up the existing key for the authenticated owner and reports `not_found`, `processing`, `completed` or `unavailable`. Completed results contain only minimal order/payment references, not addresses or gateway credentials. Missing/corrupt references prohibit another submission. Another user's key reveals no result. A missing attempt permits only an explicit same-key retry; a still-in-flight transaction remains protected by the same unique claim.

The frontend retains the key after failure. Data conflicts, lost responses and uncertain commit outcomes block submission until an explicit status check. A completed/pending/unknown result does not automatically submit another order. A negative lookup allows manual retry with the original unchanged payload/key. Changing checkout details still follows the existing fingerprint/key policy; no key-clearing or forced rotation was introduced by this fix.

Server diagnostics record request ID, write stage, exception name/code, sanitized index/key pattern, null-or-redacted values, transaction state and stack frames. They exclude raw driver messages, request bodies, addresses, tokens and payment data. Expected business errors retain their validation. Unexpected transaction failures and uncertain commit outcomes return safe codes/messages. Production responses contain no stack trace.

## Required index remediation, deliberately not applied remotely

`backend/services/checkoutIndexCompatibility.service.js` implements a narrowly scoped index replacement. It first validates the old index definition, creates a replacement UNIQUE index restricted to documents where the legacy identifier exists, verifies that definition, and only then retires the obsolete full-field constraint. Actual present identifiers, including explicit null, remain unique. Tests prove duplicate real IDs are still rejected. Canonical order numbers and checkout idempotency constraints are untouched. No document cleanup, fake gateway identifiers or blanket `syncIndexes()` is used.

Replacement indexes:

- payments: `legacy_gateway_order_id_unique_present`, UNIQUE `{ gatewayOrderId: 1 }`, partial filter `{ gatewayOrderId: { $exists: true } }`.
- orders: `legacy_order_id_unique_present`, UNIQUE `{ orderId: 1 }`, partial filter `{ orderId: { $exists: true } }`.

`backend/scripts/repairCheckoutIndexes.mjs` defaults to a read-only plan. Its `--apply --confirm=REPLACE_LEGACY_CHECKOUT_INDEXES` mode is restricted to a nonproduction loopback database and refuses the currently configured remote cluster before connecting. The refusal was tested. No application startup invokes maintenance. This guarded tool is not a way to apply a remote production migration.

An authorized database operator must review the plan and actual database/environment before any remote metadata change. Back up data/index definitions, check MongoDB version/index compatibility and historical writers, establish/verify replacements before retiring old constraints, then verify one staging COD order and same-key replay. Do not restore full indexes while current writes omit their fields: that reinstates the outage or fails against multiple missing-field records. Roll back application code separately if necessary; retain the verified replacement uniqueness. Partial application is safe and reviewable because replacement creation/verification precedes retirement for each collection; maintenance is not a cross-collection transaction.

## Files and validation

- Backend: `controllers/order.controller.js` (write-stage diagnostics, safe error classification, read-only recovery); `routes/order.routes.js` (recovery route); `services/fulfilmentOrders.service.js` (grouped-write stage callback).
- New backend helpers/scripts: `services/checkoutDiagnostics.service.js`, `services/checkoutIndexCompatibility.service.js`, `scripts/inspectCheckoutDatabase.mjs`, `scripts/repairCheckoutIndexes.mjs`.
- Frontend: `src/modules/User/context/UserContext.jsx` (preserve error/reference, uncertain outcome, existing-key status request); `src/modules/User/pages/CheckoutPage.jsx` (explicit recovery and blocked automatic resubmission).
- Tests: `backend/__tests__/api/seller-first-checkout.http.test.js` (real-index collisions, rollback, recovery, lost acknowledgement); `forntend/scripts/checkout-ui.test.mjs` (provider key preservation, conflict recovery and no automatic resubmission).

Existing unrelated changes were preserved. No production deployment or authenticated production checkout was performed. No real-device/browser checkout or live payment-provider test was performed in this focused investigation.

| Command / scope | Actual result |
| --- | --- |
| `cd backend; npm test -- --runInBand __tests__/api/seller-first-checkout.http.test.js __tests__/api/checkout-workflow.http.test.js` | 2 suites, 47 passed, 0 failed |
| `cd backend; npm test -- --runInBand` | 50 suites passed; 400 passed, 7 skipped, 0 failed (407 total) |
| `cd forntend; npm run test:checkout` | 15 passed, 0 failed |
| `cd forntend; node --test --test-concurrency=1 scripts/checkout-ui.test.mjs scripts/auth-role.test.mjs scripts/service-ui.test.mjs scripts/image-search-ui.test.mjs scripts/socket-ui.test.mjs` | 77 passed, 0 failed, 0 skipped |
| `cd backend; npm run build` | Passed, including backend-only shared service package check |
| `cd forntend; npm run build` | Passed; existing warning about chunks over 500 kB (main JS approximately 1.70 MB) |
| `node scripts/repairCheckoutIndexes.mjs --apply --confirm=REPLACE_LEGACY_CHECKOUT_INDEXES` in backend with current remote config | Expected refusal, exit 1, before connecting; no indexes changed |
| `git diff --check` | Passed; Windows line-ending advisories only |

The seven skipped backend tests were not executed. Real replica-set tests establish fresh COD persistence exactly once, rollback and replay; they are not browser/deployed checkout verification. An initial parallel UI run printed Vite HMR port-contention warnings; the final sequential 77-test run passed without those warnings. The historical request ID remains uncorrelated with server logs.
