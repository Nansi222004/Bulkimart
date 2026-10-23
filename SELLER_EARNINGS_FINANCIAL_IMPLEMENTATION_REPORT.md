# Seller Earnings financial implementation

Implementation date: 2026-10-23. Baseline: `SELLER_EARNINGS_FINANCIAL_FORENSIC_AUDIT.md`, read before changes. Existing unrelated working-tree changes were preserved. **No live financial data, flags, indexes or provider operations were changed.** The implemented corrections and controls are verified below. This is not approval for production financial activation.

| Defect / owner | Dependency or business decision | Acceptance |
| --- | --- | --- |
| Checkout coupon alias / pricing and snapshots | Distinct components are unambiguous; discount sponsor ownership remains unapproved | New checkout stores coupon once; legacy reads prove normalization against payment total; unknown funding blocks posting |
| Partial-refund release / order finance | Original capture, verified refunds and completed compensation | Only remaining funded, compensated entitlement releases; unresolved evidence blocks |
| Zero refund / returns and finance | Internal completion evidence, no external transfer | Durable actor/reason/internal key; zero cash movement; idempotent compensation |
| Payout retry / Seller context | Existing server reservation rules | Same business attempt reuses key; simultaneous submission blocked |
| Permissions, beneficiary and receipt / Admin finance | Approved external verification process is required | Explicit finance authorization; unverifiable destination fails closed; receipt cannot fund two payouts |
| Ledger currency / ledger service | Existing INR-only financial semantics | New invalid precision/currency rejected; replay conflicts rejected |
| Historical recovery / reconciliation | Original payment, custody and historical contract approvals | Read-only manifest; unknown payable null; known orders blocked; no automatic credits |
| Admin estimates and operational UX | Financial previews and approvals | Estimated sales never presented as confirmed payable; manual transfers labelled honestly |

## Implemented corrections

### Pricing, discounts and policy

Single checkout stored `discount = discount + couponDiscount` and also stored `couponDiscount`; financial snapshots deducted both. Digital checkout had the same representation. Physical, unified and digital producers now identify `pricing.discountRepresentation = components-v1`. `discount` contains only its distinct promotion component; coupon, legacy CDS and Coins remain separate.

`orderDiscounts.service.js` reconciles the merchandise reductions plus delivery/tip/donation against the authoritative order total in integer paise. For an unmarked legacy shape only, a coupon alias is normalized in memory if subtracting the duplicate coupon exactly explains the stored total. Conflicting canonical data fails closed. Historical documents are never rewritten. Unmarked old refund calculations retain their compatibility path; a frozen v2 snapshot takes precedence for refunds.

The existing largest-remainder allocation is shared with validated money utilities. Discounts are conserved across line budgets, never exceed merchandise, and have stable index tie-breaking. Partial quantity refunds use cumulative BigInt half-up allocation: `round(lineAmount × cumulativeQty / purchasedQty) - round(lineAmount × precedingQty / purchasedQty)`. The first refund attempt reserves its quantity interval transactionally and freezes the result; retries reuse it. Compensation must process those intervals in sequence. Promotion, coupon, CDS and Coins fields remain separately identifiable.

Product campaigns already lower the frozen item price and are not deducted again. The existing unified checkout rejection of basket coupons remains: no unapproved multi-vendor sponsor allocation was invented. Cancellation still refunds authoritative paid order amounts through the existing recovery workflow; it does not derive a second total from an alias.

**Discount sponsor ownership remains an approval blocker.** There is no approved sponsor configuration in this schema. A new snapshot containing any order-level discount has `state: held_discount_policy`; it preserves customer amounts and applicable rule metadata but does not fabricate commission/tax/net. It cannot be allocated or released. A product campaign's already-frozen gross price remains usable. No caller-provided funding field enables posting. This holds discounted finance until an approved allocation policy is implemented; it does not prevent customer checkout.

Coins rewards depended on the old aggregate field. Canonical rewards now subtract distinct promotion and coupon once, retaining the existing rule that Coins redemption does not shrink its own reward base. Legacy rewards retain their prior reading. Customer order details display separate canonical components; legacy display is preserved.

