# Return, refund, payout and reverse-pickup repair — 26 October 2026

Implemented locally in the existing item-level Return workflow. Production was not deployed or modified. No live refund, payout, pickup or production migration was executed. Provider calls in verification use mocks; database integration tests use disposable local MongoDB replica sets.

## Results and readiness

The repair enforces frozen item return policies, transactional quantity reservations, seller receipt and explicit QC before refunds, COD wallet credits, original-capture Razorpay refunds, per-item seller earnings release, and explicit seller choice of manual or Shiprocket reverse pickup. Provider delivery does not imply seller receipt or inspection. Historical offline COD evidence remains unchanged, and new offline COD settlement is rejected.

This is ready for local review and controlled staging preparation, **not a production-readiness sign-off**. Outstanding gates are the default build bootstrap, a working browser E2E run, the existing general-suite failures, and account-specific Shiprocket verification. No sandbox/account capability is claimed as verified.

The original defect inventory and baseline are in [return-repair-audit.md](return-repair-audit.md).

## Business-rule evidence

| Area | Implemented behavior and executed evidence |
|---|---|
| Item returns | Canonical `/api/returns`, customer ownership, frozen policy/deadline, atomic quantity reservation, request-key replay, one-time reservation release. The old whole-order endpoint returns 410 with the canonical endpoint instead of changing order state. Single and grouped checkout share the product policy resolver. |
| Payout protection | Item earnings remain held for missing delivery evidence, open windows and unresolved returns. Mixed orders release unrelated eligible items once. Seller, automated requests and admin settlement use the shared settlement guard. Historical release rechecks windows and payment disputes. Payout concurrency, debt, admin evidence and release/reversal tests run against real transactions. |
| Razorpay | The original unique settled capture owns each refund obligation. Provider GET/webhook evidence distinguishes pending, uncertain, failed and processed. Equal-value partial returns cannot adopt one another's refund. UPI/card/net-banking fixtures verify the original payment ID and separate provider IDs. Timeout and interrupted-finalization recovery are covered by payment HTTP regression tests. |
| COD wallet | Wallet credit, wallet ledger, payment totals and destination evidence commit together. Finalization recovers from the durable credit. Coins restore separately in the terminal Return transaction. Duplicate/concurrent credits, unpaid collection, historical offline blocking and spendability through the checkout wallet debit service are tested. |
| Receipt and inventory | Seller receipt plus RESTOCKABLE/NON_RESTOCKABLE inspection gates RETURN_RECEIVED; stock changes once. Refund requests require receipt and completed inspection. Active pickups block cancellation of the parent return. |
| Manual pickup | Explicit MANUAL selection, same-city routing, authorized offers, shared rider capacity, bounded OTP attempts/expiry, and transactional seller receipt/rider earning. The existing journal maps rider earnings to Delivery cost; no extra balancing entry was invented. Trial balance is tested. |
| Shiprocket | Existing authenticated client extended with return creation, return AWB, pickup scheduling, lookup/detail, tracking and cancellation. Actual identifiers only. Durable pre-dispatch claim prevents concurrent booking. Timeout/partial outcomes block redispatch and switching. Verified events are deduplicated and monotonic, including a delivery-webhook/scheduling-response race. Cancellation acknowledgement alone does not permit switching; confirmed cancellation retains identifiers in history. |
| Accounting | Existing conserved paise allocation and immutable snapshots retained. Verified refund evidence gates reversal. Seller payable, commission, tax, discount and recovery behavior remain covered by financial-workflow tests. Releasing one line does not change the reversal bucket of another. |
| Disputes | Signed merchandise dispute events record an idempotent hold, serialize with financial operations and prevent release/reservation of affected released earnings. A closed event does not silently clear the hold. Reconciliation of an already-dispatched refund remains permitted. |
| UI | Customer request keys and actual refund destination; seller method selection, provider status/AWB, refresh/cancel and receipt; admin QC/refund controls and historical COD explanation. No ordinary COD cash-settlement form remains. |

## Executed tests

Counts below overlap when a broader suite includes a targeted case; do not add rows to claim a unique total. Raw logs and JSON are under `test-artifacts/return-repair/` (local ignored artifacts).

