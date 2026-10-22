# Commission, rider payments and COD workflow

Implementation date: 21 October 2026. **Staging implementation; not approved for
production activation.** Read [the pre-change audit](FINANCIAL_SYSTEM_AUDIT.md)
first. New financial operations default to disabled. The full backend suite is 
not green; the exact failures and remaining release decisions are recorded below.

## Financial source of truth

This extends `SellerLedgerEntry` and `sellerLedger.service`; it does not create a
second financial ledger or another customer payment flow. Existing customer
WalletLedger, CoinTransaction, Payment, SellerPayout, DeliveryPayout and Quick
Shiprocket services retain their purposes. No new Razorpay charge/payout API is
called. Payouts use the existing manual bank reconciliation architecture.

Ledger accounts now distinguish seller payable, rider payable, commission
revenue, commission tax liability, customer delivery charges, merchandise gross,
COD custody and excess-cash liability. Existing freight/service-fee/tax/payment
types remain separate and unchanged. Legacy rows without `account` count as
seller payable. Platform reporting entries never increase seller balances.
The merchandise gross account is a reporting dimension, not additional revenue.
This is an extension of the settlement ledger, not a claim that the application
already has a complete statutory double-entry general ledger.

New records use existing ledger event-key uniqueness and transactional entity
fences. Event-key reuse with different owner, amount, order, payment, delivery,
snapshot or account is rejected. Updates, replacement, deletion, existing-row
saves and bulk writes through the ledger model are rejected. Database maintenance
credentials can bypass application middleware and require separate controls.

## Commission workflow

1. Admin inserts a new version into the existing Commission collection, with
   channel, vendor type, optional category/product scope, effective date, fixed or
   percentage value, limits, explicit tax treatment/rate, actor and change reason.
   No financial rate/tax value is seeded or preselected. Percentage values must
   be 0–100; money/rate precision is validated on the backend. A fixed fee applies
   once per order item, not per quantity. Min/max apply before exclusive tax or
   include tax for inclusive rules. Over-deductions fail closed.
2. Rules are append-only. Saving an existing scope requires its latest parent ID;
   stale/concurrent edits conflict. Effective date, then creation order determines
   applicability. Product overrides precede category overrides, then the channel
   default. Cross-listed products use the purchased storefront's category.
   A disabled version supersedes the same scope; less-specific active rules can
   still apply. Legacy Commission documents are never silently activated.
3. Only when snapshotting is enabled, the existing Order creation validation
   builds a financial snapshot inside the checkout transaction. It freezes
   payment association/method, totals, line IDs/sellers/quantities, item prices,
   discounts, commission/tax/net amounts and rule version. Missing rules produce
   a visible hold, not a guessed rate. Query and save guards prevent snapshot
   changes. Historical orders receive no snapshots or backfill.
4. The existing proportional gross-value discount basis is retained. Integer
   paise and deterministic largest-remainder allocation conserve total discount
   and component amounts without negative tiny lines. Delivery, tip and donation
   components remain outside commission. Existing customer prices are unchanged.
5. Admin allocation requires delivered status plus verified customer funding:
   COD cash reconciliation, a paid online Payment with matching captured amount
   and currency, or the existing completed wallet debit. A status alone is
   insufficient. Seller **net** is credited once to held; commission and tax go
   to separate accounts. Existing merchandise postings block a second posting.
   Quick Shiprocket fees remain separately paid obligations and are not deducted
   a second time from merchandise earnings.
6. Seller release requires verified funding, delivery timestamps, expired return
   holds and all non-rejected returns financially reconciled. Held net transfers
   to eligible using compensating entries. Reservation uses the existing seller
   payout path, fenced against concurrent reservations/refunds/disputes.
7. A completed Return refund can post item-level compensations using frozen
   amounts and cumulative returned quantities. Repeats are harmless; full returns
   exhaust the original allocation. Original entries remain intact. After payout,
   an uncovered refund becomes explicit held debt and blocks further settlement;
   it does not debit a wallet. Refund/snapshot rounding mismatches are quarantined
   for reconciliation rather than silently changing either financial history.

