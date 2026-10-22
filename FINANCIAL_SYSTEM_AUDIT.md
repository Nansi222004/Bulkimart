# Financial architecture audit — 21 October 2026

Recorded before implementation changes. The code-review-graph tools are absent
from this session; repository search and source inspection were used instead.

## Existing behavior and reuse

* Physical channels are `ecommerce`, `grocery` and `shg`; wholesale is an
  immutable `Order.salesChannel`, not a separate payment or shipping channel.
* `order.controller` and `fulfilmentOrders.service` price on the server, reserve
  inventory and create orders and Payment inside MongoDB transactions. Unified
  checkout splits fulfillment groups into orders sharing one Payment. COD
  creates a pending Payment; wallet checkout debits the existing customer wallet.
* Seller acceptance is independent of customer payment. Seller order actions,
  fulfillment guards, rider eligibility and provider locks restrict dispatch.
  Rider delivery completion requires a customer OTP and atomically updates
  Delivery, Order and rider counters. Repeat completion is guarded.
* `Commission` contains vendor type/category, percentage/flat fee and effective
  date, but no production calculation references it. No merchandise earning
  producer posts `order_earning` to SellerLedgerEntry. The legacy admin vendor
  earnings report instead derives gross from delivered order lines and assumes
  `seller.commissionRate || 5` and 18% tax, without payment verification,
  discount allocation, refunds or ledger evidence. That is not a payable balance.
* `SellerLedgerEntry` / `sellerLedger.service` provide unique event keys,
  append-only query middleware, pending/held/eligible/reserved/settled buckets.
  Quick Shiprocket obligations and seller payout reservations reuse these.
  Seller payouts require eligible ledger balance and serialize on Seller.
  Their idempotency lookup is globally keyed without ownership validation.
  Settlement currently accepts a bank reference alone.
* `DeliveryRate` stores successive rate cards and audit actor/note. `riderPay`
  freezes accepted rates, applies base + distance (1 km floor), min/max and
  uncapped tip. Rates fall back to existing environment/default values. Effective
  dates are not filtered by its loader. `pricing.service` also uses rider distance
  pay to price customer delivery, so changing rider rates can change checkout.
  Customer pricing must remain unchanged by this implementation.
* Rider balance is `DeliveryPartner.earnings`, supported by completed Delivery
  records; it is not an append-only ledger. OTP completion immediately increases
  pending, even for unverified COD. Payout requests reserve pending then create
  DeliveryPayout in a separate write with best-effort restoration. Admin complete
  and reject update balance before saving payout; concurrent resolutions can
  duplicate credits. Bulk settle uses read/modify/save and no transfer reference.
* Additional UI inspection found `deliveryDebitWallet` in localStorage and a
  deposit dialog that reduced that number and announced gateway success without
  a backend payment. OTP completion also locally increased both cash and payout
  balances. These are presentation simulations, not financial evidence, and
  must be removed from the operational flow.
* Rider offers/active deliveries already expose COD amount from authoritative
  order pricing. No order-linked cash collection/remittance/verification exists.
  Delivery success neither proves platform receipt nor settles COD Payment.
* Customer WalletLedger and CoinTransaction have their own established purpose;
  neither should be repurposed for seller/rider settlement or cash custody.
* Quick Shiprocket uses QuickCommerceFinancialSnapshot, held freight/service fee/
  tax obligations, separate seller Payment, captured-provider verification and
  immutable versioned fee configuration. Its environment flag defaults off;
  business approvals remain pending. Preserve all existing fee and shipment gates.
* Razorpay uses durable gateway attempts, signed webhooks, capture validation,
  refund obligations, operation locks and admin recovery. New financial postings
  must consume this evidence, not create another charge or payment gateway.
* Returns reserve item quantity. `calculateReturnRefund` proportionally allocates
  order coupon/CDS/coin discounts, rounding each returned amount; delivery is
  excluded and merchandise GST is absent. COD refunds require manual admin
  settlement; commission/seller earning reversals do not yet exist.
* The existing 30-second sweeper handles stale Quick orders, seller notifications,
  return-window coin rewards and operational recovery. No approved settlement
  scheduler or automatic COD collection exists.
* Admin routes apply protect + requireAdmin. Delivery routes require approved
  partners; seller finance routes use existing seller session/ownership checks.
  Existing finance navigation includes seller ledger/payouts, rider earnings,
  Delivery Rates and Quick 3P settings. App Settings is a placeholder.
* Existing unique indexes cover seller ledger event keys, seller payout keys,
  delivery payout pending-per-partner, payment attempts and fulfillment claims.
  Existing model init/autoIndex behavior requires deployment review. DB boot also
  performs unrelated index/seed operations, so it must not be used for staging
  migration preparation against production.

## Constraints and financial inconsistencies

There is no unified platform general ledger. Extend the existing settlement
ledger with explicit owner/account dimensions instead of creating a competing
balance. Preserve legacy entries as seller payable. Cash evidence is operational
evidence, never spendable wallet money. Revenue, taxes, freight and delivery fees
need separate reporting accounts excluded from seller balances.

New financial snapshots must be opt-in for new orders only. Historic commissions,
rates, cash custody and settlement cannot be reconstructed safely from order
status. No backfill, live deduction, provider payout, shipment, index deployment
or production mutation is authorized. Transactional code must fail closed on a
standalone MongoDB deployment; isolated tests must use a replica set.

## Unapproved business decisions

Commission values/base, override precedence, fixed fee scope, minimum/maximum
and tax semantics; seller-funded vs platform-funded discounts/coins; rider rate
approval and distance source; earning hold/return window; COD remittance owner,
collection evidence, alternative payment, timing and cash verification duties;
shortage/excess/dispute write-offs; cancellation/failed delivery/reassignment and
reverse-trip compensation; post-settlement refunds and negative receivables;
bank/provider reconciliation and payout authorization. Keep new money operations
off until policies and staging end-to-end evidence are approved.
