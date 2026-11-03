# Bulkimart — Financial Audit

Audit date 2026-11-04 · commit `76e6bc8` · read-only. Finding IDs match [BULKIMART_COMPLETE_SYSTEM_AUDIT.md](BULKIMART_COMPLETE_SYSTEM_AUDIT.md).

Every formula below was read from the code path that persists the value, not from a UI. "Correct in code" means the implementation is internally consistent and conserves money. It does **not** mean production data has been reconciled; no database access was available.

---

## A. Order pricing (checkout)

**Path:** `POST /api/orders` → [order.controller.js `createOrder` :298](../../backend/controllers/order.controller.js#L298) → [pricing.service.js `priceOrder` :47](../../backend/services/pricing.service.js#L47)

| Step | Formula in code | Location |
|---|---|---|
| Unit price | `inventory.price × (1 − campaign%/100)` rounded to 2 dp, plus the Easy Returns extra charge per unit | `order.controller.js:401,414`; `easyReturns.service.js:98` |
| Line gross | `round(price × qty)` in paise (`lineMoney`) | `productGst.service.js:51` |
| Subtotal | Σ line gross (paise) | `pricing.service.js:53` |
| Coupon | `min(coupon discount, subtotal)`; % coupons capped by `maxDiscount`; scope by seller and category; evaluated server-side from the **code only** | `pricing.service.js:57`, `coupon.service.js:43-140` |
| Delivery | distance × admin rate (min 1 km) or flat fallback; 0 when there is a free-shipping coupon or an empty cart | `pricing.service.js:71-90` |
| Same-day | `standardFee + sameDayFee + sameDayIncentive` (coupon does not waive it) | `pricing.service.js:114-122` |
| Tip | server-validated preset | `order.controller.js:525` |
| Total | `subtotal − discount − coupon − cds + delivery + tip` in paise, floored at 0 | `pricing.service.js:132` |
| COD fee | on `(total − tip)`; fixed or % (paise rounding), min order threshold, `maxFee` cap, plus GST on the fee | `codCharge.service.js:71-93`, `order.controller.js:542-545` |
| Payable | `total + codFeeTotal` → stored as `pricing.totalAmount` and `Payment.amount` | `order.controller.js:545,590,618` |
| GST | **Inclusive only.** `taxable = round(gross × 100/(100+r))`, `gst = gross − taxable`, per line, half-up in paise. GST is extracted, never added. Discounts are allocated proportionally (largest remainder). | `productGst.service.js:45-63,82-90` |

**Verdict: correct in code.** No double discount (`discount` and `cdsDiscount` are hard-wired to 0). The coupon is applied once. The COD fee is added once and only when `paymentMethod === 'cod'`. Tax is not added on top of inclusive prices. Rounding happens at line level in integer paise. The web and mobile checkouts display server quotes (`summary.codFeeQuote` and similar); no client-side recomputation was found.

**Policy questions (not code defects):**
- F-018: the Easy Returns charge is part of the GST-inclusive product price and the seller's commission base.
- F-019: delivery fee is untaxed; GST has no CGST/SGST/IGST split.
- The COD fee GST rate is admin-entered.

## B. Razorpay

**Paths:**
- `POST /api/payments/initiate` ([payment.controller.js:236](../../backend/controllers/payment.controller.js#L236))
- `POST /api/payments/razorpay/verify` (:502)
- `POST /api/payments/razorpay/webhook` (:406)
- `GET /api/payments/:orderId/status` (:586)
- shared `settle()` (:53)

| Control | Status | Evidence |
|---|---|---|
| Amount sent to gateway = order payable | ✔ | `toPaise(order.pricing.totalAmount)`, or `payment.amount` for group payments (:269-284); response amount is re-checked (:321) |
| Paise conversion | ✔ | `toPaise` / `Math.round(x*100)` |
| Checkout signature | ✔ | HMAC-SHA256 `order_id|payment_id`, timing-safe ([razorpay.service.js:35-41](../../backend/services/razorpay.service.js#L35-L41)) |
| Server re-fetch | ✔ | `/verify` re-fetches the payment from Razorpay and requires matching order id, amount and currency (:523-528) |
| Webhook signature | ✔ | HMAC over the raw body captured only for the webhook path ([index.js](../../backend/index.js) `express.json verify`) |
| Webhook amount check | ✔ | Against both the attempt amount and `payment.amount` (:480-485) |
| Duplicate webhook / verify race | ✔ | Capture journal keyed by `gatewayPaymentId`; replay returns early (:62-65, :84-88); all writes inside one transaction |
| Late or second capture | ✔ | Recorded with `disposition: refund_required` and a refund obligation; no double fulfilment (:95-103) |
| Capture for a cancelled order | ✔ | Refund obligation plus `order.refundPending` (:104-109) |
| Failed payment | ✔ | Payment → `failed`; order stays `placed` for retry; coins released |
| Attempt limit / uncertain creation | ✔ | Max 20 attempts; `creation_unknown` blocks new attempts until reconciled (:294-319) |
| Authorized-but-not-captured | ⚠ Unverified | State `PENDING` is a no-op. If auto-capture is disabled in the Razorpay dashboard, orders would wait forever. Dashboard setting not visible to this audit. |
| Refund creation | ✔ | Via `processRefundObligation` (payment-recovery service) with a receipt key; webhook `refund.processed`/`failed` reconciled |
| Abandoned unpaid orders | ✘ **F-004** | No server expiry |

## C. COD

| Control | Status | Evidence |
|---|---|---|
| Fee configured by admin, recomputed server-side | ✔ | `loadCodChargeSetting()` read live at checkout |
| Fee charged once | ✔ | Single addition to payable; stored in `pricing.codFee*`; snapshot `components.codFeePaise` |
| Fee is platform income, not seller earnings | ✔ | `orderFinance.service.js:301-308` posts `customer_cod_fee` and `cod_fee_tax` |
| Rider collection amount | ✔ | `Math.round(order.pricing.totalAmount)` shown to rider (`deliveryPartner.controller.js:703`); consistent with `codCashDuePaise` |
| Rider cannot over-report | ✔ | `collect` must be > 0 and ≤ `max(expected, rounded due)`; remit ≤ collected (`orderFinance.service.js:182-195`) |
| Rider cannot self-verify | ✔ | Remitter ≠ verifier (:198) |
| Shortage | ✔ policy | Admin write-off equals the verified shortage; booked to `cod_shortage_expense` |
| Rounding residual | ⚠ **F-012** | Up to ₹0.50 per order between `expectedPaise` and cash; not booked to any account |
| Delivery completion without customer | ✘ **F-003** | OTP brute force |
| COD refund | ✔ | Wallet credit only after the rider has recorded collection; capped at collected cash (`return.service.js:705-720`) |

## D. Seller commission

**Path:** Order `pre('validate')` → [vendorCommission.service.js `buildOrderFinancialSnapshot` :233](../../backend/services/vendorCommission.service.js#L233)

- **Rule store:** `commissions` (immutable versions) plus `commissioncurrents` (one pointer per scope). Saving moves the pointer inside a transaction with optimistic `supersedes` and `revision` checks. Rules take effect when saved; there is no future dating.
- **Selection:** For the order's channel (`wholesale` / `ecommerce` / `quick`), the order is product rule > category rule > channel-wide. Inactive overrides fall through to the broader scope.
- **Base:** `eligiblePaise = gross − allocated order discounts`. Commission is a fixed amount or `%` × eligible, with optional min and max. Tax on commission can be inclusive, exclusive or exempt. A zero-eligible line pays no commission.
- **Withholding:**
  - TCS = rate × taxable value (gross excluding product GST)
  - TDS = rate × gross
  - Rates come from Finance Policy.
- **Seller net:** `gross − commission − commissionTax − TCS − TDS`. Under the platform-funded discount policy the seller is paid on **gross**, not on the discounted price.
- **Missing rule:** the snapshot state is `held_missing_rule`, and `postOrderFinance` refuses to post (`orderFinance.service.js:285`). Money is held, never mis-posted.
- **Conservation check:** `Σ eligible + delivery + incentive + tip + donation + codFee == payable`, or the snapshot is not frozen. The checkout is not blocked; the error is recorded in `financialSnapshotError` (`Order.js:556-569`).
- **Immutability:** pre-save and pre-update hooks reject changes to `financialSnapshot`, `productTax` and item price/qty/seller (`Order.js:526-547`).

**Verdict: correct in code.** Coupons can only be created by admins (`/api/admin/coupons`), so a seller cannot fund a self-dealing discount at platform expense. Campaign discounts reduce the unit price itself, so they are seller-funded.

**Operational risk:** orders frozen with `held_missing_rule` before a rule existed can never be recalculated by design ("historical recalculation is prohibited"). They need the historical-batch process. Run query R-6 in the reconciliation report.

## E. Seller earnings, return hold ("escrow") and settlement

| Stage | Trigger | Ledger effect |
|---|---|---|
| Post | Order `delivered` **and** payment verified (online: settled capture matches the amount; wallet: debit ledger row; COD: cash verified) | Per line: `seller_payable` NET (held), `commission_revenue`, `tax_liability`, `tcs_liability`, `tds_liability`, `platform_discount_expense`, `merchandise_gross`; plus customer delivery, COD fee and same-day incentive |
| Release | `returnHoldOpen(item)` false (return window elapsed using **frozen** policy) and no open return on the line | `held` debit / `eligible` credit (net of reversals) |
| Refund reversal | Return `REFUNDED` with provider or wallet evidence | Proportional debit of each component. If the line was already released, the debit goes against the eligible balance up to what is available, and the remainder becomes held debt. |
| Payout reserve | Seller request or weekly job; transaction plus `financialLedgerVersion` fence; blocked if `held < 0` or settlement not clear | `eligible` → `reserved` |
| Settle | Admin enters a bank UTR; unique receipt id (sha256 of the reference), beneficiary review, optional independent reviewer | `reserved` → `settled` |
| Reject | Admin | `reserved` → `eligible` |

**Duplicate settlement:** Prevented by the idempotency keys `PAYOUT:<id>:SETTLE_*`, the `status: 'PENDING'` precondition, and the receipt-claim collection.

**Gap (F-020):** There is no reversal path after `APPROVED` for a bounced bank transfer.

**Authorization gap (F-002):** Any admin can reach settle and reject through a case-variant URL.

## F. Refunds

- **Return refund:**
  - Amount = proportional `customerPaidPaise` of the returned quantity (delivery excluded, discounts conserved). It is frozen on first processing.
  - `refundAllocationStartQuantity` serializes partial returns.
  - It must equal the snapshot-based figure in `reverseRefundedReturn`, or posting stops for manual reconciliation.
- **Online:**
  - A refund obligation is created on the Payment.
  - `processRefundObligation` calls Razorpay with a stable receipt.
  - Webhooks reconcile. A lock prevents concurrent processing.
  - `refundObligations` **are** created for return refunds (`ensureReturnObligation`), cancellations (`coordinateOnlineCancellation`) and extra captures.
- **Wallet/COD:** Wallet credit with idempotency key `RETURN_REFUND:<id>`, capped at the original payment and at collected cash.
- **Cancellation (online):** The obligation is queued only. Execution requires an admin action in Payment Recovery (**F-006**); no automated executor or ageing alert was found.
- **Partial refunds:** Supported per quantity.
- **Duplicate refunds:** Prevented by idempotency key and lock.

## G. Delivery partner finance

- Earnings = `riderPayout(distance, frozen rates, tip)`, computed once. Completion runs inside one transaction conditioned on `status ∉ terminal`, so a double-tap cannot double-credit (`deliveryPartner.controller.js:1644-1741`).
- v2 orders post `rider_payable` held and release it once payment or cash is verified.
- Legacy bulk rider settle is disabled (`admin.controller.js:2791-2794`). Rider payouts use reserved requests.
- **Risk:** F-003 lets earnings accrue for an undelivered order.

## H. GST and tax

| Item | Code behaviour | Classification |
|---|---|---|
| Product price | Always GST-inclusive; any stored "exclusive" product is blocked from checkout until seller review | Implemented consistently |
| Supported rates | 0/5/12/18/28 (`productGst.service.js:6`). The commission service accepts up to 40 for legacy snapshot reads (`vendorCommission.service.js:216`). | Policy question: the 2025 GST rate rationalisation (e.g. 40% slab) is not represented |
| Discount | Platform-funded. Tax basis is "seller consideration before platform discounts" (`productGst.service.js:76`). | Needs CA validation |
| Delivery fee | Not taxed (policy comment) | Needs CA validation |
| COD fee GST | Admin rate, platform liability | Implemented |
| Commission GST | Per-rule inclusive/exclusive/exempt | Implemented |
| TCS / TDS | Admin rates; TCS on value excluding GST, TDS on gross | Implemented; rates need CA confirmation |
| Refund GST | Proportional, GST taken as the residual (`refundProductGst`) | Implemented |
| Place of supply / IGST vs CGST+SGST | Not implemented (`components: null`, `jurisdictionStatus: 'unverified'`) | **Compliance gap (F-019)** |

## I. Wallet (critical)

- **F-001:** `devQuickTopup` lets customers credit unlimited funds.
- Real top-up (`/topup/initiate` and `/topup/verify`) goes through Razorpay with server-side amount verification (`walletTopup.service.js:8-11`). That path is sound.
- Admin credit and debit require a reason of at least 5 characters. Their gating by finance permission was not confirmed: `/api/wallet/admin/...` is only `requireAdmin`. Recommend `manage_finance`.

## J. Ledger model

- **Source of truth:** `sellerledgerentries` (account, bucket, direction, idempotencyKey, unique entryNo). It is append-only by convention; corrections are compensating entries.
- **Double entry:** This is not a strict two-sided double-entry ledger. Each event posts one row per account component; the trial balance is derived (`/finance/trial-balance`).
- **Customer wallet:** `walletledgers` plus the `User.wallet.balance` projection.
- **Payments:** `payments` (captures, gatewayAttempts, refundObligations).
- **Orders:** `orders.financialSnapshot` (immutable), `financialPosting`, `codFinance`.
