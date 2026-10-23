# Admin Dashboard analytics implementation

Date: 2026-10-23. Local repository only. The three static chart panels are replaced by authenticated, API-driven all-time charts. Financial KPI definitions and calculations are unchanged. **No historical trend or recognized platform-revenue series is claimed.** Reports remains unchanged.

## Preflight and preserved work

The initial tree already contained the prior KPI implementation: modified `backend/controllers/admin.controller.js`, `backend/routes/admin.routes.js`, `forntend/src/modules/Admin/context/AdminContext.jsx`, `forntend/src/modules/Admin/pages/SuperAdminDashboard.jsx`, and untracked metric contracts/report, metrics controller/service, Dashboard validator and backend/frontend metric tests. These were preserved. Changes below extend that implementation; the full Git diff also contains the pre-existing KPI changes. No reset, revert, commit or overwrite of unrelated work was performed.

Graph tools were searched first as AGENTS.md requires, but none was exposed. Targeted source reads and `rg` were the fallback. Both metric documents and current implementation were inspected before changes. `ADMIN_DASHBOARD_CHART_CONTRACT.md` was written before backend/frontend implementation. It supplements the approved all-time metric contract; earlier reports describing placeholders remain historical records.

Inspected files (including relevant field/function sections where indicated):

- `ADMIN_DASHBOARD_METRIC_CONTRACT.md`, `ADMIN_DASHBOARD_FINANCIAL_METRICS_FIX_REPORT.md`.
- `backend/controllers/admin.controller.js` (overview), `backend/controllers/adminDashboardMetrics.controller.js`, `backend/services/adminDashboardMetrics.service.js`, `backend/routes/admin.routes.js`.
- `backend/constants/enums.js`, `backend/models/Order.js`, `backend/models/Payment.js`, `backend/models/Return.js`, `backend/models/SellerLedgerEntry.js`, `backend/controllers/payment.controller.js` (capture event timestamp references).
- `backend/middlewares/auth.middleware.js`, `backend/middlewares/financePermission.middleware.js`, `backend/middlewares/error.middleware.js`, `backend/utils/response.js`.
- `forntend/src/modules/Admin/pages/SuperAdminDashboard.jsx`, `forntend/src/modules/Admin/context/AdminContext.jsx`, `forntend/src/modules/Admin/utils/dashboardRead.js`, `forntend/src/modules/Admin/SuperAdmin.css`, `forntend/src/modules/Admin/components/OverviewTab.jsx` (existing chart placeholder search).
- `forntend/src/utils/adminApi.js`, `forntend/src/utils/portalRequests.js`, `forntend/src/utils/socket.js`, `forntend/package.json`, `forntend/vite.config.js`.
- `backend/package.json`, `backend/scripts/checkServicePackage.mjs`, `backend/verification/run-shopping-capacity-tests.mjs`, `backend/verification/jest.config.js`, `backend/verification/env.js`, `backend/verification/admin-dashboard-metrics.test.js`.
- `forntend/verification/admin-dashboard-ui.test.mjs`, `forntend/verification/componentHarness.mjs`, `forntend/tests/mobile-layout.test.mjs`, `forntend/verification/seller-earnings-audit-browser.mjs`, `forntend/verification/financial-workflow-browser.mjs` (isolated browser conventions).

## Implemented charts and contracts

| Panel | Real source and displayed measure | Boundaries |
| --- | --- | --- |
| Revenue Overview | Existing protected financial snapshot response. Horizontal comparison of complete gross completed order value and net verified external collections; INR labels convert integer paise exactly once. | All-time, separate non-additive measures. Incomplete totals have no bar, retain explicit coverage and verified-record subtotal. Recognized platform revenue remains unavailable. Net posted merchandise commission subtotal is separately labelled accounting context, never a recognized-revenue bar. |
| Orders Performance | New operational aggregation of every distinct Order by **current** canonical status. | All statuses included; unknown/missing/legacy values retained as Unknown / Unattributed. No creation/delivery event counts, time buckets, payment inference or invented success rate. |
| Orders by Channel | Same operational aggregation, grouped by stored `Order.type`. | ecommerce → E-Commerce; grocery → Quick Commerce; subscription → Subscription, from current ORDER_TYPES. Other/missing values → Unknown / Unattributed. `salesChannel` retail/wholesale counts are a separate note, not extra channel slices. No payment joins or financial data. |

