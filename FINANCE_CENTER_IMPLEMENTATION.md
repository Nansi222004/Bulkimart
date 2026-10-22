# Unified Finance Center

Implemented 21 October 2026. This is a UI consolidation of the existing staging
financial workflow, not approval to activate production money operations.
Read [the financial architecture audit](FINANCIAL_SYSTEM_AUDIT.md) and
[the financial workflow release guide](FINANCIAL_WORKFLOW_IMPLEMENTATION.md)
for ledger, provider, deployment and business-policy prerequisites.

## Inspection and scope

The admin uses `AdminContext` to derive a tab from the first URL segment and
`routes/index.jsx` to render it inside the existing admin session gate. The sidebar
changes its groups according to that tab. Finance Operations previously combined
commission configuration and order/COD/ledger/rider-payout activity. Delivery Rates
combined rider rates and a flat customer-charge editor. Quick 3P combined fee
configuration/history with seller fee-payment monitoring. Seller ledger and payout
screens already use their own authoritative APIs and reviewed settlement dialogs.
App Settings had no working general-settings implementation.

Some finance routes were absent from the sidebar's contextual section checks,
causing a switch to unrelated sidebar groups. The center now has one persistent
Finance Center link across all contextual groups; legacy financial links highlight
that destination. Operational vendor sales and unrelated administration remain
reachable. No screenshots were attached to this session; implementation was based
on the actual route/components/API contracts. The requested code-review graph tools
were unavailable, so inspection used the filesystem fallback.

No backend service, financial calculation, permission, feature flag, schema,
provider integration or endpoint was changed for this UI task. Existing workspace
changes from the financial workflow and other ongoing seller work were preserved.

## Navigation and use

Open `/admin/finance-center`. Area and section selection are reflected in query
parameters, for example `/admin/finance-center?area=settings&view=charges`.
Refresh and browser back/forward preserve valid selections; invalid selections
fall back safely.

| Area | Sections |
| --- | --- |
| Financial Settings | Vendor Commission; Delivery Partner Rates; Customer Delivery Charges; Shiprocket Service Fees; supported tax/settlement policy information |
| Vendor Finance | Frozen order commission history and actions; seller ledger earnings; seller payouts; Shiprocket fee payments |
| Delivery Finance | Rider-payable ledger earnings and bucket totals; rider payout requests; existing rider rule editor |
| COD and Reconciliation | Cash collection/remittance/dispute verification; ledger accounts, exceptions and source-backed refund compensation |

Legacy URLs remain compatible wrappers: `/admin/app-settings`,
`/admin/finance-operations`, `/admin/quick-third-party-settings`,
`/admin/delivery-rates`, `/admin/vendor-earnings`, `/admin/vendor-payouts`,
`/admin/payouts`, `/admin/delivery-earnings` and `/admin/rider-payouts`.
App Settings explicitly identifies its financial compatibility role; unrelated
application settings are not represented as implemented.

Configuration uses the existing GET/POST `/api/admin/finance/commissions`,
GET/POST `/api/admin/delivery-rates`, GET/POST `/api/admin/delivery-charge`, and
GET/PATCH `/api/admin/quick-commerce-third-party-config`. The center embeds
existing seller ledger/payout and financial-operation components. Shiprocket
configuration and payment monitoring use separate views of the same component.
There is no new configuration store or API.

Enter approved amounts, effective times and audit reasons, expand advanced options
for tax, limits and scope, then review the summary before confirming persistence.
Errors retain the entered values and show the backend response. Histories retain
the server's version, time, actor and reason where supported. INR and percentage
fields start blank when no approved persisted configuration exists. Existing
runtime fallback amounts are not copied into editable approved-rate fields.

The following backend distinctions are deliberately visible:

* Commission saves create effective versions, **not independent drafts**. A
  disabled successor supersedes the same scope at its effective date; a less
  specific approved rule can still apply. Enabled versions affect only future
  snapshots when snapshotting is enabled. Postings retain their separate gates.
* Rider rate saves default to inactive drafts and preserve current active rates.
  Activation still requires server approvals and independent customer tariffs.
  Supported modes remain Quick Commerce and Same-Day. No unsupported E-Commerce
  rate, bonus, waiting-time or failed-trip compensation is fabricated.
* Customer tariff changes apply immediately through the existing API. There is
  **no draft or future scheduling capability** for customer pricing. Flat-only
  saves preserve existing distance rates. Changing distance rates requires
  explicit selection and the existing backend approval gates. Rider rates are
  never copied. Free-shipping coupon behavior remains unchanged.
* Shiprocket saves replace the current configuration; disabled configuration is
  not a separate draft store. Enabling remains subject to every server release
  prerequisite and `QUICK_SHIPROCKET_SELLER_COLLECTION_ENABLED`. Verified seller
  prepayment remains required; the editor cannot turn it off. UTC is explicit.
  Option B freight offset, fee base, tax and revenue distinctions are explained.
* The commission sample calculator is a browser simulation for one order item
  using an administrator-entered allocated discount. It creates no order,
  customer payment or ledger entry. Server calculations remain authoritative.
* General tax, settlement schedules, shortage write-offs and other unsupported
  policies have informational status only, with no fictional save action.

COD configuration explanations are separate from verification actions. Physical
delivery, rider custody reports, independently verified platform receipt and
allocation remain distinct. Existing payout evidence dialogs, held/reserved
balances, refund controls, permissions and financial release gates remain intact.
The rider earning account view identifies partner/order/delivery references and
labels its balances as combined account totals rather than individual balances.

