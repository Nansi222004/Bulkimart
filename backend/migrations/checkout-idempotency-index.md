# Checkout idempotency index rollout (not executed)

`CheckoutAttempt` declares a unique `{ userId: 1, key: 1 }` index named
`checkout_user_key_unique`, with Mongoose `autoIndex` disabled. The index is a
deployment prerequisite; do not release checkout code until the target Bulkimart
database has this index. This rollout has not been run by the test task.

## Preflight and apply

Use a separately approved maintenance window and an explicitly verified
Bulkimart-only URI. Do not use the Nhcone/source URI. Keep the URI in a protected
environment variable and never echo it. First verify `db.getName()` is exactly
`bulkimart`, the cluster host is the approved target cluster, and that the
collection contains no duplicate `(userId, key)` pairs:

```javascript
db.getName()
db.checkoutattempts.aggregate([
  { $group: { _id: { userId: '$userId', key: '$key' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $limit: 20 }
])
db.checkoutattempts.getIndexes()
```

If duplicates exist, stop and review each record; do not delete or merge them
automatically. Otherwise, after verifying the database/cluster and taking the
approved target backup, apply only this additive index:

```javascript
db.checkoutattempts.createIndex(
  { userId: 1, key: 1 },
  { unique: true, name: 'checkout_user_key_unique' }
)
```

Verify the named index with `getIndexes()` and then deploy the application code.
Do not create TTL expiry for completed attempts: a delayed retry must not become
a second order. A future retention policy requires a separate product decision.

## Rollback

If application rollback is necessary, first roll back to a version that does
not require `Idempotency-Key`; then drop only the new index:

```javascript
db.checkoutattempts.dropIndex('checkout_user_key_unique')
```

Retain the collection and all attempt documents. Do not drop the collection or
delete records as part of rollback. Removing the index removes the database
uniqueness guarantee, so do not keep the new checkout implementation active
afterward.
