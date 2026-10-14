# Digital entitlement index rollout

No historical orders are backfilled and no payment or file records are rewritten.

Before application rollout, create and verify these additive indexes in staging:

```js
db.digitalentitlements.createIndex(
  { userId: 1, orderId: 1, productId: 1 },
  { unique: true, name: 'digital_entitlement_purchase_unique' }
)
db.digitalentitlements.createIndex({ userId: 1, createdAt: -1 })
db.digitaldownloadaudits.createIndex({ entitlementId: 1, downloadedAt: -1 })
db.digitaldownloadaudits.createIndex({ userId: 1, downloadedAt: -1 })
```

Dry run first:

1. Confirm both collections are absent or empty; this release does not backfill them.
2. Run `getIndexes()` and confirm no conflicting names or definitions.
3. Create the indexes on an isolated staging database.
4. Run duplicate Razorpay webhook and browser-verification fixtures and confirm one entitlement per user/order/product.
5. Deploy only after the private persistent volume and backups have also been verified.

Rollback removes only these new empty/additive indexes and collections after exporting
any created audit records. It must not alter `orders`, `payments`, `products`, or private files.