Posting is an explicit reviewed admin action in this release. No new settlement
scheduler or financial posting webhook is activated. Existing Razorpay capture,
signed webhook, refund recovery and Shiprocket guards remain authoritative.

## Delivery earning and payout workflow

* Existing assignment, rate snapshots, server-computed pickup/drop distance and
  customer OTP completion remain in use. Client payout amounts are not accepted.
  The existing distance rounding, one-kilometre floor and uncapped tip policy are
  retained. Rate ID and accepted breakdown are recorded with each new earning.
* For versioned orders, OTP completion posts one rider earning to **held**, within
  the existing Delivery/Order/partner transaction. Repeated completion cannot
  credit twice. Missing configured rate/distance evidence marks the Delivery
  `reconciliation_required` without fabricating an earning or blocking physical
  delivery. Zero-value deliveries retain an explicit zero-value state.
* Reviewed release checks verified funding, then transfers the earning held →
  eligible and updates existing partner counters in the same transaction. COD
  without verified cash cannot fund a release. Reassignment, failed deliveries
  and cancellations cannot credit through a completed-delivery event twice.
* Rider requests reserve only the lower of verified eligible ledger balance and
  the existing pending counter. The existing minimum withdrawal policy remains.
  Legacy pending counters alone cannot authorize a withdrawal. Request retries
  use partner-scoped keys; another pending request or excessive amount is rejected.
* A pending request can become completed only through admin reconciliation with
  explicit verified-transfer attestation, bank reference, reason, actor and time.
  Completion and rejection serialize transactionally and transfer the reservation
  exactly once. Rejection returns it to eligible. No provider transfer is created.
  Existing `pending/completed/rejected` rider states are retained; there is no
  fictional provider `processing` state for a transfer the application did not send.
* The old bulk "mark paid" operation fails closed and points to the request flow.
  Seller payout confirmation similarly requires evidence, with an audited reject
  operation to return its reservation. Existing seller `APPROVED` names the
  manually confirmed settlement; the matching ledger and reference are retained.

Delivery Rates now preserve base, distance rate, limits, effective date, enabled
state and reason. New saves default to drafts. Activating a new rider card also
requires an independently configured customer distance tariff in the existing
DeliveryChargeSetting. Once configured, customer distance prices read that tariff
and do not change when rider pay changes. Without a customer tariff, existing
pricing retains its original formula and new rider activation is blocked.
The existing flat customer charge form remains independent.

Rider payable and cash displays now come from persisted projections. Browser
`deliveryDebitWallet`, fake deposit success, locally credited payable balances
and cached daily financial totals no longer establish money. The old deposit
dialog links to actual order-level cash reports. Daily/weekly summaries without
server evidence remain unavailable; persisted per-delivery breakdowns are shown.

## COD workflow

`Expected → Collected report / remittance due → Remittance reported → Verified → Allocated`

`discrepancy` and `disputed` are blocking exception states. Payment status,
physical delivery, custody and settlement are separate records.

* Placement creates the existing pending COD Payment and freezes expected amount
  in the new order snapshot. Acceptance does not establish receipt. Existing COD
  eligibility, inventory and Shiprocket service-fee guards are preserved.
* The assigned approved rider reports cash against the exact order and current
  Delivery. Collection requires a verified OTP delivery and exact expected amount,
  cash method, reference and reason. Other riders, incorrect amounts, duplicate
  collections and changed replay evidence are rejected. A report records custody;
  it does not mark platform receipt or customer Payment paid.
* The rider reports handover reference and amount. An administrator independently
  verifies the actual amount received with evidence/reason. The reporter cannot
  verify their own handover. A client receipt button is not a platform receipt.
* Verified amounts post append-only receipt deltas. A shortage stays outstanding;
  an excess is a separate held liability, never commission or seller earnings.
  Correcting a verified total posts compensating receipt/excess entries rather
  than deleting earlier evidence. Rechecking the same amount does not double-post.
  No shortage write-off, excess appropriation or automatic cash netting is assumed.
* Only exact, verified funds allow allocation. A shared checkout Payment becomes
  paid only after every order linked through `groupRef` is verified and their
  total equals its authoritative amount. Individual verified order allocations
  remain traceable to their own snapshot/cash events.
