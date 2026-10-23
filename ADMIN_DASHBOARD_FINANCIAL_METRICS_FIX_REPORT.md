# Admin Dashboard financial metrics and connectivity fix

Implementation: 2026-10-23. Scope: Admin Dashboard only and its read-only backend integrations. Initial Git status was clean. No resets, commits, deployment, production connection, live financial operation, migration, index apply or permission grant was performed. Graph tools were sought first but were unavailable; targeted source searches were used.

## Actual changes

- Removed the broken `Order.payment.totalAmount` Dashboard revenue calculation. The deprecated `revenue` response property remains present as null; it is not aliased to a different financial meaning.
- Added three separate cards using the definitions written **before** aggregation in `ADMIN_DASHBOARD_METRIC_CONTRACT.md`.
- Corrected Recent Orders to validated `pricing.totalAmount` in rupees, including valid zero. Invalid/missing amounts remain null and render unavailable. The label is explicitly “Order amount.” Buyer identities/contact details are no longer populated for this widget; the existing response property contains “Customer.”
- Approved sellers and pending sellers are separate values from the same overview response. The card no longer adds badge counts or overrides approved sellers with a second definition.
- Added a dedicated financial aggregate endpoint guarded by existing Admin authentication and explicit `manage_finance`; the operational overview retains existing authorization. No financial record IDs, provider journals, bank details or seller ledger rows are exposed.
- Added separate loading, overview error, financial unavailable and incomplete-coverage states. Refresh clears old values; request generations prevent an older response replacing a newer read. Missing/malformed successful responses do not become zero. Error messages shown by Dashboard are generic; authentication handling remains in the existing API utility.
- Left charts, Reports, theme/CSS and Customer/Seller/Delivery business workflows unchanged.

## Metric definitions and boundaries

All financial API amounts are safe integer **paise**; the UI converts once to INR. Existing rupee amounts are validated through `moneyPaise`. All-time scope; Asia/Kolkata business timezone; no date range or time buckets. Financial reads use a read-only snapshot transaction, primary read preference and streamed projections. The observation timestamp is displayed. Operational counts come from a separate request and are not claimed to share that financial snapshot.

| Card | Calculation | Exclusions and financial limitations |
| --- | --- | --- |
| Total Order Value | Valid `pricing.totalAmount` summed once per Order with status exactly `delivered` | Gross original amount for currently completed orders, before subsequent **item** refunds. Discounts are already reflected; delivery/tip/donation remain included. Cancelled/returned/refunded whole-order statuses and in-progress Orders excluded. A delivered unpaid order can contribute sales value but not verified collections. No seller ledger adjustment is silently substituted into its original customer price. Missing pricing makes the total incomplete, with a separately labelled valid-record subtotal. |
| Money Collected | Settled online capture journal once per Payment, less unique processed/verified refund obligations; independently verified COD receipt per Order, less evidenced completed manual COD refunds | Wallet payments are internal transfers and excluded. Top-ups and non-order purposes—advertising, parcel/legal, subscriptions, seller services/promotions, packaging and Quick fee collections—are outside this order metric. Payment/order ownership, shared-order totals and capture INR amount must agree. Duplicate exact journal IDs count once; conflicts or cross-Payment reuse invalidate coverage. Merely paid/legacy metadata is insufficient. Pending/failed attempts without captures do not count. A cancellation does not erase already captured cash: it remains until a verified refund. Pending refunds are not cash movement. Fully refunded verified payments net to zero. This is not proof of payment-provider bank settlement. |
| Bulkimart Revenue | **Unavailable**, with a separately labelled net posted merchandise commission subtotal | There is no approved platform-wide recognition/fee-consolidation definition. Current commission allocation, often in held accounting buckets, cannot be advertised as recognized total platform revenue. Subtotal sums INR `commission_revenue` credits minus debits for original `order-finance-v2` commission and reversal postings. It excludes seller/rider payable, tax, merchandise gross, customer delivery, COD custody, Quick fee obligations and payout transfers. Legacy/unrecognized sources and missing original postings are disclosed. No current rate is applied retrospectively; no commission rule/version or recognition policy was changed. |

Historical delivered COD without receipt evidence makes collection coverage incomplete. Unfulfilled unverified COD is excluded. Wallet transfers remain excluded rather than being counted as external funding a second time. A delivered Order missing a linked/matching Payment or linked to another payment purpose also makes coverage incomplete.