Approved v2 commission selection, effective dates, disabled-scope precedence, channel/vendor/product/category specificity, fixed-per-item and inclusive/exclusive/exempt tax semantics remain in the existing versioned service. No percentage, tax rate, fee or historical contract was introduced. Legacy rates are not promoted into v2 rules. Admin copy now explicitly distinguishes those rules, missing policy and excluded legacy rates. Gross-sales analytics no longer invent commission, net earnings, order identifiers or fulfilment status; seller order counts count distinct Orders rather than items.

### Refund evidence, compensation and release

The old release guard required `Payment.status === paid`, including after a correctly completed partial refund. The replacement checks original funding, its exact association with the frozen order(s), verified refund evidence, cumulative payment refund totals, remaining funds, order compensation markers and existing return deadlines.

- Online funding requires a settled INR capture journal matching the original Payment amount. All seller-scoped sibling snapshots must sum exactly to that Payment; a valid capture for a smaller amount cannot fund a larger order. Shared payments are not counted as full sales for every seller.
- A partial-refund projection is accepted only with completed Returns and processed, independently verified refund obligations bound to the capture, Return, amount, currency and provider refund ID. Unmatched obligations, reused provider references, incomplete Returns and inconsistent cumulative refund totals block release. A `paid` projection with recorded cash refunds is also investigated, rather than bypassing the check.
- Wallet funding requires the completed original debit; compensation/release requires the matching completed Return credit and consistent Payment refund totals.
- COD retains the existing independent collection/remittance/receipt checks. Nonzero COD Return compensation additionally requires the manual settlement actor, time, note and `MANUAL-COD` marker. Delivery OTP alone remains insufficient.
- Full refund compensation removes the entire frozen entitlement and marks the posting reversed. No remaining amount is released. A fully refunded Payment cannot release a positive residual.
- Zero-value completion records `zeroRefundEvidence` with `ZERO_RETURN:<id>`, actor, reason and completion time. The provider reference stays absent. The frozen amount must be exactly zero. Compensation records a durable processed marker and any legitimate gross-reporting adjustment; it creates no fictitious cash or payable transaction.
- Compensating entries remain append-only. Net exceeding remaining eligible money becomes held debt; original entries are not edited. Order, Payment and seller write fences serialize the affected operations. An integration race test revealed that old Returns without denormalized `sellerId` could be missed by payout checks; eligibility now derives ownership from the original Order item.

### Payout request and manual settlement

The Seller UI persists an opaque business-request key in session storage, scoped by seller and two-decimal amount. Ambiguous/failed responses retain the key; a confirmed response completes the intent. An immediate ref lock suppresses concurrent clicks before React rerenders. The form is disabled while submitting or while server actions are disabled. A late response after a seller session change cannot update the replacement session. No bank details are stored in browser intent storage.

The server still derives the seller from the authenticated approved profile. It rechecks current approval, funds, debt, Return/COD blockers and destination inside the reservation transaction. Identical requests replay; conflicting reuse is rejected. Reservations and their payout record remain atomic.

No bank ownership verification integration existed. Approval now fails closed until the following explicit manual controls exist:

1. A separately approved process record in `finance_approved_processes`: exact reference `_id`, `kind: bank_beneficiary_verification`, approved status, policy version, effective date, active finance approver and external approval evidence reference. Expired, absent, malformed and revoked processes block settlement. No process is seeded by application startup or this task.
2. A finance operator records ownership evidence for the exact frozen destination fingerprint, with the approved process reference and reason. The review endpoint rejects a stale fingerprint. Replays must agree. Renewed process versions require new evidence, retaining earlier reviews in history.
3. A **different** finance operator reconciles the externally completed transfer. Merely reviewing a request cannot mark it paid. The server checks destination, process version, currency, seller/account-scoped reservation, remaining reserved funds, debt and settlement blockers again.
4. A case-normalized, trimmed transfer reference is claimed transactionally in `seller_payout_receipts`, using MongoDB's unique `_id` index across sellers. Existing approved payout references are checked as well. One receipt cannot settle two requests; concurrent conflicts roll back. A repeated settlement must agree with the original actor, reason and reference.
5. Rejection releases the exact reservation through atomic compensating entries. Failed verification leaves the request pending and money reserved.

