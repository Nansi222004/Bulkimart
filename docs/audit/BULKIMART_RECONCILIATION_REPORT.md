# Bulkimart — Reconciliation Report

Audit date 2026-11-04 · commit `76e6bc8`.

> **Status: not executed against data.** This audit had no database access. Nothing below is a claim about production balances. The queries are **read-only** `mongosh` aggregations. Run them on a secondary or replica, or on a restored backup, not on the primary during peak hours. All amounts are compared in integer paise (`round(x*100)`).

## 1. Reconciliation formulas mapped to the data model

| # | Check | Formula (must hold) | Collections / fields |
|---|---|---|---|
| R-1 | Wallet integrity (F-001) | Every wallet credit has a verified source: Razorpay top-up, return refund, cancellation refund, or admin adjustment with a reason. **No `DEV_TOPUP:` keys.** | `walletledgers.idempotencyKey`, `type`, `referenceType` |
| R-2 | Order payable vs payment | Σ `orders.pricing.totalAmount` over `paymentId` == `payments.amount` | `orders`, `payments` |
| R-3 | Gateway capture vs payment | `payments.captures[disposition='settled'].amountPaise` == `payments.amount×100` for `status ∈ {paid, partial_refund, refunded}` and method `online` | `payments.captures` |
| R-4 | Extra captures | Every `captures[disposition='refund_required']` has a `refundObligations[key='CAPTURE:<id>']` | `payments` |
| R-5 | Snapshot conservation | `Σ lines.eligiblePaise + components.(delivery+sellerIncentive+tip+donation+codFee)` == `financialSnapshot.expectedPaise` == `pricing.totalAmount×100` | `orders.financialSnapshot` |
| R-6 | Orders without usable commission | Count of `financialSnapshot.state='held_missing_rule'` or `financialSnapshotError` present | `orders` |
| R-7 | Seller gross / commission / net | Per line: `grossPaise − commissionPaise − taxPaise − tcsPaise − tdsPaise == netPaise` | `orders.financialSnapshot.lines` |
| R-8 | Posted net vs snapshot | Σ ledger `order_earning` credits for an order == Σ snapshot `netPaise` | `sellerledgerentries`, `orders` |
| R-9 | Seller balance buckets | `held + eligible + reserved + settled` (seller_payable) ≥ 0 per bucket, except documented held debt; `reserved` == Σ PENDING `sellerpayouts.amount` | `sellerledgerentries`, `sellerpayouts` |
| R-10 | Payout vs settlement entries | Every `sellerpayouts.status='APPROVED'` has exactly one `PAYOUT:<id>:SETTLED` and one `SETTLE_OUT` entry with equal amount; `transactionRef` unique | `sellerpayouts`, `sellerledgerentries`, `seller_payout_receipts` |
| R-11 | Refund vs gateway | `returns.refundAmount` (online) == processed refund obligation `amountPaise/100`; Σ refunds ≤ captured | `returns`, `payments.refundObligations` |
| R-12 | COD order vs rider collection | `codFinance.collectedPaise` ≤ rounded due; `verifiedPaise + writtenOffPaise == rounded due` when `status ∈ {verified, allocated}` | `orders.codFinance` |
| R-13 | Rider earnings | `deliveries.partnerEarnings` == ledger `DELIVERY:<id>:EARNING` amount; `deliverypartners.earnings.held/pending` == ledger buckets | `deliveries`, `sellerledgerentries`, `deliverypartners` |
| R-14 | Unpaid online orders (F-004) | `status='placed'`, method `online`, payment `pending/failed`, age > 1h → stock and coupons held | `orders`, `payments` |
| R-15 | Pending cancellation refunds (F-006) | `refundObligations.status` not `processed` with age > 24h | `payments` |

## 2. Read-only queries