`amountPaise: null` means unavailable/incomplete, never zero. A verified subtotal is explicitly a subtotal; it is not an authoritative platform-wide total. `excludedRecords` and `incompleteRecords` describe evidence coverage and may include related Order and Payment issues; they are not unique customer counts. Platform revenue stays unavailable even for an empty ledger.

## Connection map

```text
SuperAdminDashboard
  → AdminContext.fetchDashboardOverview
    → GET /api/admin/dashboard/overview
      → admin.controller.getDashboardOverview
        → Order canonical pricing / counts + Seller approved/pending + existing widgets
    → GET /api/admin/dashboard/financial-metrics
      → protect + requireAdmin + requireFinancePermission(manage_finance)
      → adminDashboardMetrics.controller
      → adminDashboardMetrics.service (read-only snapshot)
        → Order pricing/status and payment association
        → Payment capture/refund journals + linked Orders/Returns
        → Order.codFinance receipt events + Return manual refund evidence
        → SellerLedgerEntry commission account (posted subtotal only)
    → dashboardRead validators → distinct cards and coverage/error states
```

Calculations do not import server startup, run a financial mutation service, call payment providers, trigger COD verification or create accounting records. The existing ledger is reused strictly as a read source. No new MongoDB collection or accounting architecture was introduced.

## Exact files changed

| File | Reason |
| --- | --- |
| `backend/controllers/admin.controller.js` | Canonical Recent Orders amounts; approved/pending seller definitions; remove incorrect legacy revenue sum and unnecessary customer population. |
| `backend/routes/admin.routes.js` | Register one permission-scoped read-only metrics route. |
| `backend/controllers/adminDashboardMetrics.controller.js` (new) | Standard response envelope for the metrics service. |
| `backend/services/adminDashboardMetrics.service.js` (new) | Snapshot reads, financial definitions, journal deduplication, purpose/ownership checks, precision and historical coverage. |
| `forntend/src/modules/Admin/context/AdminContext.jsx` | Fetch operational/financial data independently, validate, preserve errors and prevent stale response publication. |
| `forntend/src/modules/Admin/pages/SuperAdminDashboard.jsx` | Three distinct KPI cards, canonical order amount labels, consistent sellers, refresh and unavailable/error states. No chart implementation. |
| `forntend/src/modules/Admin/utils/dashboardRead.js` (new) | Dashboard-specific response validation and currency formatting. Shared Admin API compatibility behavior remains unchanged. |
| `backend/verification/admin-dashboard-metrics.test.js` (new) | Pure calculation and isolated replica-set authenticated HTTP tests; verifies reads do not mutate source records. |
| `forntend/verification/admin-dashboard-ui.test.mjs` (new) | Actual Dashboard/context and response-contract tests with controlled fetch. |
| `ADMIN_DASHBOARD_METRIC_CONTRACT.md` (new) | Definitions, inclusion/exclusion rules, accounting blocker and deployment prerequisites. |
| `ADMIN_DASHBOARD_FINANCIAL_METRICS_FIX_REPORT.md` (new) | This report. |

## Tests and actual results

The existing sanitized backend runner, Jest configuration and setup were inspected before execution. It drops application database/provider/deployment variables and uses test setup. New database tests start their own `MongoMemoryReplSet`; fixture inserts/deletes affect only that isolated database. They never invoke a real payment/provider or operational financial handler. The broader existing finance suite also runs against its isolated replica set. Frontend tests intercept fetch; the actual AdminProvider fixture has no session token and does not open a real socket.

| Directory / exact command | Result |
| --- | --- |
| Backend: `node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --silent --runTestsByPath verification/admin-dashboard-metrics.test.js` | Final focused run: **16 passed, 0 failed**. Covers canonical completed sales, excluded statuses, capture/refund evidence, duplicate IDs, shared Payments, wallet exclusion, COD verification/manual refunds, integer precision, commission versus other accounts, missing/orphaned evidence, zero, API failure and401/403 authorization. |
| Backend: `node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --silent --runTestsByPath verification/admin-dashboard-metrics.test.js verification/financial-workflow.test.js` | **2 suites passed; 103 tests passed; 0 failed** at that run. It included14 Dashboard tests; two further Dashboard tests were subsequently added and passed in the focused16 run. Totals overlap; do not add them. |
| Frontend: `node --test verification/admin-dashboard-ui.test.mjs` | **7 passed, 0 failed**. |
| Frontend: `node --test verification/admin-dashboard-ui.test.mjs verification/finance-center-ui.test.mjs verification/financial-workflow-ui.test.mjs` | **63 passed, 0 failed**. Includes loading/error/incomplete/empty/zero behavior, actual context retries/stale generations, finance contract errors, seller definition and canonical amount display. |
| Frontend: `npm run build` | Passed. Existing >500kB bundle warning remains. |
| Backend: `npm run build` | Passed: index syntax and backend service-package import/shared limits check. |
| Root/backend: `git -c core.safecrlf=false diff --check` | Passed. Diff reviewed: only the listed tracked Dashboard/controller/route changes plus new scoped files. |