Bank destination snapshots, payout amounts and seller ownership are immutable through ordinary model saves. Ordinary finance responses expose only bank name, last four account digits and a UPI-presence indicator. No full bank data was added to reports, ordinary payout responses or logs. Existing privileged seller-management registration APIs are outside this payout DTO change.

The UI describes `PENDING` as pending Admin review, `REJECTED` as rejected, and the legacy persisted name `APPROVED` as **external transfer confirmed / internally reconciled**. No transfer is initiated by these routes; no fictitious processing/webhook/bank-success state was added. External evidence is an authorized human attestation under the approved process, not an independent bank API lookup.

### Authorization, ledger and operational review

All merchandise finance routes and their legacy aliases, recovery APIs, refund/COD settlement actions, rider payout, delivery-rate and customer delivery-charge controls on `admin.routes.js` require explicit `manage_finance` in addition to existing authentication/Admin access. A superAdmin role alone does not bypass this permission. No live permission was granted.

Admin allocation, seller/rider release and Return compensation require evidence, reason and the previewed `expectedRevision`. Order changes reject stale previews, and successful review details are written transactionally to `Order.financialOperationLog`. COD Admin review also carries that revision. Return compensation has a read-only preview endpoint, presenting seller, order, item, quantity, currency, rule version, compensation and consequences before mutation. UI submission locks prevent duplicate actions.

The existing ledger is retained. New posts and schema validation require INR and finite positive two-decimal rupees; conflicting currency replay fails. Seller balances detect incompatible raw historical currency/precision and return an error, rather than silently mixing units. Aggregation sums integer paise and converts to rupees once. The secondary `reversals` activity metric now counts the actual debit compensations. Existing append-only guards and compensating entries remain.

This remains a financial subledger, not a newly introduced statutory general ledger or proof of segregated bank escrow. Held liability does not prove cash custody. Earned/fee activity remains cumulative, eligible is currently reservable subject to checks, reserved is committed money, and settled is manually reconciled transfer activity.

## Historical recovery and deliberate non-mutations

`historicalExceptions` reads real Orders, Payments, Deliveries, Returns, current rule IDs, scoped ledger, prior seller payouts and unattributed seller ledger. It emits one row per seller/order/item, reasons, sanitized evidence/hash, exact IDs and a deterministic event key. Current commission rules never prove the original agreement. Unknown payable remains `null` with no proposed postings. Prior payouts and conflicting postings force additional review. Admin Finance Center has a read-only historical exception view with pagination and explicit coverage.

The offline CLI imports only the pure manifest utility, reads a saved export and writes JSON. It has no environment loading, DB connection, provider import or apply option:

```powershell
node backend/scripts/historicalFinanceDryRun.mjs test-artifacts/seller-earnings-audit/database-evidence.json backend/verification/fixtures/historical-finance-dry-run.sample.json
```

Result: two rows, zero mutations. The source export deliberately excluded ownership/contact fields, so it cannot independently re-establish customer/payment ownership. Missing evidence remains flagged rather than guessed.

Both `ORD-20261015-K2OCHK` and `ORD-20261019-CIRFK5` remain blocked, with proposed payable `null`. Online legacy capture metadata is distinguished from the current capture journal. COD OTP is distinguished from receipt. Original snapshots, Orders, Payments and ledger are untouched.

`applyReviewedHistoricalBatch` is a separate non-routed service: no generic audit CLI/HTTP endpoint can apply it. It requires an externally provisioned versioned approved batch, exact approval reference, independent active finance operator/reviewer, manifest digest, original contract/policy, funding/custody evidence, exact amounts and additional prior-payout/refund reconciliation references where relevant. It validates frozen item gross and `net + commission + tax = eligible`, reloads evidence under Order/seller fences, and rejects stale/duplicate/conflicting entries. All entries and batch completion are one transaction; a repeated batch cannot credit twice. Approved synthetic fixtures demonstrate this boundary. Unknown manifests cannot be applied by supplying a JSON amount to the read command.

