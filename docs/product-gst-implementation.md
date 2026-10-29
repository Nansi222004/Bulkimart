# Product GST — implementation, historical data and open policy questions

Status: implemented in the working tree, **not committed or deployed**. No historical data has been changed.

## 1. What was wrong

- Sellers could set a GST rate, but every price was silently treated as GST-inclusive; there was no way to say GST is added on top.
- Pricing produced no product GST breakdown, so checkout could not show one.
- An order's taxable value was only calculated inside seller settlement, which stops when no approved commission rule exists — 12 of the 19 orders with a finance snapshot are in that state, so their GST was never worked out.
- Admin "GST treatment" settings apply to GST on Bulkimart's **commission**, not to product GST.

## 2. Design

**One calculator**: `backend/services/productGst.service.js`. Every server path — cart, basket, checkout (`/api/orders` and `/api/orders/unified`), digital checkout, order snapshot validation, seller settlement, returns, reports — calls it. The frontend only displays its results (`forntend/src/components/finance/ProductGstBreakdown.jsx`).

| Treatment | Taxable value | GST | Customer pays for the item |
|---|---|---|---|
| Inclusive (price includes GST) | price × 100 / (100 + rate) | price − taxable | price |
| Exclusive (GST added) | price | taxable × rate / 100 | price + GST |

- Integer paise; rounded **once per line** (price × quantity), half up. Taxable + GST always equals the line total.
- Supported rates: 0, 5, 12, 18, 28 (as the seller form already offered). Validated on the server.
- Coupons, promotions, CDS and coins are **funded by Bulkimart** (documented policy in `orderDiscounts.service.js`): they are allocated across lines by the existing largest-remainder method and reduce what the customer pays, but not the seller's taxable value (`taxBasis: seller_consideration_before_platform_discounts`). See open question Q2.
- Product GST never depends on a commission rule. Settlement uses the frozen taxable value instead of re-deriving it as if every price were inclusive.