* Admin disputes retain all evidence and block seller/rider withdrawals and payout
  completion. Reverification records the resolution without duplicating receipts.
  Custody can still be reconciled after an order enters a terminal lifecycle;
  money is not allocated to a cancelled order simply because cash was received.
* Failures/refusals without completed delivery cannot report collection or accrue
  new completed-delivery money. Returns/refunds use existing workflows, followed
  by source-backed compensations. Terminal-order cash, missing allocations,
  unreconciled returns, account mismatches, negative balances and duplicate event
  keys appear in reconciliation. There is no history deletion or silent correction.

## Admin and app instructions

Open **General Vendors → Financial → Finance Operations**:

* **Vendor commissions** saves real versioned backend configuration and history.
  Enter only approved values and tax treatment; scope IDs refer to existing
  Product/Category records. Prepare next version rather than editing history.
* **Commission history** lists versioned orders and their frozen line breakdowns.
  Allocation and seller/rider release actions enforce backend funding/hold checks.
* **COD reconciliation** supports order search, status/date filters, cash evidence,
  disputes and genuine filtered CSV export (up to 5,000 records per date window).
* **Ledger & accounts** shows account/bucket balances, paginated entries and
  reconciliation exceptions. Enter an authoritative completed Return ID to post
  reviewed refund compensation. The report states its order/rider coverage caps;
  an empty page is not proof that every historical account reconciles.
* **Rider payouts** shows actual persisted requests and reviewed completion or
  rejection. The existing rider-payout navigation opens this workflow.

Use existing **Delivery Rates** for draft base/per-km/limits/date changes. Explicit
activation remains blocked by release/tariff prerequisites. Independent customer
tariffs can be configured through the existing delivery-charge API after separate
customer-pricing approval; they are never copied automatically from rider pay.

Seller order detail displays frozen commission, allocated discounts, tax, net,
separate courier/service fees and ledger references. Seller earnings identifies
ledger accounts. Delivery Earnings displays COD obligations, evidence-report
forms, held/eligible/reserved/settled balances, accepted rates, distance, per-trip
calculations and transfer history. App Settings remains a placeholder and is not
the financial source of truth.

## API surface

Admin routes retain `protect + requireAdmin`. Rider routes retain approved-partner
and session checks. Seller routes retain approved seller/session/ownership checks.
Actor IDs come from authentication, never submitted form fields.

| Method and `/api` route | Operation |
| --- | --- |
| GET/POST `/admin/finance/commissions` | Read configuration/history; insert validated version |
| GET `/admin/finance/orders` | Paginated monitoring; `q`, `cod`, `status`, `from`, `to`, `partnerId`, `page`, `export=csv` |
| GET `/admin/finance/ledger` | Account/order filters and ledger balances |
| GET `/admin/finance/reconciliation` | Read-only exceptions, duplicates, negative balances |
| POST `/admin/finance/orders/:id/cod/verify` | Independent receipt verification / evidence correction |
| POST `/admin/finance/orders/:id/cod/dispute` | Record dispute and settlement hold |
| POST `/admin/finance/orders/:id/allocate` | Post delivered, funded merchandise into held accounts |
| POST `/admin/finance/orders/:id/release` | Release seller funds after all holds clear |
| POST `/admin/finance/orders/:id/release-rider` | Release funded rider earning |
| POST `/admin/finance/returns/:id/reverse` | Source-backed completed refund compensation |
| GET `/delivery/finances/cod` | Own COD orders and custody projection |
| GET `/delivery/finances/ledger` | Own rider ledger and bucket balances |
| GET `/delivery/finances/deliveries` | Own persisted delivery/rate/earning records |
| POST `/delivery/orders/:id/cod/collect` | Exact-amount evidenced collection report |
| POST `/delivery/orders/:id/cod/remit` | Evidenced handover report |
| POST `/delivery/payouts` | Verified balance reservation with Idempotency-Key |
| PATCH `/admin/delivery-payouts/:id/complete` or `/reject` | Atomic reviewed resolution |
| POST `/sellers/payouts` | Existing seller reservation, now scoped/idempotent/gated |
| PATCH `/admin/vendor-payouts/:id/settle` or `/reject` | Reviewed settlement / reservation release |
| GET `/sellers/orders/:id/financial-breakdown` | Owner-scoped frozen financial breakdown |
| POST `/admin/delivery-rates` | Draft or explicitly gated approved rate |
| POST `/admin/delivery-charge` | Existing flat setting; optional independently approved `distanceRates` |