Historical approved entries post into **held**, with batch/actor/policy/evidence metadata; they do not rewrite or invent a current snapshot. There is intentionally no automatic historical release: that needs a separately approved, order-specific release/recovery design. No approved batch or beneficiary-process record was provisioned in a live database here. DB-level access control for those approval collections is a rollout prerequisite; application checks cannot protect against an unrestricted database administrator rewriting approvals.

## Files changed in this implementation

The working tree already contained the audit-stage changes and unrelated work. This list identifies files touched by this implementation, not a claim that every pre-existing diff in them originated here.

| Area | Exact files |
| --- | --- |
| Pricing and representation | `backend/controllers/order.controller.js`; `backend/controllers/digitalCommerce.controller.js`; `backend/services/fulfilmentOrders.service.js`; `backend/services/orderDiscounts.service.js` (new); `backend/utils/financeMoney.js` (new); `backend/services/vendorCommission.service.js`; `backend/services/coin.service.js` |
| Refunds and release | `backend/services/orderFinance.service.js`; `backend/services/refundFunding.service.js` (new); `backend/services/return.service.js`; `backend/models/Return.js`; `backend/models/Order.js`; `backend/services/sellerSettlementEligibility.service.js`; `backend/services/financialReconciliation.service.js` |
| Payout, ledger and Admin APIs | `backend/controllers/sellerFinance.controller.js`; `backend/controllers/adminSellerFinance.controller.js`; `backend/controllers/admin.controller.js`; `backend/controllers/financeWorkflow.controller.js`; `backend/routes/admin.routes.js`; `backend/middlewares/financePermission.middleware.js` (new); `backend/services/payoutEvidence.service.js` (new); `backend/models/SellerPayout.js`; `backend/models/SellerLedgerEntry.js`; `backend/services/sellerLedger.service.js` |
| Historical evidence and separate reviewed apply | `backend/utils/historicalManifest.js` (new); `backend/services/historicalFinance.service.js` (new); `backend/scripts/historicalFinanceDryRun.mjs` (new); `backend/verification/fixtures/historical-finance-dry-run.sample.json` (new) |
| Seller and customer UI | `forntend/src/modules/Seller/context/SellerContext.jsx`; `forntend/src/modules/Seller/utils/payoutIntent.js` (new); Seller `components/MoneyRequestTab.jsx`, `EarningsTab.jsx`, `PaymentHistoryTab.jsx`, `OrderFinancialBreakdown.jsx`; `forntend/src/utils/orderDiscounts.js` (new); `forntend/src/modules/User/pages/OrderTrackingPage.jsx` |
| Admin UI | `forntend/src/modules/Admin/components/FinanceCenter.jsx`; `FinanceWorkflowTab.jsx`; `SellerLedgerAdminTab.jsx`; `VendorFinancialsTab.jsx`; `HistoricalFinancePanel.jsx` (new) |
| Tests | `backend/verification/financial-workflow.test.js`; `backend/verification/seller-refund-integration.test.js` (new); `backend/__tests__/api/checkout-workflow.http.test.js`; `forntend/verification/financial-workflow-ui.test.mjs`; `forntend/verification/seller-earnings-audit-browser.mjs` |
| Delivery documents | This report; `SELLER_EARNINGS_FINANCIAL_ROLLOUT_CHECKLIST.md` |

Evidence output is under `test-artifacts/seller-earnings-audit/` and `test-artifacts/mobile-native/seller-earnings-audit-*.json`. The original forensic report remains the historical audit baseline. No secrets were copied into the new sample manifest.

## Verification

All backend commands use the existing sanitized runner, isolated persistence and mocked external providers. No developer database URL or live provider credentials are inherited by those tests. Tests using raw collection writes create deliberate isolated fixtures/corruption only; those writes are not migration code.

