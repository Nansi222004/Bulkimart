# Variant identity and inventory rollout (not executed)

## Contract

- A product with no `variants` array uses `Product.stock` as canonical inventory.
- A product with variants uses each `variants[n].stock` as canonical inventory.
- For variant products, root `Product.stock` is a compatibility projection equal to the sum of variant stock. It is never deducted as an additional pool.
- Variant retail price/MRP/SKU/name/attributes are snapshotted at checkout. No Wholesale checkout is enabled by this work.
- Historical order lines without `variantId` remain readable. Since the pre-change root stock mirrored variant zero, cancellation/return restoration maps those legacy lines to the first variant. Review this assumption against the target's historical product editing practices before rollout.

## Required rollout order

1. Take and verify an approved target Bulkimart backup. Do not use the Nhcone source URI.
2. Run a read-only inventory audit and `planVariantIdBackfill` against the verified target. Review invalid/duplicate variant IDs and every `rootStock != sum(variant.stock)` discrepancy. The script reports these and never chooses a stock correction implicitly.
3. Resolve duplicate/invalid IDs manually; the migration intentionally stops on them. If root discrepancies are reviewed and approved, explicitly opt into root projection reconciliation with `--sync-stock-projection`; otherwise the script refuses to write any IDs while discrepancies remain.
4. Run `backfill-product-variant-ids.mjs --apply` using `BULKIMART_MIGRATION_URI` for the exact target cluster and database. Add `--sync-stock-projection` only after approving the discrepancy report. The script is idempotent: it writes only missing IDs and only approved root projections. It does not change variant stock, prices, SKUs, or other product data.
5. Verify every variant has a unique ObjectId and each root stock equals the variant sum before deploying APIs that require variant IDs.

The script refuses a URI unless the host is `cluster0.q39nutg.mongodb.net` and database is exactly `bulkimart`, then verifies the live connection identity. It does not print the URI. It has not been executed in this task.

## Rollback

Do not remove IDs after carts/orders start referencing them. Roll back application code while retaining identifiers and the root projection. Reverting a projection to a previous value would make compatibility reads wrong; any rollback needs a reviewed reconciliation, not a blind reversal.

## Concurrency and indexes

Inventory mutations use MongoDB conditional updates inside existing checkout/cancellation/return transactions; MongoDB transaction conflict/retry behavior is the cross-process concurrency guarantee. Mock tests do not prove this. No new database index is required for variant identity because IDs are unique within each product array and the product ID scopes them. The existing CheckoutAttempt `{ userId, key }` unique index remains a separate deployment prerequisite documented in `checkout-idempotency-index.md`; no index was inspected or changed here.