| Test suite | Passed | Failed | Skipped | Result / artifact |
|---|---:|---:|---:|---|
| Return eligibility and quantities | 9 | 0 | 0 | `final-lifecycle.json` |
| Focused payout holds / dispute / mixed-order concurrency | 3 | 0 | 0 | `final-lifecycle.json`; broader coverage in finance suite |
| COD wallet | 6 | 0 | 0 | `final-lifecycle.json` |
| Shiprocket reverse lifecycle | 18 | 0 | 0 | `final-lifecycle.json` |
| Shiprocket HTTP/authentication client contract | 7 | 0 | 0 | `final-lifecycle.json` |
| Manual receipt, OTP and balanced rider accounting | 3 | 0 | 0 | `final-lifecycle.json` |
| Shared shopping/reverse rider concurrency | 25 | 0 | 0 | `final-lifecycle.json` |
| Razorpay original-source and seller reversal integration | 6 | 0 | 0 | `final-lifecycle.json` |
| Financial workflow regression | 107 | 0 | 0 | `final-finance.json` |
| Full backend verification suite | 762 | 0 | 0 | 25 suites; `final-verification.json` |
| Payment HTTP / Razorpay / compatibility regression | 190 | 0 | 0 | `final-payment.json` |
| Final payment recovery review | 30 | 0 | 138 | `final-recovery-review.json`; unrelated cases excluded by name filter |
| Frontend policy, finance, payment and courier-fee component tests | 70 | 0 | 0 | `frontend-targeted.log` |
| New seller return action component tests | 4 | 0 | 0 | `return-actions-ui.log` |
| General backend Jest suite | 781 | 8 | 7 | `full-jest-correct-cwd.json`; also one suite failed to load |
| Browser E2E | 0 | — | — | Blocked before assertions: Chrome and Edge time out at CDP `Page.enable`, including GPU-disabled retry; `browser.log`, `browser-edge.log`, `browser-final.log` |
| Backend syntax / service-package checks | — | — | — | Passed `node --check` for changed backend JS and entry point; passed `checkServicePackage.mjs` |
| Default backend build | — | — | — | Not executed: build runs obfuscated `backend/api.js` before checks |
| Default frontend build baseline | — | — | — | Failed with outbound EACCES from the pre-existing obfuscated Vite config |
| Transparent frontend production bundle | — | — | — | Passed; `frontend-build.log`, normal chunk-size warning |

The general-suite failures reproduced against an isolated copy of the original commit are: one order-fulfillment test waiting on an unconnected commission model; one wholesale-auth expectation; three admin finance permission/old payout expectations; three SMS tests with incomplete Shiprocket runtime configuration. The checkout HTTP suite cannot load because its coin-service mock omits `releaseReservedCoins`. They are not hidden or counted as passing.

Initial broad invocations from the repository root produced additional cwd-dependent errors. Rerunning from `backend` removed those errors. Updated rider and refund fixtures now include explicit MANUAL approval and completed receipt/QC instead of bypassing the new guards. A concurrent verification run also hit Mongo startup timeout; the affected 25 rider tests subsequently passed. These intermediate logs are retained.

`backend/__tests__` is ignored/untracked in this checkout: local HTTP-mock fixture repairs there are not part of the tracked patch. Durable new regression coverage is in `backend/verification`. Preserve this distinction when preparing a commit.

## Significant files

| Exact path | Purpose |
|---|---|
| `backend/controllers/order.controller.js` | Single-checkout policy parity; legacy endpoint deprecation |
| `backend/models/Return.js` | Request-key uniqueness, destination and courier evidence/state |
| `backend/services/return.service.js` | Quantity, inspection, wallet credit, terminal coin restoration and legacy safeguards |
| `backend/services/coin.service.js` | Idempotent coin restoration before balance mutation |
| `backend/constants/enums.js` | Valid RETURN reference for restored coins |
| `backend/controllers/return.controller.js` | Actual customer destination/tracking, seller pickup actions and complete refund estimate |
| `backend/routes/seller.routes.js` | Approved-seller pickup selection/refresh/cancel endpoints |
| `backend/services/returnPickup.service.js` | Explicit manual method, offer authorization, routing, OTP and atomic receipt/accounting |
| `backend/services/returnCourier.service.js` | Booking lock, payload, provider identifiers, reconciliation, monotonic tracking and cancellation |
| `backend/services/shiprocket.service.js` | Extend existing client with reverse operations |
| `backend/controllers/fulfillment.controller.js` | Authenticated reverse webhook dispatch without forward-order mutation |
| `backend/services/returnHold.service.js` | Frozen item-window hold calculation |
| `backend/services/orderFinance.service.js` | Per-item release and correct reversal bucket |
| `backend/services/financeAutomation.service.js` | Consider mixed held orders for release |
| `backend/services/sellerSettlementEligibility.service.js` | Shared seller/admin payout guard for released lines, returns and disputes |
| `backend/services/historicalFinance.service.js` | Recheck historical release evidence |
| `backend/services/refundFunding.service.js` | COD wallet evidence and relevant pending/completed return funding |
| `backend/services/paymentRecovery.service.js` | Authoritative original capture, obligations/caps, distinct equal-value returns |
| `backend/models/Payment.js` | Durable merchandise dispute hold/history |
| `backend/services/merchandiseDispute.service.js` | Signed dispute processing and financial serialization |
| `backend/controllers/payment.controller.js` | Dispute dispatch after signature verification |
| `backend/services/financialReconciliation.service.js` | Observable disputed-payment exception |
| `forntend/src/modules/Seller/components/SellerReturnsTab.jsx` | Explicit method confirmation and actual courier actions/status |
| `forntend/src/modules/Admin/components/ReturnsTab.jsx` | Remove normal offline COD controls and stale provider copy |
| `forntend/src/modules/User/pages/OrderTrackingPage.jsx` | Request idempotency, destination and tracking |
| `backend/verification/return-lifecycle.test.js` | Transactional lifecycle and mocked courier regression |
| `backend/verification/shiprocket-reverse-client.test.js` | Mocked HTTP contract and configuration failure tests |
| `backend/verification/seller-refund-integration.test.js` | Original-source methods and sequential equal-value refunds |
| `backend/verification/financial-workflow.test.js` | Explicit return-policy and inspection fixtures |
| `backend/verification/shopping-driver-concurrency.test.js` | Approved manual return fixtures for shared rider capacity |
| `forntend/verification/return-actions-ui.test.mjs` | Actual seller component selection, uncertain outcome and network errors |
| `forntend/verification/return-repair-ui.mjs` | Existing component tests with transparent config and correct cwd |
| `forntend/verification/return-lifecycle-browser.mjs` | Isolated browser scenario; currently environment-blocked |
| `forntend/vite.return-verification.config.mjs` | Transparent local production-build/test config |