## Files changed for this UI task

New:

* `forntend/src/modules/Admin/components/FinanceCenter.jsx`
* `forntend/src/modules/Admin/components/FinanceCenter.css`
* `forntend/src/modules/Admin/components/FinanceReview.jsx`
* `forntend/src/modules/Admin/components/CommissionSimulation.jsx`
* `forntend/verification/finance-center-ui.test.mjs`
* `FINANCE_CENTER_IMPLEMENTATION.md`

Extended/reused:

* `forntend/src/modules/Admin/components/FinanceWorkflowTab.jsx`
* `forntend/src/modules/Admin/components/DeliveryRatesTab.jsx`
* `forntend/src/modules/Admin/components/QuickThirdPartySettingsTab.jsx`
* `forntend/src/modules/Admin/components/LeftSidebar.jsx`
* `forntend/src/modules/Admin/routes/index.jsx`
* `forntend/package.json` (`test:finance-center`)
* `forntend/verification/financial-workflow-ui.test.mjs` (explicit review assertion
  before the existing save/rejection assertions; unrelated added tests retained)
* `forntend/verification/financial-workflow-browser.mjs`

`SellerLedgerAdminTab.jsx` is embedded without changing its existing evidence
collection and reviewed settlement/rejection operations in this UI task.

## Verification

Configuration tests execute actual component handlers against intercepted API
responses. They cover persisted values including zero, successful save/reload,
backend errors, review-before-write, disabled saves, API separation, history,
legacy navigation, sidebar visibility, URL state and simulation cases. They do
not claim to replace staging end-to-end verification against an approved database.
Existing database financial tests use isolated MongoMemoryReplSet fixtures;
browser checks use mocked local APIs and a temporary Chrome profile.

Final results on this workspace:

| Command | Exact result |
| --- | --- |
| Inside `forntend`: `node --test verification/finance-center-ui.test.mjs verification/financial-workflow-ui.test.mjs` | **27 passed, 0 failed**, including 16 new Finance Center tests |
| Full frontend regression command below | **190 passed, 0 failed** |
| `npm run test:financial-browser --prefix forntend` | **64 checks passed, 0 failed**, at 320/390/768/1440 px; **0 browser application errors**, no page overflow |
| `npm run test:fcm-auth --prefix backend` | **5 suites passed; 141 passed, 0 failed** |
| `npm test --prefix backend -- --maxWorkers=2` | **60 suites: 56 passed, 4 failed. 809 tests: 792 passed, 10 failed, 7 skipped** |
| `npm run build --prefix backend` | Passed |
| `npm run build --prefix forntend` | Passed; existing large-bundle warning remains |
| `git -c core.safecrlf=false diff --check` | Passed |

Full frontend command, run inside `forntend`:

```text
node --test tests/portal-startup.test.mjs tests/seller-notifications.test.mjs tests/socket-ui.test.mjs tests/checkout-ui.test.mjs tests/auth-role.test.mjs tests/service-ui.test.mjs tests/image-search-ui.test.mjs verification/razorpay-overlay.test.mjs verification/payment-ui.test.mjs verification/fcm-auth.test.mjs verification/shiprocket-fee-ui.test.mjs verification/financial-workflow-ui.test.mjs verification/finance-center-ui.test.mjs
```

The 10 full-backend failures match the previously documented financial-workflow
release result: one wholesale catalog authentication expectation; three SMS mode
tests missing live Shiprocket environment configuration; three checkout
notification-mock expectations; and three admin contracts expecting immediate
unaudited rider-rate activation, unrestricted bulk payout completion and inferred
commission reporting from delivered orders. This UI task changes none of those
backend contracts. No assertions were weakened or tests removed. The existing
commission save test now asserts that review causes **no write**, then explicitly
confirms before retaining its original payload and backend-error assertions.

An initial component run exposed a composed-label test selector and a missing
return to editing after commission save rejection; both were corrected. An
accidental frontend test invocation from the repository root could not resolve
Vite's `/src` imports; final runs used `forntend` as their working directory.
The initial browser selector included the sidebar currency icon in its text
comparison; it was corrected to inspect the navigation title. Final browser runs
include expanded advanced options, persisted tariff fixtures, configuration and
operational views, all three primary compatibility routes, and seller/rider
financial regressions. Logs are in ignored `test-artifacts/finance/finance-center-*`;
browser reports are in `test-artifacts/mobile-native/finance-center-*.json`.

Before release, use an approved staging replica set and approved test policies to
repeat real configuration round trips and the existing checkout, COD handover,
independent receipt verification, allocation, reservation and bank-reconciliation
sequence. Confirm each role is denied unauthorized APIs and compare every saved
version with the database. Fixture tests do not constitute those operational
approvals. No real provider or external database was used here.

## Release limits and production impact

No new migration or index preparation is needed for this UI consolidation. Keep
all existing financial flags and approval references in their previously approved
state; no flag was enabled here. Deploy only after reviewing the existing backend
suite failures and financial policy/staging blockers documented in the financial
workflow guide. The existing frontend bundle-size warning remains.

Still unresolved: approved commission/rider/fee/tax values; customer tariff
approval; COD custody, independent cash/bank evidence and discrepancy policies;
refund/return settlement decisions; general policy APIs; and Shiprocket's separate
release requirements. This UI does not approve or implement those business rules.

No production database, indexes, historical snapshots, ledgers, live charges,
deductions, refunds, payouts, shipments or deployments were touched. No external
database migration was run. Test monetary values are synthetic fixtures only.