| Directory / exact command | Result |
| --- | --- |
| Backend: `node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --silent --json --outputFile ../test-artifacts/seller-earnings-audit/implementation-finance-tests.json --runTestsByPath verification/financial-workflow.test.js verification/seller-refund-integration.test.js verification/quick-shiprocket-fee.test.js verification/payment-notifications.test.js` | **4 suites passed; 142 tests passed; 0 failed.** Includes actual mocked provider Return→Payment→compensation→release, online/wallet/COD funding, concurrency, unique receipts, permissions, policy/tax/precision, historical dry-run/apply guards and existing payment/freight tests. |
| Backend: `node verification/run-shopping-capacity-tests.mjs --config __tests__/jest.config.js --runInBand --silent --json --outputFile ../test-artifacts/seller-earnings-audit/implementation-regression-tests.json --runTestsByPath __tests__/services/financial-integrity.test.js __tests__/services/return-compatibility.test.js __tests__/api/checkout-workflow.http.test.js __tests__/api/seller-payment.http.test.js __tests__/api/seller-payment.api.test.js __tests__/api/seller-first-checkout.http.test.js __tests__/api/checkout-address-contact.test.js` | **6 suites passed, 1 failed; 102 tests passed, 1 failed, 7 skipped (110 total).** Checkout regression asserts new coupon stored once. See failure below. |
| Frontend: `node --test verification/financial-workflow-ui.test.mjs verification/finance-center-ui.test.mjs verification/shiprocket-fee-ui.test.mjs verification/payment-ui.test.mjs` | **63 tests passed; 0 failed.** Covers actual Seller provider retries/double clicks, genuine zero versus errors, historical exceptions, discount holds, customer component display, existing Finance Center and payments. |
| Frontend: `node verification/seller-earnings-audit-browser.mjs` | **42 checks passed; 0 failures; 0 runtime exceptions**, production React artifact with intercepted APIs at 320,360,375,390,430,768,1280px. Genuine posted zero/gross sales, failed/malformed earnings and payout reads, and failed history. Screenshots at390px inspected; warning and gross/ledger distinction remain readable. No real account/provider used. |
| Frontend: `npm run build` | Passed; existing >500kB chunk warning remains. |
| Backend: `npm run build` | Passed; backend service package import and syntax checks. |
| Root: offline manifest command above | Passed; 2 rows; 0 mutations; both payables null. |
| Root: scoped `git -c core.safecrlf=false diff --check -- <implementation tracked paths>` | Passed (exit0); earlier single trailing-whitespace finding corrected. |

The broader failure is the same current-worktree failure documented by the forensic audit: `backend/__tests__/api/seller-payment.http.test.js:563` expects unauthenticated `/api/products/wholesale/catalog` to return401; current application returns200. This task did not change that route or weaken the test. Seven skipped tests remain unverified. Full repository suites were not run. Repeated iteration totals overlap and must not be added. Vite's concurrent test servers emitted a WebSocket port24678 warning; it did not fail the tests.

## Remaining decisions and release boundary

- Discount sponsor/subsidy reimbursement, merchandise GST, gateway fee allocation, seller payout minimum/fees, reverse logistics and exchanges still require approved business rules. New discounted finance is blocked, not silently charged to a seller. No rate or tax assumption is used for historical orders.
- No approved bank verification process or historical entitlement approval was supplied/provisioned. Their controls deliberately prevent live approval/apply. There is no bank API integration, automatic transfer/reversal or proof of provider-to-platform-bank-to-seller reconciliation.
- If a refund happens before original seller allocation, the existing original-allocation requirement still blocks compensation/posting; it is not bypassed to create an entitlement. Review that operational exception before rollout. Unsupported/unmatched shared-payment cancellation refunds also remain reconciliation blockers instead of guessed funding.
- Historical apply is a reviewed recovery primitive, not a customer-facing auto-backfill or complete historical settlement system. Historical release and legacy capture/custody evidence require separate authorization. A mistaken approved entry must be quarantined and compensated, never deleted.
- DB-level approval-collection protection, finance operator assignment, independent external evidence retention, existing index verification, production load/performance review of reconciliation, and real sandbox acceptance are prerequisites. Neither tests nor this report grant production approval.
- The wholesale regression failure prevents an all-green broader regression claim. Final readiness is **blocked pending approved policies, external process setup, legacy evidence and resolution/triage of that unrelated regression**.

**Live-change confirmation:** no live payment, refund, bank transfer, COD remittance, reconciliation posting, historical backfill, held release, permission grant, production index creation, feature-flag activation or deployment was performed.