**Product settings**
- New `Product.gstPriceType` (`inclusive` | `exclusive`) beside `gstRate` (now restricted to supported rates). Seller form: *GST Price Type* with an explanation.
- Existing products have no price type → read as **inclusive** (`gstConfigurationSource: legacy_inclusive`), which is how they were always priced and how the old settlement formula treated them. Nothing becomes exclusive silently.
- A missing or unsupported **rate** is never treated as 0%: checkout stops with "Product GST rate needs seller review before checkout". This applies identically to every checkout path (a hydrated Mongoose document's schema default is not counted as a stored rate). Data check on 29 Oct 2026: all 10 products have a stored supported rate (6 × 5%, 4 × 0%), so no product is affected today.
- Digital products (e-books) are unchanged: no product GST is added or extracted.

**Order snapshot** (`Order.productTax`, `Order.items[].productTax`, version `product-gst-v1`)
- Built from server values at checkout, validated against the order's own items, discounts and subtotal before save, and stored per line: product, seller, variant, quantity, unit and original price, rate, treatment, taxable value, GST, gross, allocated discounts, customer-paid amount; plus totals and a per-rate summary.
- Immutable: `productTax` and each item's price, quantity, product, seller and variant cannot be changed through the application (updates throw; a changed value on a loaded document is ignored). Editing a product never touches existing orders.
- CGST/SGST vs IGST is **not** split (`jurisdictionStatus: unverified`, `components: null`) — see Q1.

**Refunds and finance**
- Returns refund from the stored snapshot (`refundProductGst`), proportionally by quantity, conserving every paisa across partial returns; the current product is never read.
- Seller order finance, seller earnings aggregates, payout coverage, admin reports and coin/coupon bases read the stored line total (`itemGrossPaise`), falling back to price × quantity only for orders without a snapshot.

## 3. Files

Backend: `services/productGst.service.js` (new), `utils/productGstHistory.js` (new), `scripts/productGstHistoricalDryRun.mjs` (new), `models/Product.js`, `models/Order.js`, `models/Return.js`, `controllers/product.controller.js`, `controllers/order.controller.js`, `controllers/cart.controller.js`, `controllers/digitalCommerce.controller.js`, `controllers/return.controller.js`, `controllers/seller.controller.js`, `controllers/sellerFinance.controller.js`, `controllers/admin.controller.js`, `services/pricing.service.js`, `services/fulfilmentGroups.service.js`, `services/fulfilmentOrders.service.js`, `services/customerBasket.service.js`, `services/vendorCommission.service.js`, `services/return.service.js`, `services/coupon.service.js`, `services/coin.service.js`, `services/sellerOrderAmounts.service.js`, `services/sellerPayoutCoverage.service.js`, `services/adminReports.service.js`, `services/wholesaleQuote.service.js`.

Frontend: `components/finance/ProductGstBreakdown.jsx` (new), `modules/User/pages/CheckoutPage.jsx`, `modules/User/utils/paymentSummary.js`, `modules/User/components/BasketGroups.jsx`, `modules/User/components/UnifiedCartGroups.jsx`, `modules/User/pages/OrderTrackingPage.jsx`, `modules/Seller/components/ProductModal.jsx`, `modules/Seller/context/SellerContext.jsx`, `modules/Seller/components/OrderFinancialBreakdown.jsx`.

Tests: `backend/verification/product-gst.test.js`, `backend/verification/product-gst-checkout.test.js`, `forntend/verification/product-gst-ui.test.mjs` (new); fixtures in five existing suites now carry the stored GST rate every real product has, and four staging writes of deliberately corrupt orders use raw collection writes.

## 4. Historical orders — dry run (read-only)

`node scripts/productGstHistoricalDryRun.mjs <report.json>` reads every order, writes a report, makes **no database writes**, and refuses `--apply`. Evidence is limited to what each order froze at purchase; the current product is never read.

Run on 29 Oct 2026 against database `bulkimart` (36 orders):

| Class | Orders | Meaning |
|---|---|---|
| complete | 0 | valid `product-gst-v1` snapshot already stored |
| reconstructable | 17 | every item has a supported GST rate frozen in its finance snapshot; prices were inclusive by precedent; the reconstruction matches the order's own frozen gross, taxable value and subtotal |
| reconstructable_needs_review | 2 | as above, but a frozen **0%** may be the old code's fallback for an unusable rate — confirm each before backfilling |
| insufficient_evidence | 17 | no finance snapshot froze a rate — leave untouched; do not assume 0% |
| conflict | 0 | — |

**Proposed backfill (not executed — needs explicit approval)**
1. Back up: `node scripts/backupBulkimartTarget.mjs` (or an Atlas snapshot) immediately before.
2. Re-run the dry run; approve the exact list of `reconstructable` order ids (and any reviewed `needs_review` ones).
3. A separate, reviewed apply script writes only `productTax` and `items.$.productTax` to those ids, through a raw collection write (the application guard rightly refuses to add a snapshot to an existing order), guarded by `productTax: { $exists: false }` so it is idempotent. It must not change `pricing`, `items` prices/quantities, payments, ledgers or settlement, and must not trigger refunds or payments.
4. Verify: re-run the dry run (those orders must now be `complete`); for each, `productTax.grossPaise === round(pricing.subtotal × 100)` and `Σ rates.gstPaise === productTax.gstPaise`.
5. Rollback: `$unset` `productTax` and `items.$[].productTax` for exactly the backfilled ids (the backup holds the before-image). Nothing else is touched, so no compensating ledger entry is needed.

## 5. Policy decisions (29 Oct 2026)

- **Prices always include GST.** Sellers can no longer choose "GST exclusive"; the seller form, API (`Product prices must include GST`) and Product schema accept only `inclusive`. This covers every variant and wholesale tier price. A product somehow stored as `exclusive` is not sold until the seller reviews it (409 `Product GST price type needs seller review before checkout`). Orders already recorded as exclusive are still re-checked with their recorded maths; none exist today.
- **Bulkimart-funded discounts.** Coupons and coins are paid by Bulkimart, the seller is paid the full price, so GST stays on the full price (`taxBasis: seller_consideration_before_platform_discounts`). This is how marketplaces usually treat platform-funded discounts (the platform's payment counts towards the seller's price). Invoices show the full price, then the Bulkimart discount and what the customer paid.
- **Delivery charges carry no GST.** Recorded on every new snapshot as `deliveryTax: { status: 'not_charged', amountPaise: 0, treatment: 'none' }`, shown to customers as "Delivery Charge (no GST)", and noted on every invoice.
- **TCS** stays at 1% of the product taxable value, i.e. excluding GST (section 52), withheld from the seller's payout. No change.
- **Invoices.** Each seller on a delivered order gets their own invoice (`TaxInvoice` model, `services/taxInvoice.service.js`), built once from the frozen GST snapshot and never edited.
  - GSTIN on file → "Tax Invoice" with taxable value, rate and CGST + SGST (seller's GSTIN state = delivery state) or IGST (different states). If a state cannot be recognised the GST is shown in total only.
  - No GSTIN → plain "Invoice" without GST lines.
  - Numbers `INV<FY>-NNNNNN` (e.g. `INV2627-000001`, ≤16 characters) run per seller per financial year (April–March, India time), issued in a transaction so numbers never skip or repeat.
  - Customer: "View / download invoice" on a delivered order (`GET /api/orders/:id/invoices`). Seller: "View / print invoice" on the order detail (`GET /api/sellers/orders/:id/invoice`). Printing opens a clean page, so "Save as PDF" works.
  - Orders placed before GST snapshots get no invoice.
- **Still open:** products have no HSN code (registered sellers normally need it on invoices); returns do not yet issue credit notes; checkout shows a GST breakdown even for sellers without a GSTIN.
