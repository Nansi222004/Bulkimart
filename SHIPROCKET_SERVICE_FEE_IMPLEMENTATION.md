# Quick Commerce Shiprocket service fee

## Release status

Implemented behind `QUICK_SHIPROCKET_SELLER_COLLECTION_ENABLED`, which defaults
to disabled unless explicitly set to `true`. The owner explicitly confirmed
that fee values, tax treatment and seller collection/reconciliation are **not
approved**. Keep the flag false and the database configuration disabled.
No production configuration, database migration, seller balance deduction,
real gateway order, or live shipment was performed during this work.

## Existing architecture and changes

The repository already contained an Option B freight calculator, immutable
Quick Commerce financial snapshots, append-only seller ledger, admin finance
screen and guarded Shiprocket workflow. The admin screen previously edited
only a flat/percentage draft value and version; the calculator ignored limits
and tax, and Quick Commerce shipment creation was unconditionally disabled.
Seller earnings/payouts did not provide a verified fee-collection operation.

This implementation extends those models and the existing Razorpay service,
Payment attempt journal, signed webhook and recovery tools. It does not create
a new payment gateway, use the customer's Payment for seller collections,
or debit the seller's available wallet/payout earnings.

### Configuration

The existing admin Quick third-party settings tab now contains **Shiprocket
Service Fee Configuration**, monitoring, search/status/exception filters and
configuration history. An administrator can specify:

- Fixed fee or percentage; explicit percentage base: eligible courier freight
  or seller freight remaining after customer contribution.
- Optional minimum/maximum. Limits apply to the configured fee before tax
  extraction/addition: inclusive limits include tax; exclusive limits exclude it.
- Inclusive, exclusive or exempt tax, with an explicit approved rate. Exempt
  requires an explicit zero rate. No rate, amount or percentage is preselected.
- INR, the existing provider's supported currency; other currencies are rejected.
- Effective date/time (UTC), enable status, and prepayment requirement.

Backend validation is authoritative. Each save increments a revision and
records the submitted configuration, actor and time in the same atomic write.
Stale edits return 409. Versioned snapshots preserve old invoices when rules change.
Postpaid (`paymentRequired=false`) can be saved as a disabled draft but cannot
activate: no approved credit/collection policy exists. Future-dated disabled
rules can be prepared; activation requires that their effective date is reached.

Existing approval gates remain: surplus treatment, returns/holds, cancellation,
COD reconciliation, insufficient funds, shared freight, release verification,
Shiprocket configuration/capability and Razorpay configuration. The fee editor
cannot override the existing policy approvals.

### Fee and shipment lifecycle

1. Seller accepts and prepares a single-store Quick Commerce fulfillment order,
   marks it ready and chooses Shiprocket. Customer online payment must already
   be verified; COD retains its existing eligibility.
2. Provider serviceability supplies `freight_charge`; registered pickup and item
   weight must be valid. No client amount establishes the freight or charge.
3. Customer contribution = min(existing order delivery charge, courier freight).
   Seller freight = max(0, courier freight minus contribution). Add the net
   service fee and configured tax once. Customer prices remain unchanged.
4. Seller reviews and explicitly confirms the total and fee version. The backend
   recalculates and rejects changed estimates. A MongoDB transaction serializes
   order selection and creates one immutable snapshot, freight/fee/tax held
   liabilities and a separate pending Payment owned by this seller.
5. A durable attempt/receipt precedes Razorpay creation. Refresh and retry reuse
   the same provider order. Uncertain creation stays blocked for existing admin
   payment-recovery reconciliation; it never silently issues another order.
6. The existing signed Razorpay webhook or a signature-checked callback plus
   server-to-server capture lookup settles the seller collection. Capture amount,
   currency and gateway association must match the stored obligation. Payment
   and its one matching held-ledger credit commit together. Repeated/concurrent
   callbacks are idempotent. Failed/pending payments do not authorize shipping.
7. Shipment creation independently requires a paid Payment, matching verified
   capture and ledger credit. Freight and courier must still match the paid
   snapshot. Expired/changed quotes require reconciliation. Test/live payment
   and shipping environments cannot be mixed. Existing provider operation locks,
   uncertain-outcome handling and customer shipping prices are preserved.