Unrelated edits appeared during the resumed session in `backend/services/advertisingBillingPolicy.service.js` and `forntend/src/modules/Seller/pages/DashboardPage.jsx`. They were preserved and are not attributed to this repair.

## Provider verification and remaining gates

Shiprocket contract references: [official API documentation](https://apidocs.shiprocket.in/?version=latest), [reverse workflow documentation](https://apidocs-test.shiprocket.in/guides/returns-workflow/), [order lifecycle documentation](https://apidocs-test.shiprocket.in/guides/order-lifecycle/). These are documentation hosts, not permission to use a live account or evidence of a working sandbox.

Authentication/token reuse, reverse payload/endpoint, AWB `is_return`, scheduling, exact-reference lookup, shipment identity, cancellation and signed webhook handling were verified with mocks. No authorized isolated account was provided. Before staging activation, verify reverse capability/serviceability, seller return address and package data, account-specific responses and cancellation/webhook behavior. Local reverse operations reject live mode and do not invent a booking in mock mode.

Uncertain creation or partially completed AWB/scheduling stays blocked until provider evidence resolves it. Absence from one lookup does not prove no booking exists. If tracking cannot resolve the state, operations must reconcile in the Shiprocket account and refresh; there is no unsafe force-reset endpoint. Lost/damaged/destroyed parcels remain exceptions and do not bypass receipt/QC.

New unsupported PhonePe return execution fails closed; historical records are retained. Historical COD `manual_pending` requires accounting review of cash already paid before any wallet migration. Dispute holds require a reviewed recovery decision; automatic clearing on a closed/won event is deliberately absent. These cases have no new destructive migration or automatic balance rewrite.

Delivery-charge refunds remain excluded under the existing item allocation because the repository does not establish an approved replacement entitlement. This business decision is unresolved. MongoDB transactions require a replica set or supported sharded topology. Existing deployment index procedures must include the new Return request-key/shipment indexes; no production index operation was performed.

The default obfuscated bootstrap/config files were preserved. Their review/removal is a deployment blocker; the transparent bundle is a verification artifact, not a deployment.

## Reproduce

From `backend`, run Jest with `--experimental-vm-modules`, `verification/jest.config.js`, `--runInBand`, and the targeted `verification/return-lifecycle.test.js`, `verification/shiprocket-reverse-client.test.js`, `verification/seller-refund-integration.test.js`, `verification/financial-workflow.test.js`, and `verification/shopping-driver-concurrency.test.js` paths. Run the general suite with `__tests__/jest.config.js` from the same cwd.

From repository root: `node forntend/verification/return-repair-ui.mjs` and `node forntend/node_modules/vite/bin/vite.js build forntend --config forntend/vite.return-verification.config.mjs`. From `forntend`: `node --test verification/return-actions-ui.test.mjs`. Browser verification: `node forntend/verification/return-lifecycle-browser.mjs` from repository root. All these test paths use synthetic fixtures; no production startup command is needed.