The financial source continues to use validated canonical `Order.pricing.totalAmount` for status delivered only. Discounts are already reflected; customer delivery/tip/donation stay in gross original order value. Subsequent item refunds do not alter this gross sales measure. Money collected remains verified settled capture journals once per Payment, net verified completed refunds, plus independently verified exact COD receipts net evidenced manual refunds; wallet/internal transfers and non-order purposes are excluded. Shared Payments cannot multiply capture totals. Missing legacy evidence blocks a complete amount. Commission uses existing posted v2 commission-account credits less compensating debits, not current rule recalculation. No financial formula, commission rate, tax policy or entitlement changed.

Status labels cover placed, confirmed, preparing, dispatched, out_for_delivery, delivered, cancelled, return_requested, returned and refunded. `type: shg`, `qcommerce`, `wholesale` or any unknown value is not silently converted to a current type. A missing `salesChannel` is unknown, even though new Order writes default to retail; aggregation does not manufacture defaults for old documents.

All three charts preserve all-time scope and Asia/Kolkata. `asOf` is observation time. The operational observation is separate from the financial snapshot and existing overview. No date filters are added. The operational endpoint rejects query parameters with400 to avoid an implied unsupported filter.

## Connection map and API contract

```text
SuperAdminDashboard → FinancialOverviewChart
  ← AdminContext.fetchDashboardOverview → existing adminGet + readDashboardFinance
  ← GET /api/admin/dashboard/financial-metrics
  ← protect + requireAdmin + explicit requireFinancePermission(manage_finance)
  ← adminDashboardMetrics.controller.getDashboardFinancialMetrics
  ← adminDashboardMetrics.service.getAdminFinancialMetrics
  ← read-only snapshot: Order + Payment journals + Return + SellerLedgerEntry

SuperAdminDashboard → OrderAnalyticsCharts → adminGet + readDashboardOrderAnalytics
  → GET /api/admin/dashboard/order-analytics
  → protect + requireAdmin (no finance permission needed for counts)
  → adminDashboardMetrics.controller.getDashboardOrderAnalytics
  → adminDashboardAnalytics.service.getAdminOrderAnalytics
  → Order $project(status,type,salesChannel) + one $facet
  → validated status / channel / sales-channel distributions → DashboardBars
```

No duplicate financial endpoint/query was added. The existing KPI request supplies the financial chart too. One operational request supplies both operational panels. The operational standard response is:

```text
{success:true,data:{version:1,scope:'all-time',timezone:'Asia/Kolkata',
 unit:'orders',measure:'fulfilment-orders',asOf:ISO,
 totalOrders:nonnegative-safe-integer,
 statuses:[{key,count}],channels:[{key,count}],salesChannels:[{key,count}]}}
```

Only observed positive groups are returned in deterministic order. Empty source returns total0 and three empty arrays. Each distribution must equal totalOrders, with unique allowed keys and safe integer counts. Backend and frontend reject malformed/disagreeing structures. MongoDB aggregation has a10-second maxTimeMS budget; database failure is not converted into an empty response. Both Dashboard metrics-controller responses now use Cache-Control no-store.

## UI states, privacy and accessibility

- Loading is explicit; genuine operational empty data has its own message. Valid financial zero retains a zero label and zero-length bar.
- Incomplete financial evidence has no total/bar; its subtotal and evidence counts are labelled. Financial403/API/malformed responses remain unavailable with Retry, without breaking operational charts.
- Operational failures use generic text and Retry. Refresh removes previous observations; abort, request generations, unmount cleanup and Admin session-change handling prevent older responses restoring stale data. Existing financial-context generation safeguards are reused.
- Operational responses contain aggregate enums/counts/timestamps only. No Order/Payment/seller IDs, customer contact information, raw journals, bank details or ledger rows are added to either chart response. No finance permission was granted or broadened.
- No suitable chart package was installed. Semantic HTML bars reuse the existing layout and aqua-blue/orange accents without adding a dependency. Figures have accessible names/captions, exact labels/numbers and native per-bar tooltips. Color is supplementary. Labels wrap; cards use natural height and scoped CSS, not the old160px placeholder container.

