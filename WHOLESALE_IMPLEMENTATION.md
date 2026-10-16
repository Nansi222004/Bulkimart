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

Only the Cart channel enum and additive Order fields change. No new production index or migration is required. Existing checkout transaction support and the already-required CheckoutAttempt unique index remain prerequisites. Local integration tests create their own disposable replica set and fixture indexes; no application database/index is inspected or changed.

Deploy backend and frontend together only through a separately authorized process. No deployment was performed. A rollback must retain new Wholesale carts, order classifications and snapshots. Older application code does not understand the new cart channel; do not delete or rewrite Wholesale financial/order data to make rollback possible. Disable new entry points operationally and retain compatible readers when designing a rollback.

## Verification scope and limitations

`backend/__tests__/api/wholesale.http.test.js` covers real MongoDB projections, authorization, catalog availability, terms, separate carts, transactions/rollback, retries, cancellation, seller decisions, manual fulfilment entry and Razorpay signatures/amounts with a mocked SDK. `forntend/scripts/wholesale-ui.test.mjs` exercises actual components/provider logic. `node scripts/mobile-layout.test.mjs --wholesale` checks production-artifact catalog/detail/cart/COD confirmation and reloads at 390px and 1280px using intercepted fixture APIs.

No live gateway, carrier shipment, production data, physical delivery or real-device test is claimed. Existing retail tax/financial behavior is reused, not expanded into a new tax-invoice policy. Catalog response pagination currently follows eligibility calculation over the existing catalog query; large-scale query performance was not benchmarked. Wholesale-specific bulk import/export and wholesale-only products are outside this implementation.

The final chat report records exact test/build commands, counts and encountered failures. Existing seller-promotion retirement work and the default grocery startup change are preserved.