```javascript
// R-1  Self-issued "dev" wallet credits (F-001) — run FIRST
db.walletledgers.aggregate([
  { $match: { $or: [ { idempotencyKey: /^DEV_TOPUP:/ }, { referenceId: /^DEV-/ }, { description: /Dev Mode Instant Wallet/ } ] } },
  { $group: { _id: "$userId", credits: { $sum: 1 }, amount: { $sum: "$amount" }, first: { $min: "$createdAt" }, last: { $max: "$createdAt" } } },
  { $sort: { amount: -1 } }
])

// R-2  Order payable vs payment amount
db.orders.aggregate([
  { $group: { _id: "$paymentId", ordersPaise: { $sum: { $round: [{ $multiply: ["$pricing.totalAmount", 100] }, 0] } } } },
  { $lookup: { from: "payments", localField: "_id", foreignField: "_id", as: "p" } },
  { $unwind: "$p" },
  { $project: { ordersPaise: 1, paymentPaise: { $round: [{ $multiply: ["$p.amount", 100] }, 0] }, method: "$p.method", status: "$p.status" } },
  { $match: { $expr: { $ne: ["$ordersPaise", "$paymentPaise"] } } }
])

// R-3  Paid online payments without a matching settled capture
db.payments.find({ method: "online", status: { $in: ["paid","partial_refund","refunded"] },
  $expr: { $not: { $anyElementTrue: { $map: { input: { $ifNull: ["$captures", []] }, as: "c",
    in: { $and: [ { $eq: ["$$c.disposition","settled"] }, { $eq: ["$$c.amountPaise", { $round: [{ $multiply: ["$amount",100] },0] }] } ] } } } } }
}, { _id: 1, amount: 1, status: 1, "gateway.orderId": 1 })

// R-6  Orders that cannot be posted to the seller ledger
db.orders.aggregate([
  { $match: { $or: [ { "financialSnapshot.state": "held_missing_rule" }, { financialSnapshotError: { $exists: true } }, { financialSnapshot: { $exists: false } } ] } },
  { $group: { _id: { state: "$financialSnapshot.state", err: "$financialSnapshotError.message", status: "$status" }, n: { $sum: 1 } } }
])

// R-8  Posted seller net vs frozen snapshot net, per order
db.sellerledgerentries.aggregate([
  { $match: { account: "seller_payable", type: "order_earning", direction: "credit" } },
  { $group: { _id: "$orderId", postedPaise: { $sum: { $round: [{ $multiply: ["$amount",100] },0] } } } },
  { $lookup: { from: "orders", localField: "_id", foreignField: "_id", as: "o" } }, { $unwind: "$o" },
  { $project: { postedPaise: 1, snapPaise: { $sum: "$o.financialSnapshot.lines.netPaise" } } },
  { $match: { $expr: { $ne: ["$postedPaise", "$snapPaise"] } } }
])

// R-9  Seller bucket balances (negative or reserved mismatch)
db.sellerledgerentries.aggregate([
  { $match: { $or: [ { account: "seller_payable" }, { account: { $exists: false } } ] } },
  { $group: { _id: { s: "$sellerId", b: "$bucket" }, paise: { $sum: { $cond: [ { $eq: ["$direction","credit"] },
      { $round: [{ $multiply: ["$amount",100] },0] }, { $multiply: [ { $round: [{ $multiply: ["$amount",100] },0] }, -1 ] } ] } } } },
  { $match: { paise: { $lt: 0 } } }
])

// R-10 Approved payouts without exactly one settlement pair
db.sellerpayouts.aggregate([
  { $match: { status: "APPROVED" } },
  { $lookup: { from: "sellerledgerentries", let: { id: "$_id" }, pipeline: [ { $match: { $expr: { $and: [ { $eq: ["$payoutId","$$id"] }, { $eq: ["$type","payout_settlement"] } ] } } } ], as: "e" } },
  { $match: { $expr: { $ne: [ { $size: "$e" }, 2 ] } } }
])

// R-14 Unpaid online orders holding stock (F-004)
db.orders.aggregate([
  { $match: { status: "placed", paymentMethod: "online", createdAt: { $lt: new Date(Date.now() - 3600e3) } } },
  { $lookup: { from: "payments", localField: "paymentId", foreignField: "_id", as: "p" } }, { $unwind: "$p" },
  { $match: { "p.status": { $in: ["pending","failed"] } } },
  { $group: { _id: "$p.status", orders: { $sum: 1 }, units: { $sum: { $sum: "$items.qty" } }, withCoupon: { $sum: { $cond: [ { $ifNull: ["$coupon", false] }, 1, 0 ] } } } }
])

// R-15 Ageing unprocessed refund obligations (F-006)
db.payments.aggregate([
  { $unwind: "$refundObligations" },
  { $match: { "refundObligations.status": { $ne: "processed" } } },
  { $project: { key: "$refundObligations.key", status: "$refundObligations.status", amount: { $divide: ["$refundObligations.amountPaise", 100] }, createdAt: "$refundObligations.createdAt" } },
  { $sort: { createdAt: 1 } }
])
```

The existing read-only scripts in `backend/scripts/` complement these. They were not run in this audit:

- `auditPayoutReadOnly.mjs`
- `auditSellerEarningsReadOnly.mjs`
- `auditSellerDashboardReadOnly.mjs`
- `financeGapReconciliationDryRun.mjs`
- `historicalFinanceDryRun.mjs`

The admin endpoint `/api/admin/finance/reconciliation` (`financialReconciliation.service.js`) is the in-app equivalent.

## 3. Scenario matrix (Phase 13)

Expected results are derived independently from the code formulas in the financial audit. "Existing coverage" names automated tests already in the repository. **No new fixtures were executed in this audit.**

| # | Scenario | Expected result (from code) | Existing coverage | Gap / finding |
|---|---|---|---|---|
| 1 | Successful prepaid order | Payment `paid`; capture journal 1 settled row; order stays `placed` until seller accepts | `__tests__/api/razorpay-webhook.http.test.js`, `services/razorpay.service.test.js` | — |
| 2 | Failed payment | Payment `failed`, order `placed`, retry allowed (≤ 20 attempts) | razorpay tests | F-004: never auto-released |
| 3 | Duplicate webhook | No second fulfilment; same capture id → no-op | razorpay-webhook test | — |
| 4 | COD order | Payable = total + COD fee; payment `pending` until cash verified | `verification/financial-workflow.test.js` | — |
| 5 | COD correct amount | `collect` = rounded due → `verify` by another actor → payment `paid`, codFinance `verified/allocated` | financial-workflow | F-012 residual not booked |
| 6 | COD mismatched amount | `discrepancy`, shortage = due − verified; write-off equals shortage | financial-workflow | — |
| 7 | Seller commission | `net = gross − comm − commTax − TCS − TDS` | `verification/finance-gaps.test.js` | — |
| 8 | GST-inclusive price | `taxable = round(gross×100/(100+r))`, `gst = gross − taxable` | `services/financial-integrity.test.js` | Tax policy needs CA review |
| 9 | GST-exclusive price | **Rejected at checkout** (409) by design | — | Design choice |
| 10 | Coupon | Discount ≤ eligible subtotal; allocated proportionally; seller paid on gross | `verification/coupon-redemption.test.js` | — |
| 11 | Bank offer | **Not implemented** (no bank-offer logic found) | — | Missing feature |
| 12 | COD charges | Fee on (total − tip), cap and min applied, GST on fee | financial-workflow | — |
| 13 | Delivery charges | Distance × admin rate (≥ 1 km) or flat | quick-commerce tests | — |
| 14 | Easy Returns | Unit price + extra charge, inside GST-inclusive gross | — | F-018 policy |
| 15 | Cancelled order (online, paid) | Stock and coupon restored; refund obligation `CANCEL:<orderId>` queued | checkout-workflow (failing, see application report §6) | F-006 manual execution |
| 16 | Full refund | Σ refunds == captured; payment `refunded` | return tests | — |
| 17 | Partial refund | Per-quantity cumulative allocation; GST residual | `services/return-compatibility.test.js` | — |
| 18 | Return after delivery | Line held until window closes; reversal posted after refund | financial-workflow | — |
| 19 | Exchange, higher price | **Not implemented** | — | F-016 |
| 20 | Exchange, lower price | **Not implemented** | — | F-016 |
| 21 | Seller settlement | eligible → reserved → settled; unique UTR | financial-workflow | F-002 auth |
| 22 | Duplicate seller settlement | 409 / idempotent replay | financial-workflow | — |
| 23 | Rider settlement | Reserved request → verified completion | `verification/admin-delivery-ops.test.js` | — |
| 24 | Duplicate rider settlement | Legacy bulk settle disabled; idempotent per request | — | — |
| 25 | Failed payout | Reject returns reserved → eligible; **no path after APPROVED** | — | F-020 |
| 26 | Settlement during return window | Blocked: line stays `held` | financial-workflow | — |
| 27 | Refund after settlement | Reversal debits eligible up to available balance; remainder held debt blocks further payouts | financial-workflow | — |
| 28 | Commission reversal after return | Proportional commission, tax, TCS and TDS debits | finance-gaps | — |
| 29 | GST reversal after refund | `refundProductGst` proportional | financial-integrity | — |
| 30 | Multiple sellers, one customer order | Unified checkout creates one order per fulfilment group with a shared Payment; single-store `createOrder` rejects multi-seller carts | `seller-first-checkout.http.test.js` | `createUnifiedOrder` not deeply audited |

## 4. Mismatches, missing records, duplicates, unexplained balances

None can be reported, because no data was accessible. Run R-1 first: any row returned is direct evidence of F-001 exploitation and should be handled as an incident.