## Exact files modified in this task

| File | Change |
| --- | --- |
| `ADMIN_DASHBOARD_CHART_CONTRACT.md` (new) | Definitions, response/privacy rules, unsupported-series decisions, written before implementation. |
| `backend/services/adminDashboardAnalytics.service.js` (new) | Bounded-cardinality, all-time Order status/type/sales-channel aggregate and server contract checks. |
| `backend/controllers/adminDashboardMetrics.controller.js` (existing untracked KPI file extended) | Operational handler; no-store for both read responses; unsupported operational filters rejected. |
| `backend/routes/admin.routes.js` | Add existing-Admin-guarded `/dashboard/order-analytics`; preserve explicit finance permission on metrics route. |
| `backend/verification/admin-dashboard-metrics.test.js` (existing untracked KPI file extended) | Six additional integration tests: status/type attribution, empty/errors, malformed aggregate, authorization and snapshot failure without fallback. Existing financial evidence tests retained. |
| `forntend/src/modules/Admin/utils/dashboardRead.js` (existing untracked KPI file extended) | Versioned operational response validation and canonical display labels. Existing financial validator unchanged. |
| `forntend/src/modules/Admin/components/DashboardCharts.jsx` (new) | Reusable bars, financial comparison and operational request/state integration. |
| `forntend/src/modules/Admin/components/DashboardCharts.css` (new) | Chart-scoped responsive labels/bars/buttons/focus/forced-color support. |
| `forntend/src/modules/Admin/pages/SuperAdminDashboard.jsx` | Replace the three static placeholder panels with chart components; preserve prior KPI work. |
| `forntend/verification/admin-dashboard-charts.test.mjs` (new) | Eight frontend contract/component/state tests using controlled fetch. |
| `forntend/verification/admin-dashboard-charts-browser.mjs` (new) | Isolated production-artifact browser checks, six response scenarios across seven widths. |
| `ADMIN_DASHBOARD_ANALYTICS_IMPLEMENTATION_REPORT.md` (new) | This report. |

The existing financial service, AdminContext, Admin overview controller, approved KPI metric contract, other portals, permissions, accounting models and Reports code were not edited by this task. Generated screenshots/geometry are under `test-artifacts/admin-dashboard-charts/` and are test evidence, not application data.

## Actual verification

The backend runner was inspected: it strips developer database/provider/deployment environment and tests create their own MongoMemoryReplSet. Database fixture writes are exclusively isolated test writes. Frontend tests mock fetch. Browser tests use an ephemeral profile, copied local production artifact and intercepted API responses at every origin; external resources are blocked. No real authentication token or provider is used.

| Directory and exact command | Observed result |
| --- | --- |
| Backend: `node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --silent --runTestsByPath verification/admin-dashboard-metrics.test.js` | Final focused run: **22 passed,0 failed**. |
| Frontend: `node --test verification/admin-dashboard-charts.test.mjs verification/admin-dashboard-ui.test.mjs` | **15 passed,0 failed**. |
| Backend: `node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --silent --runTestsByPath verification/admin-dashboard-metrics.test.js verification/financial-workflow.test.js` | **2 suites,111 tests passed,0 failed**. Includes existing capture/refund deduplication, shared Payments, COD, wallet exclusion, invalid pricing, net commission versus taxes/payables, financial operations/authorization and new non-atomic-fallback regression. |
| Frontend: `node --test verification/admin-dashboard-charts.test.mjs verification/admin-dashboard-ui.test.mjs verification/finance-center-ui.test.mjs verification/financial-workflow-ui.test.mjs` | **71 passed,0 failed**. |
| Frontend: `npm run build` | Passed. Existing >500kB chunk warning remains; main JS about1,922kB uncompressed. No dependency added. |
| Backend: `npm run build` | Passed: index syntax and backend-only service-package/shared-limit import checks. |
| Frontend: `node verification/admin-dashboard-charts-browser.mjs` | Approved retry outside process sandbox: **42 checks,0 failures,0 runtime exceptions** at320,360,375,390,430,768,1440px. Six scenarios: populated, empty/zero, incomplete collections, API failure, malformed success and finance403 with operational data still available. Page/card/label overflow checks passed. |
| Root: `git -c core.safecrlf=false diff --check` | Passed; informational LF/CRLF notices. Tracked diff and new chart/controller/service files reviewed. |