Additional/late captures for an ineligible order create a durable refund debt,
not another fulfillment credit. Switching to manual delivery while a fee
obligation exists is blocked pending reconciliation. Multi-store orders remain
unsupported as a single shipment, as before; existing split fulfillment orders
have independent seller-owned obligations. Multiple items share their order's
single obligation, not an extra charge per item.

## Routes

All admin routes retain `protect` + `requireAdmin`. Seller routes retain
`protect`, seller session checks, approved seller and order ownership checks.

| Method / route | Purpose |
| --- | --- |
| GET/PATCH `/api/admin/quick-commerce-third-party-config` | Read/save configuration and history; PATCH includes current `revision` |
| GET `/api/admin/quick-commerce-shiprocket-fees` | Paginated records; `q`, `status`, `exceptions`, `page` |
| GET `/api/sellers/orders/:id/shiprocket-fee` | Restore immutable review and persisted payment state |
| POST `/api/sellers/orders/:id/shiprocket-fee` | Confirm/recalculate and initialize or reuse seller payment |
| POST `/api/sellers/shiprocket-fees/verify` | Verify seller-owned Razorpay callback using existing provider helpers |
| POST `/api/payments/razorpay/webhook` | Existing cryptographically verified capture/failure delivery |
| POST `/api/sellers/orders/:id/fulfillment/shiprocket` | Existing shipment workflow with added Quick fee guard |

Confirmation body: `{confirm:true, reviewedTotal:<reviewed server estimate>,
feeVersion:<displayed version>}`. The number is a consent check, never the
authoritative charge. Verify uses the existing Razorpay callback fields and
`orderId` containing the **seller Payment ID** returned in the checkout payload.

Monitoring shows order/store, freight, contribution, net fee, tax, total,
payment/shipment states and provider references. Exception filtering currently
covers uncertain initialization and recorded refund debts. Broader automated
freight/provider-statement reconciliation is still a release prerequisite.

## Changed files

| Files | Purpose |
| --- | --- |
| `backend/models/QuickCommerceDeliveryConfig.js` | Persist rule fields, optimistic revision and history |
| `backend/models/QuickCommerceFinancialSnapshot.js` | Freeze base, tax, config revision, courier and environments |
| `backend/models/Payment.js` | Separate snapshot-linked collection; partial unique index |
| `backend/models/SellerLedgerEntry.js` | Tax liability and verified collection entry types |
| `backend/services/quickCommerceFinance.service.js` | Configuration validation/gates, limits/tax, immutable obligation posting |
| `backend/services/quickShiprocketCollection.service.js` | Transactional capture settlement and shipment payment guard |
| `backend/controllers/quickShiprocketFee.controller.js` | Seller review, authoritative quote, initiation/reuse/status/verification |
| `backend/controllers/payment.controller.js` | Route trusted Razorpay signals to seller collection settlement |
| `backend/controllers/fulfillment.controller.js` | Display breakdown; guard shipment, provider environment and method changes |
| `backend/controllers/seller.controller.js` | Prevent bypassing the fee obligation by dispatching to riders |
| `backend/controllers/adminSellerFinance.controller.js` | Configuration updates and searchable payment monitoring |
| `backend/routes/admin.routes.js`, `backend/routes/seller.routes.js` | Protected routes |
| `backend/scripts/ensureQuickShiprocketFeeIndexes.mjs` | Explicit additive uniqueness preparation; not run against production |
| `backend/.env.example` | Disabled feature-flag documentation |
| `backend/verification/quick-shiprocket-fee.test.js`, `backend/package.json` | Isolated calculation/payment/ledger/authorization regressions and test command |
| `backend/verification/jest.config.js` | Allow realistic Mongo replica-set startup time |
| `forntend/src/modules/Admin/components/QuickThirdPartySettingsTab.jsx` | Fee editor, audit history and monitoring |
| `forntend/src/modules/Seller/components/ShiprocketFeePayment.jsx` | Readable review, confirmation, payment/status/retry controls |
| `forntend/src/modules/Seller/components/OrdersTab.jsx` | Integrate fee UI; disable unpaid Quick shipment action; remove duplicate summary |
| `forntend/src/modules/Seller/components/SellerOrderDetails.css` | Scoped responsive fee layout and touch targets |
| `forntend/src/utils/razorpayCheckout.js` | Allowlisted seller verification path using existing SDK behavior |
| `forntend/verification/shiprocket-fee-ui.test.mjs`, `forntend/package.json` | Seller UI regression command/tests |
| This document | Implementation, validation, release decisions and deployment checklist |

