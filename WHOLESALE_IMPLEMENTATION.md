# Wholesale implementation

## Confirmed business policy

On 2026-10-16 the project owner confirmed in this session:

- Any signed-in customer may purchase Wholesale; no separate business verification is required.
- Wholesale uses existing retail shipping, commission, COD, cancellation and refund rules.

Seller-session and delivery-session tokens cannot use Wholesale buyer operations, even when the account also has buyer membership. Wholesale seller approval remains independent of customer membership and the Services module.

## Architecture and supported flow

The existing seller request and admin decision flow is retained. Decisions require the current seller `version`; concurrent/stale updates return 409. Request and decision notifications use the existing notification service after persistence; notification failure does not undo a decision.

Products remain physical retail products with an optional per-variant Wholesale price book. There is no new wholesale-only product mode or digital/ebook wholesale support. Product edits preserve existing price books by stable variant identity. Prices do not have to be lower than retail prices; existing tier validation prohibits increasing unit prices at higher thresholds.

The customer catalog is `/wholesale`, details are `/wholesale/:productId`, and the separate cart and checkout are `/wholesale/cart`. The catalog supports page/limit, text/category filters and direct product lookup. MOQ-aware inventory availability and reachable starting prices use the same terms validation as the cart/checkout. Public retail serialization explicitly excludes wholesale and private digital fields.

The separate cart reuses `Cart`, with `channel: wholesale`. Existing user/channel uniqueness supports it without an index change. Wholesale quantities are whole variant units, from MOQ in configured increments, up to stock and a technical maximum of 100,000 units per line; carts support at most 100 variants. Retail keeps its existing 20-unit line limit. Wholesale is never merged into retail checkout or discounted by retail campaign prices. Existing grouped-checkout restrictions on coupons and Coins remain in force.

Checkout reuses fulfilment grouping, shared retail delivery pricing, transactional order/payment creation, inventory mutation, wallet handling and durable checkout idempotency. A server-issued quote hash prevents charging an unreviewed price/delivery change. Terms and eligibility are read again within the transaction; seller/customer document writes and inventory updates protect against concurrent suspension, deactivation and repricing.

Orders persist `salesChannel: wholesale` and an immutable line `wholesaleSnapshot` containing MOQ, increment, selected tier threshold and unit price. Existing line product/variant IDs, quantity, seller and price remain purchase-time snapshots. The existing `type` stays ecommerce/grocery so commission, delivery and returns keep their established routing. Legacy records default to retail when hydrated; no historical rows are rewritten.

Online payment reuses existing Razorpay initiation, server-side verification and signed webhooks. COD and wallet use existing grouped-checkout behavior. Failed online payments retain the existing retry/cancellation behavior. Seller acceptance, preparation, readiness and delivery selection use existing endpoints and ownership checks. No carrier capability is granted by wholesale approval.

## API additions and changes

- `GET/POST/DELETE /api/cart/wholesale`: customer-only quote, add, clear.
- `PUT/DELETE /api/cart/wholesale/:itemId`: customer-only quantity update/removal.
- `POST /api/orders/unified`: `purchaseMode: wholesale`, `quoteHash`, existing address/payment fields and Idempotency-Key. Retail remains the default.
- `GET /api/products/wholesale/catalog`: customer session, validated page/limit/q/category/productId.
- Admin wholesale decisions now require `version`, supplied by seller details/summary.
- Product create/edit/channel/stock and bulk upload require an approved seller; admin authorization retains existing behavior.

## Schema and operations

The Cart channel enum and additive Order fields change. The pre-staging fixes below also add Payment journal fields. No new production index or migration is required. Existing checkout transaction support and the already-required CheckoutAttempt unique index remain prerequisites. Local integration tests create their own disposable replica set and fixture indexes; no application database/index is inspected or changed.

Deploy backend and frontend together only through a separately authorized process. No deployment was performed. A rollback must retain new Wholesale carts, order classifications and snapshots. Older application code does not understand the new cart channel; do not delete or rewrite Wholesale financial/order data to make rollback possible. Disable new entry points operationally and retain compatible readers when designing a rollback.

## Verification scope and limitations

`backend/__tests__/api/wholesale.http.test.js` covers real MongoDB projections, authorization, catalog availability, terms, separate carts, transactions/rollback, retries, cancellation, seller decisions, manual fulfilment entry and Razorpay signatures/amounts with a mocked SDK. `forntend/scripts/wholesale-ui.test.mjs` exercises actual components/provider logic. `node scripts/mobile-layout.test.mjs --wholesale` checks production-artifact catalog/detail/cart/COD confirmation and reloads at 390px and 1280px using intercepted fixture APIs.

