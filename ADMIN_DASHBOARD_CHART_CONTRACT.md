# Admin Dashboard chart contract v1

Written before chart implementation, 2026-10-23. Local development only. The approved all-time KPI contract is unchanged. No date filters, daily buckets, accounting policy, financial records or permissions are changed.

## Revenue Overview: all-time financial comparison, not a trend

Reuse `GET /api/admin/dashboard/financial-metrics`, authenticated Admin plus explicit `manage_finance`. Its existing service reads Order, Payment, Return and commission ledger projections in a read-only snapshot transaction. Chart only complete `orderValue.amountPaise` and `collections.amountPaise` as separately labelled bars. Both are integer paise, converted to INR once for display. These are different measures, never stacked or summed. A valid zero renders a labelled zero; incomplete/unavailable values have no bar and show coverage and a separately labelled verified-record subtotal. Exclusions, refunds, shared Payments, COD, wallet and currency validation remain exactly those in `ADMIN_DASHBOARD_METRIC_CONTRACT.md`.

Recognized Bulkimart revenue has no series. Its existing blocker and net posted merchandise commission subtotal are displayed separately as accounting context, including incomplete-ledger warnings; the subtotal is neither recognized revenue nor an additional bar to combine with collections.

No historical time series is implemented. Order timeline timestamps/item deliveredAt, Payment capture receivedAt, refund processedAt/verifiedAt and COD event timestamps exist, but are different events; legacy records can lack evidence/timestamps. There is no approved date attribution contract (capture versus provider settlement, completion versus creation, refund recognition) or platform-wide revenue recognition contract. The current task explicitly preserves all-time scope and forbids introducing date buckets. Using createdAt for every financial event would change the meaning. `asOf` is the observation timestamp, never a historical revenue event date. Unsupported historical and recognized-revenue series remain explicitly unavailable.

## Orders Performance: current status distribution

`GET /api/admin/dashboard/order-analytics` under existing authenticated Admin authorization. Count every distinct fulfilment Order once, including unpaid, cancelled, returned, refunded and in-progress documents. Group current `Order.status` against `ORDER_STATUSES`: placed, confirmed, preparing, dispatched, out_for_delivery, delivered, cancelled, return_requested, returned, refunded. All other values (including absent/legacy values) group as `unknown`, labelled Unknown / Unattributed. This is not a creation/delivery trend, success rate or payment metric. Shared Payment references do not affect Order counts. All-time; no event timestamps or date buckets.

## Orders by Channel: stored Order.type distribution

Same operational response, one aggregate `$facet` for status, type, salesChannel and total. `Order.type` is authoritative: ecommerce = E-Commerce, grocery = Quick Commerce, subscription = Subscription. These are the current `ORDER_TYPES`. Missing/unrecognized values (including legacy qcommerce/shg/wholesale if stored as type) remain Unknown / Unattributed; they are not guessed or silently reassigned. `salesChannel` is independent (retail/wholesale); its separate counts appear in a clearly labelled note, not as additional type slices. No Payment join, financial values, seller grouping or customer details.

## Operational response and states

Standard `{success:true,data}` envelope. Data: `{version:1, scope:'all-time', timezone:'Asia/Kolkata', unit:'orders', measure:'fulfilment-orders', asOf: ISO observation timestamp, totalOrders: nonnegative safe integer, statuses:[{key,count}], channels:[{key,count}], salesChannels:[{key,count}]}`. Only observed positive-count groups are returned, in deterministic order; empty database returns zero and three empty arrays. Each distribution must sum exactly to totalOrders. Keys come only from the canonical enums plus unknown, counts must be safe integers, duplicate keys are invalid. Backend and frontend validate this contract. Query filters are rejected, rather than silently changing scope.

The endpoint projects only status/type/salesChannel; bounded group cardinality, no identifiers, amounts, contact data, journals or bank information. Ten-second MongoDB aggregation budget; database/timeouts are errors, never a successful empty response. Operational observation is separate from the financial snapshot and overview request. Cache-Control no-store. One operational request supplies both panels. Refresh clears prior values, generation guards and abort/session handling reject stale responses, failures show Retry and genuine empty data is distinct. Financial failures/403 remain independent from operational charts.

## Rendering and rollout limits

No chart dependency is installed; package inspection found no existing supported chart library. Reusable semantic HTML horizontal bars avoid extra bundle weight, wrap long labels on narrow screens, expose exact text values, per-bar native tooltips and accessible figure titles/descriptions. Aqua-blue and orange retain Admin branding; labels and numbers convey meaning without color. A zero-length bar retains its zero label.

All-time operational scans and existing financial snapshot joins require deployment-volume query/transaction testing. No indexes/migrations, live database/provider reads or financial mutations are part of this work. MongoDB transaction failure must fail financial reads closed without fallback. Reports remains frontend-only/toast-driven and is not modified. Future Reports and temporal analytics need separate approved contracts, scoped authorization, persistence/export decisions, coverage and timestamp attribution.