## Verification

All financial/API tests use an isolated MongoDB replica set, dummy Razorpay
keys and provider stubs/mock shipping. Synthetic fee/rate values exist only in
tests, not initial application configuration.

- `npm run test:fcm-auth --prefix backend`: 4 suites / 85 tests passed across
  committed auth/payment/fee verification. Includes 37 new fee tests: calculations, limits, taxes,
  missing policy/freight, disabled charging, ledger/capture idempotency, webhook
  before browser verification, retries, uncertain creation, amount tampering,
  tenant isolation, pending/failed customer and seller payment, cancellation,
  environment isolation, unpaid shipment rejection and paid mock shipment.
- Existing backend targeted regression run: 5 suites / 71 tests passed (Option B,
  fulfillment lifecycle, seller-first checkout, Razorpay webhook, seller lifecycle).
- `npm run test:shiprocket-fees --prefix forntend`: 4 passed.
- `npm run test:payment-overlays --prefix forntend`: 6 passed.
- `npm run test:checkout --prefix forntend`: 36 passed.
- Backend and frontend production builds passed. Existing frontend bundle-size
  warning remains. Neither package defines a lint script; syntax/import/build
  checks and `git diff --check` were run instead.
- Existing Chrome layout runner with isolated Quick-fee fixtures: 7 passed at
  320, 375, 390, 440, 768, 1024 and 1440px; zero browser errors/overflow failures.
  Screenshots and test logs are in ignored `test-artifacts/`.

The first combined database run exceeded an existing 5-second setup timeout;
the committed verification configuration now allows 60 seconds and subsequent
runs pass. The sandboxed browser could not enable Chrome's debugger; the
approved local browser run passed. No production payment test was performed.

## Deployment and approvals (do not activate yet)

1. Obtain written approval for fee method/value/base, minimum/maximum semantics,
   tax rate/treatment, and effective date. Obtain seller collection and ledger
   reconciliation approval for this existing Razorpay merchant account.
2. Preserve existing customer payment credentials and JWT keys. Do not introduce
   new keys or change customer checkout configuration as part of this release.
3. Keep `QUICK_SHIPROCKET_SELLER_COLLECTION_ENABLED=false` on every API worker,
   and keep the DB rule `enabled=false`. The missing flag is also disabled.
4. In an isolated staging database/provider setup, prepare uniqueness indexes
   after DB approval: `node backend/scripts/ensureQuickShiprocketFeeIndexes.mjs`.
   Never use `syncIndexes`, drop historical indexes, or rewrite old fee records.
   The script was syntax-checked, not run against a production database.
5. Verify the actual deployed repository and PM2 process name with the existing
   sanitized command: `node backend/scripts/auditJwtDeployment.mjs`. After the
   reviewed changes are committed/pushed, the existing server deployment command
   is `bash deploy.sh <verified-backend-process-name>`. It installs/builds and
   restarts the named process with updated environment; publish `forntend/dist`
   through the existing static-host workflow as well. No process name is guessed.
6. Test isolated pending/failure/cancel/success, webhook-first/replayed webhook,
   simultaneous confirmations, initialization timeout/recovery, admin permissions,
   changed/expired quotes, and ledger equality before considering live release.
   Verify live provider account eligibility and provider billing reconciliation
   separately; local mock shipment success is not a live shipping approval.

Remaining release decisions: cancellation/refund/return/dispute handling for
seller collections and final courier invoices, operational reconciliation of
changed quotes and uncertain creation, and zero-payable obligations. These
currently fail closed or remain visible in existing recovery/audit records;
no new automatic refund, credit policy, dispute transition, scheduled freight
reconciliation or customer charge has been invented. Existing refund recovery
can reconcile recorded additional-capture debts; full seller lifecycle refund
automation is not asserted here. Expired or changed paid quotes never cause an
automatic second fee. Postpaid and additional currencies are not activated.

Production database/index preparation, real provider capture/webhook tests and
deployment remain unperformed. Keep charging disabled until these checks and
business decisions have been approved and verified.