Cash bodies: `{amount, reference, reason}` in INR; collection additionally requires
`method:"cash"`. Payout completion: `{verified:true, transactionRef, reason}`;
rejection: `{reason}`. Customer tariff extension: `{flatFee,
distanceRates:{quick:<approved per-km INR>,same_day:<approved per-km INR>},note}`.
No example financial values here are default business policies.

## Database changes

No new ledger collection. Existing models gain:

* Commission: version-2 rule fields, channel/product scope, explicit base/tax,
  version/parent, effective date, actor/reason and append-only guards.
* Order: immutable `financialSnapshot`; `financialRevision` concurrency fence;
  `financialPosting`; cumulative `financialReturnQuantities`; COD evidence and
  its current projection in `codFinance`.
* SellerLedgerEntry: account/partner/delivery/payment/delivery-payout dimensions
  and additional financial entry types. Seller ownership remains mandatory for
  seller-payable entries; partner ownership for rider-payable entries.
* Delivery: explicit financial earning state and financial rate version.
* DeliveryPartner: held/reserved counters and financial workflow version. Existing
  pending/paid/total are preserved; a verified ledger projection gates withdrawal.
* DeliveryPayout: workflow version, idempotency key and bank/reconciliation evidence.
  SellerPayout gains reconciliation reason; existing payout collections are reused.
* DeliveryRate gains finance version. DeliveryChargeSetting optionally stores
  independent customer distance rates; no rate or tax migration seeds them.

## Tests and exact results

All database financial tests use isolated MongoMemoryReplSet fixtures. Synthetic
rates/taxes/receipts are test data only. Existing Razorpay tests use provider stubs;
browser tests intercept API calls. No live provider test was run.

| Command | Result |
| --- | --- |
| `npm run test:fcm-auth --prefix backend` | **5 suites, 140 passed**, including **55 financial workflow tests** |
| `npm test --prefix backend -- --maxWorkers=2` | **60 suites: 56 passed, 4 failed. 809 tests: 792 passed, 10 failed, 7 skipped** |
| `node --test` with the 12 frontend files listed below | **168 passed, 0 failed** |
| Final affected frontend rerun: finance, socket and auth tests | **48 passed, 0 failed** |
| `npm run test:financial-browser --prefix forntend` | **12 checks passed**, 320/390/768/1440 px across admin, rider and seller; **0 browser application errors** |
| `npm run build --prefix backend` | Passed |
| `npm run build --prefix forntend` | Passed; existing large bundle warning remains |
| `git diff --check` | Passed |

Frontend regression command (run inside `forntend`):

```text
node --test tests/portal-startup.test.mjs tests/seller-notifications.test.mjs tests/socket-ui.test.mjs tests/checkout-ui.test.mjs tests/auth-role.test.mjs tests/service-ui.test.mjs tests/image-search-ui.test.mjs verification/razorpay-overlay.test.mjs verification/payment-ui.test.mjs verification/fcm-auth.test.mjs verification/shiprocket-fee-ui.test.mjs verification/financial-workflow-ui.test.mjs
```

Full-suite failures are deliberately not hidden or weakened:

* **Seven existing failures reproduced against unchanged HEAD application source
  with the existing local tests:** one wholesale catalog authentication expectation
  (`seller-payment.http`); three SMS mode tests failing on missing live Shiprocket
  environment configuration; three checkout notification mock expectations.
* **Three compatibility failures introduced by the required finance changes:**
  `admin-workflows.http` expects immediate live rider-rate writes without an audit
  reason, unrestricted bulk payout success, and commission inferred from delivered
  order lines. The new actual-database tests assert draft safety, verified request
  settlement and authoritative ledger reporting instead. These existing tests were
  left unchanged. Review/update those contracts under the release approval process;
  do not activate while treating the full suite as clean.