Early focused failures were isolated fixture errors: missing distinct seller user IDs and missing unique ledger entry numbers. Fixture identities were corrected without weakening assertions or application validation. All final focused assertions passed. Concurrent Vite test servers emitted the existing port24678 warning without a failed test.

No required selected test was blocked. Full repository suites, browser rendering, real provider/bank acceptance, production database contents, deployed authorization state and production-volume performance were not tested. Build success is not evidence of those behaviors. No claim is made that current production values equal the fixture results.

## Charts and Reports — intentionally unchanged

| Feature | Current implementation | Future work |
| --- | --- | --- |
| Revenue Overview | Static “No revenue trend data available.” JSX | Proposed permission-scoped `/api/admin/dashboard/financial-trends`; approved revenue recognition, separate sales/collections series, refund attribution, explicit Asia/Kolkata date buckets and coverage. No recognized revenue series until policy exists. |
| Orders Performance | Static empty-state JSX | Proposed `/api/admin/dashboard/order-performance`; documented creation versus delivery event dates, statuses, date filters, zero buckets and retry/schema handling. Operational counts under Admin authorization; financial breakdowns require `manage_finance`. |
| Orders by Channel | Static empty-state JSX | Proposed `/api/admin/dashboard/orders-by-channel`; canonical order type versus salesChannel definitions, distinct fulfilment Orders and explicit unknown channels; no Payment duplication. Financial values require finance permission. |
| `/admin/reports` | `SectionModuleTab` with `data: []`; Add, export, update/delete are toast-only | Dedicated report product definition first: generated on demand versus persisted jobs, report-level permissions, same metric contracts, pagination/filtering, genuine CSV generation, formula escaping, evidence coverage and export audit trail. No fake records or download actions added. |

These endpoints are proposals only; none was registered or invoked by this phase.

## Rollout prerequisites and remaining limitations

1. Obtain accounting approval for recognized platform revenue, recognition date, platform fee coverage and reversal policy. Until implemented and tested, retain the unavailable card and distinct commission subtotal; never relabel allocation as recognized revenue.
2. Review gross completed-order definition with reporting owners. Subsequent item refunds do not reduce that **gross** measure; collections are separately net of verified refunds. Whole-order terminal statuses are excluded. Taxes/delivery/tips/donations are not platform revenue merely because they appear in customer totals.
3. Independently reconcile historical online capture journals, COD custody and completed refund evidence. No legacy data was fixed, credited or retroactively repriced. Missing evidence produces incomplete coverage.
4. Require MongoDB5+ lookup support and a transaction-capable deployment. Unsupported snapshot transactions must surface unavailable metrics, not a non-atomic fallback. Verify `orders.paymentId`, Return order, and commission-account query indexes through a separate approved preflight; no index was created here.
5. Load-test the all-time snapshot scans and join plans at deployment volume. Cursors avoid loading all records into application arrays, but joins, global receipt-ID sets and transaction lifetime still grow with data. Use approved monitoring/time budgets and consider an audited reporting projection later if needed; do not silently cap totals.
6. Confirm `manage_finance` assignments through an authorized access review. No role/permission was granted. Verify ordinary Admins receive403 for finance metrics while operational overview remains available.
7. Coordinate frontend/backend rollout: new frontend requires the new versioned financial contract and `pendingSellers`; legacy `revenue` is intentionally null. Incompatible deployments display unavailable data, not invented zero.
8. Validate real deployed/browser behavior, snapshot observation labels and response privacy in staging before release. Review shared API clients only if other consumers are discovered; no broad utility/auth changes were made here.

**Readiness:** safe implementation and isolated validation completed; production readiness is conditional on accounting policy, historical evidence, deployment/index/performance and access-review gates. No deployment or production financial operation was performed.