Counts overlap between focused and regression commands; do not add them. The initial focused backend run passed20 and failed2 because my new raw Order fixtures omitted unique orderNo values. Fixtures were corrected; schema indexes/assertions were not weakened. The first sandboxed browser attempt failed while connecting the Chrome debugging WebSocket, before page assertions. The approved isolated retry passed all42. The existing browser fixture produces background Admin notification-console diagnostics for unpopulated endpoints; these are not chart failures, and no real notification endpoint was contacted. Concurrent frontend Vite harnesses emitted the existing24678 port warning without test failures.

Tests cover no fallback when snapshot transactions fail, explicit manage_finance403, non-Admin403, unauthenticated401, no sensitive aggregate fields, and non-mutation of source financial/Order fixtures. They establish the local implementation against controlled records, not current production counts or banking truth. Full repository suites, real bank/provider acceptance and production-volume load tests were not run. Screenshot inspection included desktop and mobile shell; browser geometry checks cover the chart labels/cards even below the mobile fold.

## Unsupported series, performance and release gates

1. **No recognized-revenue series:** platform-wide recognition timing, fee domains and consolidation remain unapproved. Posted merchandise commission is only a labelled subtotal. Do not relabel sales/collections as recognized revenue.
2. **No historical date series:** Order.timeline.timestamp/item.deliveredAt, capture.receivedAt, refund.processedAt/verifiedAt, Return.refundedAt and COD events represent different events and may be missing for legacy records. There is no approved chart date attribution/coverage contract, and this task preserves all-time scope without date buckets. A createdAt-based financial trend would be unjustified. Future temporal series need separate approval, coverage disclosure and refund/cash attribution tests.
3. **Historical evidence:** missing captures, pricing, financial snapshots, postings, refund compensation or independently verified COD receipts remain unresolved by design. No backfill or historical repricing ran. Unknown channel/status groups are operational disclosure, not repaired records.
4. **Performance:** the new Order facet scans projected all-time Orders with bounded output and10-second database budget. Financial reads retain existing all-time joins/cursors/global receipt deduplication and snapshot transaction lifetime costs. Inspect query plans and load-test staging volumes. Required replica-set/sharded snapshot support and existing proposed index review remain rollout gates; no indexes were created.
5. **Access/rollout:** verify existing deployed manage_finance assignments through authorized access review; no grants made. Coordinate API/frontend versions so enum/schema mismatches fail visibly. Validate real staging latency, screen-reader/keyboard behavior and current evidence coverage. Browser fixtures do not establish a real MongoDB-backed browser session end to end; real isolated HTTP and browser contracts are tested separately.
6. **Reports future work:** leave `/admin/reports` persistence/toast-only actions unchanged. Define report types and generation/persistence, scoped permissions (manage_finance for finance), date/event semantics, coverage, pagination, export authorization/audit and CSV safety in a separate task. No report jobs/exports were added here.
7. **Rollback:** revert only these scoped code additions in a coordinated release if needed; no financial data rollback or compensating posting is necessary because this task performed read-only application operations. Preserve pre-existing uncommitted KPI work.

**Readiness:** implemented and safely validated locally, conditional on staging data/access/performance review. No production database/provider connection, financial mutation, migration/index creation, reconciliation mutation, deployment, push, commit, production configuration change or permission grant occurred. Only isolated test fixtures and local build/test artifacts were written.