The first new financial run exposed a missing test Category fixture; it was fixed
without relaxing validation. The initial sandbox browser run timed out opening
Chrome's debug page. An isolated browser run outside the sandbox exposed a missing
delivery-session fixture; after correcting that fixture, all 12 checks passed.
Logs are in ignored `test-artifacts/finance`; browser results are in
`test-artifacts/mobile-native/finance-*.json`. The browser wrapper extends the
existing local layout runner; that runner and an installed Chrome are prerequisites.

## Staging, migration and rollout

1. Keep these defaults on every worker:

   ```text
   FINANCE_SNAPSHOTS_ENABLED=false
   FINANCE_OPERATIONS_ENABLED=false
   FINANCE_PAYOUTS_ENABLED=false
   FINANCE_POLICY_APPROVAL_REFERENCE=
   FINANCE_E2E_APPROVAL_REFERENCE=
   ```

   Both approval references and the relevant flag are required for money
   operations. Snapshotting is independently opt-in for new orders. Keep
   `QUICK_SHIPROCKET_SELLER_COLLECTION_ENABLED=false` and its DB configuration
   disabled until its separate release approvals are complete.
2. Obtain policy approval tied to the intended rule/rate revisions. Prepare only
   disabled drafts first. Approve commission scope/min/max/tax, discount funding,
   COD duties, manual bank verification, holds and returns before enabling anything.
3. Provision an isolated staging replica set or supported sharded transaction
   topology. Transaction failures never fall back to non-atomic writes. Do not
   assume standalone MongoDB supports this workflow.
4. With an explicitly approved staging `MONGO_URI`, run
   `node backend/scripts/prepareFinanceWorkflowIndexes.mjs` for a read-only
   duplicate/topology/index plan. Only after database approval, supply
   `FINANCE_INDEX_APPROVAL_REFERENCE` and `--apply`. It prepares additive indexes,
   never syncs/drops indexes or rewrites financial records. This tool has only been
   syntax-checked here; it was not run against any external database.
5. Test new checkout → seller acceptance → assignment → OTP delivery → collection
   report → handover report → independent verification → allocation → hold release
   → request → verified bank reconciliation. Use isolated provider accounts/stubs.
   Also test partial receipts/excess/disputes, grouped and concurrent orders,
   before/after-settlement returns, failed deliveries and denied tenant access.
6. Reconcile every component, source event and payout. Resolve the seven baseline
   failures and three changed test contracts appropriately. Review actual database
   indexes, cash verification evidence requirements, provider callbacks and process
   startup configuration. Record end-to-end approval before enabling staging money
   flags, and separately approve production activation/deployment.
7. Before any rider-rate activation, freeze independently approved customer tariffs
   and verify they are loaded on every API worker. Rate cache failure must not
   silently substitute newly changed rider pricing for customer pricing.
8. Rollback disables new operation/payout flags and, if necessary, snapshotting for
   future orders. Retain all captured snapshots, evidence, reservations and ledger
   entries; reconcile pending operations rather than deleting them.

## Remaining decisions and limits

### Seller earnings visibility correction — 21 October 2026

Seller finance summary now includes read-only delivered gross item sales, scoped
to the authenticated seller's items. Totals cover delivered orders; the detail
list shows the latest 20. Earnings displays these sales separately from ledger
balances, with snapshot/allocation status. Gross sales exclude no order-level
discounts, commission or refunds and do not authorize withdrawal. No historical
snapshots or ledger entries are created by this read.

Finance loading is centralized for Earnings, Payments and Money Request. Shared
portal requests apply a 10-second deadline and deduplicate concurrent reads.
Generation and session checks discard stale responses; account changes clear
financial state. Payment history exposes refresh and distinguishes failed reads
from an empty history. Delivery alone still does not create a payout request.

Validation: backend finance suite **56 passed**; four targeted seller UI/provider
checks passed (sales visibility, read error/retry, actual request timeout/retry,
and stale-session rejection). Frontend production build passed with the existing
bundle-size warning. The broader frontend run had **56 passed, 1 failed** before
the two provider tests were added: the existing admin commission save test expects
an immediate POST, while the current form opens a review step first. No admin
implementation or test expectation was changed for this seller correction.
No live order records were inspected or modified, and no deployment was run.

