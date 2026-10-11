# Wholesale foundation (not storefront-enabled)

## Seller access

The persisted capability value is `wholesale`, but it is intentionally not in
the shared `CHANNELS` or `ORDER_TYPES` lists yet. Existing carts, orders,
catalog discovery, and checkout therefore continue to accept only their
current channels. Seller onboarding remains E-Commerce / Quick Commerce /
Hybrid; an already-approved seller requests Wholesale from the seller panel.
The request is stored as `wholesaleChannel.status = pending` and does not grant
access. An authenticated admin must approve it, which adds `wholesale` to
`salesChannels`. Rejection or revocation removes that active channel. Older
seller records need no migration: the optional request subdocument can remain
absent and existing sales-channel defaults are unchanged.

## Product pricing

Approved Wholesale sellers can submit an optional `wholesalePricing` schedule
on a product variant through the existing product create/update API. The
schedule has an MOQ, an allowed quantity increment, and ascending quantity
breakpoints with positive, non-increasing unit prices. The server validates
and resolves the applicable tier; the existing retail `price` and `mrp` are
not modified. The schedule remains hidden from ordinary product queries.

Approved sellers edit terms using `PATCH /api/products/:id/wholesale-pricing`;
the endpoint accepts variant IDs and terms only, and cannot write retail price
or stock. Seller product listing explicitly selects these hidden terms for the
seller UI.

An authenticated customer-only, read-only catalog is available at
`GET /api/products/wholesale/catalog`. Any signed-in customer may browse; no
GSTIN, company profile, business approval, or separate subscription is
required. It returns active/approved products belonging to active, approved
sellers with approved Wholesale access, and enabled variants using canonical
shared inventory. A product is listed when at least one configured offer is in
stock; its other enabled variants are also returned with explicit availability
so the detail view can label them out of stock. It returns server-normalized
MOQ, increments, and tiers. It exposes no cart or checkout action.

Admin moderation reuses the existing dedicated seller Wholesale approval and
the existing product active/approval controls. Suspending a product hides all
its channels; a separate variant-level Wholesale suspension workflow and
audit trail do not exist and were not added redundantly.

## Inventory and financial rollout

Use shared inventory across selling channels; do not add a second Wholesale
stock counter. The approved inventory contract is now: products without a
variants array use root `Product.stock`; products with variants use each
variant's stock, while root stock is only the sum projection for legacy
queries. Cart and order records now support variant identity/snapshots, and
single/unified checkout plus restoration paths share conditional transactional
inventory mutations. Stable identifiers and projection reconciliation require
the reviewed backfill in `backend/migrations/variant-inventory-rollout.md`.

Wholesale purchasing remains disabled in storefront and checkout. Before enabling it,
complete the database-backed inventory/concurrency rollout and review MOQ/tier
price application, payment, commission, refund, and settlement rules. Buyer
eligibility is decided: any authenticated customer is eligible to browse and
purchase once the purchasing safeguards are approved.
Checkout idempotency must continue binding the authenticated customer/key and
request details, including any future channel, variant, quantity, and resolved
wholesale tier price.

No database migration or index is required for these optional fields, and no
persistent database was accessed or modified for this foundation.
