# Bulkimart — Financial Invariants

These are the rules the money code must always keep. Each one names where it is enforced and the test that checks it.
"ACCOUNTANT REVIEW" marks an assumption that is a business or tax decision, not settled advice.

## 1. Money representation

| # | Invariant | Enforced in | Checked by |
|---|-----------|-------------|------------|
| M1 | Money is calculated in integer paise. Rupee values are converted with `toPaise` / `moneyPaise` and rounded once, at the boundary. | `utils/money.js`, `utils/financeMoney.js` | finance-gaps, financial-workflow |
| M2 | Ledger amounts have at most 2 decimals, in INR only. A non-conforming row blocks balances with a 409 instead of being silently rounded. | `sellerLedger.service.js::sellerBalances` | financial-workflow "precision" tests |
| M3 | Campaign unit price = `round(pricePaise × (100 − pct) / 100)` paise. Listing, cart and checkout use the same function, so they always agree. | `campaign.service.js::campaignUnitPrice` | campaign-participation (formula) |
| M4 | ₹0 is a real value. Money fallbacks use `??`, never `||`. A ₹0 order in a grouped payment refunds ₹0, not the group total. | `order.controller.js` cancel path, `razorpay.service.js`, `admin.controller.js` | code review (audit P3/L1) |

## 2. Orders and commission

| # | Invariant | Enforced in | Checked by |
|---|-----------|-------------|------------|
| O1 | Every paid order carries an immutable `financialSnapshot` (commission, commission GST, TCS, TDS and net per line) frozen at checkout. A later rule change never re-prices it. | `Order.js` pre-validate, `vendorCommission.service.js` | finance-gaps, vendor-sales |
| O2 | No commission rule at checkout → snapshot state `not_configured`. Nothing defaults to 10%; reports show "Not configured at checkout". The legacy `Seller.commissionRate` (schema default 10) is used in no calculation and is not displayed as the rate. | `admin.controller.js::getVendorSalesAdmin`, seller detail metrics | vendor-sales "no commission rule" |
| O3 | Exchange replacements (`Order.exchange` set) are ₹0 fulfilments of an earlier sale. They have no finance snapshot, no invoice and no ledger postings, and are excluded from sales, order counts, AOV and the seller dashboard. | `Order.js`, `adminReports.service.js`, `sellerDashboard.service.js`, `getVendorSalesAdmin` | vendor-sales P4, return-exchange |
| O4 | Vendor Sales shows only non-cancelled orders that are COD or actually paid. Unpaid or abandoned online checkouts are excluded. | `sellerHistoryPaymentStages()` | vendor-sales exclusion test |

## 3. Seller ledger and payouts

| # | Invariant | Enforced in | Checked by |
|---|-----------|-------------|------------|
| L1 | Each ledger entry has a unique `idempotencyKey` and is immutable. Re-posting the same event is a no-op. | `SellerLedgerEntry` unique index, `postLedgerEntry` | financial-workflow, finance-gaps (concurrent `postOrderFinance`) |
| L2 | Seller earnings post only for delivered orders whose snapshot is configured and whose cash is settled (non-COD, or COD verified/allocated). | `financeAutomation.service.js` | financial-workflow |
| L3 | A seller's actual earning = `order_earning` credits − `reversal` debits on `seller_payable`. Bucket moves are balanced `adjustment` pairs and net to zero. | `releaseOrderFinance`, `reverseRefundedReturn` | vendor-sales ledger test |
| L4 | A payout reserves eligible money once. Concurrent requests or settlements cannot reserve or settle twice. | `sellerPayout.service.js`, `settleSellerPayoutLedgerAdmin` | financial-workflow concurrency tests |
| L5 | A refund reversal is posted once per return and can never exceed the original earning. | `reverseRefundedReturn` | financial-workflow "cannot reverse the same refund twice" |
| L6 | *(Added 2026-11-25, approved.)* A delivery reported only by the seller (Self Delivery, own courier) posts no seller earning until a confirmation hold (`EXTERNAL_DELIVERY_HOLD_DAYS`, default 7) has passed and no customer "not received" report is open. Admin may cancel and refund such an order only before anything was posted. | `externalCourier.service.js::externalDeliveryHoldOpen`, `postOrderFinance`, `financeAutomation` query, `claimExternalCourierCancellation` | delivery-phase2b |
| L7 | *(Added 2026-11-25, approved direction.)* The customer delivery charge is booked exactly once per order: to `customer_delivery` (platform), or — only for an own-courier Self Delivery order whose hand-off recorded `deliveryFeePayee: 'seller'` — to `seller_payable` as `self_delivery_fee`. Both use the idempotency key `FINANCE:<order>:CUSTOMER_DELIVERY`, so a second payee is refused. The payee is frozen at hand-off from `SELF_DELIVERY_FEE_CREDIT_ENABLED` (off). Rider and Shiprocket orders are unchanged. Like the platform charge, it is not reversed by item returns. | `postOrderFinance`, `releaseOrderFinance`, `dispatchExternalCourier` | delivery-phase2b, self-delivery |