No live approval is implied by a form save or passing fixture tests. Still needed:

* Approved commission values, fixed scope/min/max/tax treatment and discount/coin
  funding; approved rider rates, timing and customer tariff separation.
* COD responsibility, custody location, handover evidence retention, verification
  duties, timetables and source-backed discrepancy resolution. Alternative digital
  collection, partial customer collection, zero-payable COD, shortage write-offs,
  excess disposal and automatic netting remain blocked.
* Policy for refund rounding exceptions, post-settlement receivables/debt recovery,
  legacy whole-order return adjustments, refunds of courier/service fees and taxes,
  and disputed cash discovered after a payout was already externally sent.
* Bonus/waiting/reverse-trip compensation and compensation for failed/cancelled
  trips have no approved policy and are not fabricated. No new scheduled payout
  automation is added. Digital/subscription settlement and historic cash/earnings
  reconstruction are not activated by this physical-order settlement release.
* No live bank/provider payout integration is added. Manual completion records a
  trusted admin's independently verified transfer; it cannot electronically verify
  a bank statement that the existing architecture does not integrate. That
  operational control requires approval and staging evidence.
* Reconciliation is paginated and bounded; inspect its stated coverage. It is not
  an assertion that provider statements, courier final invoices, legacy customer
  wallets and all historical orders already agree. Those remain release audits.

## Changed and new files

| Area | Files |
| --- | --- |
| Audit / delivery guide | `FINANCIAL_SYSTEM_AUDIT.md`, `FINANCIAL_WORKFLOW_IMPLEMENTATION.md` |
| New backend services | `backend/services/financeSafety.service.js`, `vendorCommission.service.js`, `orderFinance.service.js`, `deliveryPayout.service.js`, `financialReconciliation.service.js`, `sellerSettlementEligibility.service.js` |
| Extended backend services | `backend/services/sellerLedger.service.js`, `riderPay.service.js`, `pricing.service.js`, `deliveryCharge.service.js`, `return.service.js` |
| Controllers | New `backend/controllers/financeWorkflow.controller.js`; extended `admin.controller.js`, `adminSellerFinance.controller.js`, `sellerFinance.controller.js`, `deliveryPartner.controller.js` |
| Existing models | `backend/models/Commission.js`, `Order.js`, `SellerLedgerEntry.js`, `Delivery.js`, `DeliveryPartner.js`, `DeliveryPayout.js`, `SellerPayout.js`, `DeliveryRate.js`, `DeliveryChargeSetting.js` |
| Routes / operation configuration | `backend/routes/admin.routes.js`, `delivery.routes.js`, `backend/.env.example`, `backend/package.json` |
| Index preparation / tests | New `backend/scripts/prepareFinanceWorkflowIndexes.mjs`, `backend/verification/financial-workflow.test.js` |
| Admin UI | New `forntend/src/modules/Admin/components/FinanceWorkflowTab.jsx`, `FinanceWorkflow.css`; extended `DeliveryRatesTab.jsx`, `SellerLedgerAdminTab.jsx`, `LeftSidebar.jsx`, `forntend/src/modules/Admin/routes/index.jsx` |
| Seller UI | New `forntend/src/modules/Seller/components/OrderFinancialBreakdown.jsx`; extended `OrdersTab.jsx`, `EarningsTab.jsx` |
| Rider UI | New `forntend/src/modules/Delivery/components/DeliveryFinancePanel.jsx`, `DeliveryFinancePanel.css`; extended `DepositModal.jsx`, `forntend/src/modules/Delivery/context/DeliveryContext.jsx`, `forntend/src/modules/Delivery/pages/EarningsPage.jsx` |
| Frontend test commands / regressions | `forntend/package.json`; new `forntend/verification/financial-workflow-ui.test.mjs`, `financial-workflow-browser.mjs` |

**Production impact:** no production database, indexes, historical financial
records, real charges, refunds, payouts, live shipments or deployment were touched.
No production migration was run and no live financial flag was enabled. All
database mutations in validation were confined to ephemeral test replica sets.