No live gateway, carrier shipment, production data, physical delivery or real-device test is claimed. Existing retail tax/financial behavior is reused, not expanded into a new tax-invoice policy. Catalog pagination and eligibility now execute in MongoDB; large-scale query performance was not benchmarked. Wholesale-specific bulk import/export and wholesale-only products are outside this implementation.

## Pre-staging financial, concurrency and resource fixes — 2026-10-16

The owner confirmed an application limit of **₹1,00,000 per checkout, including delivery and tip**. This is not a verified merchant/gateway limit. Item, subtotal, delivery and checkout aggregation use integer paise, then serialize two-decimal rupees into existing Number fields. Per-unit prices and subtotals must also fit that cap; sub-paise, non-finite, unsafe or over-limit values fail before inventory/payment creation. Wholesale retains the 100,000-unit line maximum and retail retains 20. Wallet balance mutations now round the existing balance to paise and add/subtract integer paise atomically; historical ledger rows are not rewritten. Existing coupons, commission and shipping policy remain; no new tax calculation is introduced.

Payment.gateway remains the legacy/current projection. Additive gatewayAttempts retain each issued Razorpay reference, originating order, expected paise and INR currency. At most 20 initialization attempts are allowed per Payment. An SDK outcome that cannot be confirmed is recorded as creation_unknown and returns 503. Initializing/creation_unknown attempts now atomically block another initialization until provider evidence resolves the attempt. External order creation and local persistence cannot be one MongoDB transaction; uncertain gateway outcomes still require operational reconciliation. See [Payment recovery operations](PAYMENT_RECOVERY_OPERATIONS.md) for the protected APIs and safe recovery procedure.

The first valid capture settles the original obligation once. Each distinct subsequent capture is recorded as refund_required with a separate pending refund obligation; it cannot fulfil, debit wallets or alter stock again. Captures for a failed attempt are also recorded as refund-required rather than resurrecting fulfilment after released Coins. Exact capture replay is idempotent. Historical pending/current references remain resolvable, and replay of a known historical paid reference does not invent an additional debt. Capture signatures, originating attempts, amounts, currency and browser verification remain checked server-side.

Cancellation and capture both write the Payment in their transaction. If cancellation wins, stock is restored once and later capture records the cancellation refund debt while the Order stays cancelled. If capture wins, cancellation records that debt. Refund obligations use CANCEL:<orderId>, CAPTURE:<gatewayPaymentId>, or RETURN:<returnId> and retain amount, INR, gateway IDs, reason and history alongside the Payment. Existing order refundPending/payment refund projections remain compatible representations of the same debt. Pending records are **not completed refunds**. Explicit admin processing now uses a shared atomic claim, provider-history checks, dispatch recording and independently verified results; uncertain outcomes remain blocked for reconciliation. Signed webhooks reconcile obligations and existing Return completion. There is no background refund worker or forced-success endpoint. See [Payment recovery operations](PAYMENT_RECOVERY_OPERATIONS.md) before using the bounded obligation/attempt queues and processing APIs.

Checkout cart clears increment __v, so a stale wholesale additive update must reload/recompute against the cleared cart. Idempotent checkout replay does not clear later additions. Both single retail and grouped retail/wholesale checkout now conditionally increment Seller/User eligibility versions inside the transaction. Seller suspension or underlying User deactivation winning first aborts/retries checkout and rolls back inventory, orders and payments. If checkout commits first, the historical order remains valid. These writes intentionally serialize checkout against lifecycle changes; purchases from the same seller can contend and must retain transaction retry behavior.

Public availability is a boolean-only aggregation with optional exact product/variant matching and early limit. Protected catalog eligibility/filtering/pagination execute in MongoDB, and only the requested page is hydrated in application memory. Availability is limited to 60 requests/IP/minute, protected catalog/quote to 120/customer/minute. Validated page <= 1000 and limit <= 100, literal search input, a 2-second database budget and disabled disk spill bound work; unscoped eligibility/count operations can still scan candidate rows. No cache or new index is introduced. MongoDB **5.2+** is now required for $sortArray in the eligibility aggregation; transaction support still requires a replica set. Verify the staging version and realistic query plans before rollout. These are functional resource controls, not a load-test result.

Deploy the compatible backend before accepting new payments through it; the existing frontend contract remains compatible. No production migration or index operation is required and old records stay readable. Rolling back to the former payment handler after new attempts/captures exist would again lose reconciliation of older references: retain journal-aware settlement/refund readers or disable new payment entry while preparing a forward fix. Never delete journals, obligations, carts or historical financial records to facilitate rollback. No deployment, live provider call or application-data mutation was performed during this work; database writes were confined to disposable test fixtures.

The final chat report records exact test/build commands, counts and encountered failures. Existing seller-promotion retirement work and the default grocery startup change are preserved.