## 4. Cash on delivery

| # | Invariant | Enforced in | Checked by |
|---|-----------|-------------|------------|
| C1 | *(Amended 2026-11-25, approved.)* Shiprocket COD bookings are blocked (`SHIPROCKET_COD_UNAVAILABLE`) unless **all** hold: `SHIPROCKET_COD_ENABLED=true` (off by default; production stays off until the account's remittance mode is verified); a Shop All order; not Self Delivery; not an exchange replacement; a configured v2 finance snapshot. Quick Commerce Shiprocket COD (and its fee step) stays blocked. The booked collectable amount (sub_total + shipping − discount, with the COD fee as its own item line) must equal the frozen order payable, or booking is refused before the provider is contacted. | `courierTracking.service.js::shiprocketCodBlocked`, `fulfillment.controller.js::buildShiprocketOrderPayload`, quick-fee controller | courier-tracking, quick-shiprocket-fee, shiprocket-cod |
| C2 | A Delivered status, a tracking number, a webhook or an admin/seller status change never marks COD paid. Only rider verification (OTP-confirmed rider delivery) or a recorded courier remittance settles COD cash. | `recordCodEvent`, `recordCourierCodRemittance`, `markCodPaymentIfSettled` | courier-tracking (H1 and H2 tests), courier-cod-remittance |
| C3 | A courier remittance is idempotent per (provider, reference). The same lines again → `alreadyRecorded`; different lines under the same reference → 409. *(Amended 2026-11-25, approved.)* A finance admin may **re-apply** the lines of a recorded remittance whose latest outcome is `not_delivered` or `unmatched` (e.g. remitted before the delivered scan), with a reason. Applied, partial, excess, duplicate, not_cod, not_courier and no_finance_snapshot lines are never re-run; each line still goes through the same apply step, which refuses a remittance already applied to that order. The original `lines` are immutable; every attempt is appended to `reapplications`; the remittance `revision` serializes concurrent attempts. | `orderFinance.service.js::reapplyCourierCodRemittance`, `CourierCodRemittance` update guard | courier-cod-remittance, delivery-phase2b |
| C4 | Remittance lines settle only delivered COD courier orders with a configured snapshot. Rider orders, non-COD, undelivered, unmatched, duplicate, partial and excess lines are recorded with their outcome and never silently applied. | `applyRemittanceLine` | courier-cod-remittance |
| C5 | A grouped COD payment is marked paid only when every sibling order is settled. | `markCodPaymentIfSettled` | courier-cod-remittance "grouped siblings" |
| C6 | Courier-remitted cash goes straight to the bank, so it never counts as rider custody. | `financialReconciliation.service.js` | courier-cod-remittance |

**ACCOUNTANT REVIEW:** courier remittance creates no new ledger account; settlement reuses `codFinance` and the existing posting path.

**Gross vs net remittance (open, 2026-11-25):** settlement still expects the **gross** COD amount. If the Shiprocket account remits net of its charges, every line shows as a shortfall (`remittance_reported`) and stays unsettled — nothing is netted or waived automatically. The reconciliation report shows gross, verified courier charges (from recorded provider invoices), remitted, outstanding and unexplained amounts side by side. Accepting verified courier deductions as settlement would change C2/C4 and needs separate approval.

**ACCOUNTANT REVIEW — Self Delivery charge to seller (L7):** GST treatment of a delivery charge the platform collects and pays to the seller is not decided. `SELF_DELIVERY_FEE_CREDIT_ENABLED` stays off until it is; entries carry `metadata.taxTreatment: 'pending_accountant_review'`.

## 5. Returns, exchanges and refunds

| # | Invariant | Enforced in | Checked by |
|---|-----------|-------------|------------|
| R1 | The exchange price reference is the merchandise unit price actually paid: campaign price included, Easy Returns surcharge excluded, platform-funded coupons not deducted. | `returnExchange.service.js::paidUnitPaise` | return-exchange N1 (campaign, price rise, price drop, surcharge, coupon) |
| R2 | An exchange is like-for-like at the same price: a dearer or cheaper variant is never offered, so no money moves inside an exchange. | `exchangeOptionsFor` | return-exchange N1 |
| R3 | One exchange per purchased item, with no chains. The claim is atomic (`items.$.exchangeReturnId`), so concurrent requests produce exactly one winner. A rejected or cancelled exchange gives the claim back. A replacement order is support-only. | `return.service.js::createReturnRequest`, `releaseExchangeClaim` | return-exchange rule C tests |
| R4 | A refund's GST breakdown (`refundBreakdown.productTax`) is frozen when first computed and never recomputed. Partial refunds conserve every paisa (GST is the residual). | `calculateReturnRefund`, `refundProductGst` | tax-invoice credit note test |

## 6. GST documents

| # | Invariant | Enforced in | Checked by |
|---|-----------|-------------|------------|
| G1 | One immutable invoice per (order, seller), numbered `INVyyyy-nnnnnn` per seller per financial year (April–March IST), with no gaps or reuse. | `taxInvoice.service.js::issueSellerInvoice` | tax-invoice |
| G2 | One immutable credit note per refunded return, numbered `CNyyyy-nnnnnn` in its own per-seller per-FY series and linked to the original invoice. It is issued idempotently; a refund without a frozen GST breakdown is refused before a number is taken. | `issueCreditNote`, `CreditNote` unique `returnId` | tax-invoice credit note tests |
| G3 | Exchanges get no credit note, and replacement orders get no invoice; the original invoice covers the goods. | `deliveredOrder`, `refundedReturnsOf` | tax-invoice N3 test |

**ACCOUNTANT REVIEW — credit note assumptions** (also embedded in every credit note as `document.assumptions`):
1. The note is issued in the seller's name as supplier (CGST Act s.34), with Bulkimart acting as the marketplace.
2. The credited value is the GST-inclusive price of the returned quantity as invoiced. Platform-funded discounts do not reduce it, matching the invoice.
3. The CGST+SGST / IGST split follows the original invoice.
4. Delivery and COD fees are Bulkimart's own charges and are not credited.
5. Exchanges get no credit note.
6. The s.34(2) declaration time limit is not enforced by Bulkimart.

Place-of-supply treatment (`jurisdictionStatus: 'unverified'`) is still unreviewed (audit I1).

## 7. Campaigns

| # | Invariant | Enforced in | Checked by |
|---|-----------|-------------|------------|
| K1 | Publishing a campaign creates PENDING participation only. Customers are charged the campaign price only for ACCEPTED rows; the public campaign page never shows PENDING deals. | `campaign.controller.js`, `resolveCampaignPricesForProducts` | campaign-participation |
| K2 | Accept is atomic (PENDING → ACCEPTED once). A product already in another active or scheduled campaign is skipped, so discounts never stack. Reject and withdraw stop the discount. | `acceptCampaignParticipation`, `rejectCampaignParticipation`, `withdrawCampaignParticipation` | campaign-participation |
| K3 | Historical auto-accepted rows are reported read-only (`GET /api/admin/campaigns/participation-audit`) and never rewritten. | `auditAutoAcceptedParticipation` | campaign-participation audit test |

## 8. Fulfilled by Bulkimart (FBB) — added 2026-11-25, Phase 3 (flags off)

| # | Invariant | Enforced in | Checked by |
|---|-----------|-------------|------------|
| F1 | FBB stock lives in `WarehouseStock` (sellable / reserved / damaged per warehouse, product and variant). The listing's `variants[].stock` is only a mirror of the summed sellable units, recomputed in the same transaction as every warehouse change. Sellers never change FBB stock. Admin changes go only through receipts or two-person adjustments with a reason. | `warehouse.service.js::warehouseStockOp`, `syncVariantMirror`, `adjustProductStock` (409), `decideAdjustment` | fbb-phase3, fbb.http |
| F2 | Stock goes back by the method frozen on the order line, never the product's current method. A line placed before conversion restores seller-held stock (as a movement only); an FBB line releases its warehouse reservation, or after hand-off: an inspected customer return goes to sellable or damaged; a parcel back from the courier (RTO / undelivered) is never assumed either way — it goes to `quarantine` (not for sale) until an admin inspects it once (`Order.fbb.returnInspection` pending → done) and splits it into sellable + damaged. A lost parcel adds nothing back. A unit is never restocked twice. (Amended 2026-11-25, Phase 4: RTO previously went straight to damaged.) | `inventory.service.js::mutateInventory`, `return.service.js`, `order.controller.js::cancelOrderAndRestore`, `fbbFulfillment.service.js::inspectFbbReturnedOrder` | fbb-phase3, fbb.http "RTO … inspected exactly once" |
| F3 | Service charges are frozen at the right moment: storage per accepted unit at receipt posting (never damaged, rejected or missing units, never again on a resellable return); packaging when packed; fulfilment at the first hand-off. Packaging and fulfilment rates are frozen on the order at placement (`Order.fbb.chargeTerms`). Rate versions are immutable. | `fbbCharges.service.js::chargeStorageForReceipt`, `chargeOrderService`, `FbbChargeConfig` guards | fbb-phase3 |
| F4 | Each charge is booked once: `FbbCharge._id` is its key (`STORAGE:<receipt>:<line>`, `PACKAGING:<order>`, `FULFILLMENT:<order>`) and its ledger debit uses `FBB:<key>`. Corrections are reversals (`FBB_REVERSAL:<key>`), never edits or deletes. Cancelling before packing books nothing; after packing and before hand-off, packaging only; after hand-off, both. Returns, failed deliveries and RTO keep the charges. Exchange replacements carry no charge terms. | `bookCharge`, `reverseCharge`, `cancelFbbOrder` | fbb-phase3 |
| F5 | FBB charges are an obligation (`seller_fbb_obligation` account), not a reduction of the order's commission or earning. Commission is computed exactly as before. The customer price is never changed by FBB. | `SellerLedgerEntry` validation, `fulfilmentOrders.service.js` | fbb-phase3, fbb.http |
| F6 | What is owed is deducted from settlement-eligible earnings as one balanced pair (eligible `seller_payable` debit + obligation credit), never more than either side. It is serialized with payouts by the seller's `financialLedgerVersion`, runs inside the payout request transaction before the balance check, and before weekly payouts. A seller is never suspended automatically. | `settleFbbObligationsInSession`, `createSellerPayoutRequest`, `financeAutomation` | fbb-phase3 |
| F7 | An advance payment settles only after signature and live gateway verification. It is credited once per gateway payment (`FBB_PAYMENT:<paymentId>`) and never exceeds what was owed when started. Any surplus after later reversals is shown as advance credit, never paid out automatically. | `startFbbObligationPayment`, `settleFbbObligationPayment`, `payment.controller.js::settle` | fbb-phase3 |
| F8 | Turning a switch off never abandons anything: existing FBB orders, stock, RTO inspections, returns and obligations keep working. Packaging and fulfilment on an existing order are still booked from the terms frozen on it, whatever the switch says now. | `chargeOrderService` (terms, not the flag), admin FBB routes | fbb.http "switched off" |
| F9 | FBB is a paid service. New FBB sales need `DELIVERY_METHODS_ENABLED`, `FBB_ENABLED` and `FBB_CHARGES_ENABLED` (`fbbSellable`) and rates in force at placement; otherwise the order is not placed, so no FBB order exists without frozen charge terms. Posting a warehouse receipt likewise needs charging on and rates in force (the draft is kept), so storage is never skipped. Switching charges off therefore pauses new FBB sales and receiving, not billing of what already happened. (Added 2026-11-25, Phase 4.) | `deliveryMethod.service.js::fbbSellable`, `fulfilmentOrders.service.js`, `order.controller.js` (single checkout), `warehouse.service.js::postReceipt`, `fbbReadiness` | fbb.http, fbb-phase3 |

**ACCOUNTANT REVIEW — FBB charges:** GST on storage, packaging and fulfilment charges is not decided. Rates and charges carry `taxTreatment: 'pending_accountant_review'`. No tax is added or invoiced until this is decided.

## 9. Sessions

| # | Invariant | Enforced in | Checked by |
|---|-----------|-------------|------------|
| S1 | Logout revokes only that token (by SHA-256 hash, with a TTL equal to the token's expiry). Other devices stay signed in. Forged or expired tokens are never stored. | `sessionRevocation.service.js`, `auth.middleware.js`, socket auth | session-revocation |
