# Neelam store calculation — 29 October 2026

A read-only audit of the configured database confirmed the following completed merchandise sales. The audit did not start jobs, initialize model indexes, change orders, post earnings or issue payouts.

| Order | Storefront | Merchandise sales | Payment evidence | Original commission calculation | Earnings posted |
| --- | --- | ---: | --- | --- | --- |
| ORD-20261015-K2OCHK | Shop All | ₹250.00 | Online marked paid; capture journal absent | Missing | No |
| ORD-20261019-CIRFK5 | Shop All | ₹900.00 | COD; collection/remittance verification absent | Missing | No |
| ORD-20261023-6YWM0M | Quick Commerce | ₹900.00 | Online marked paid; capture journal present | Missing | No |

The store has **₹2,050.00 completed product sales**, split into **₹1,150.00 Shop All** and **₹900.00 Quick Commerce**. There are no customer discounts on these three orders. Shipping charges are excluded from merchandise revenue. The average completed order value is **₹2,050 / 3 = ₹683.33**. The store has ten non-cancelled orders in total and four awaiting acceptance/preparation across both storefronts.

The previous ₹1,150 total and ₹575 average described Shop All's two completed orders. Showing those values above a breakdown for both storefronts made the account summary misleading. Dashboard requests now cover the whole store; the Orders links preserve that scope and offer All storefronts alongside the individual channels.

All three completed orders lack original saved financial calculations. There are **zero seller earnings ledger entries** for this store. Consequently ₹0 is the recorded settlement balance, not a verified zero historical earning. Exact net earnings cannot be established from the present records. Current commission settings cannot establish the original agreement for an older order.

Earnings now shows completed sales and pending net earnings above explicitly labelled posted settlement balances. Both Dashboard and Earnings use the same sales calculation. The dashboard says **Not calculated yet · 3 orders awaiting finance review**, instead of **₹0.00 confirmed**. Earnings reports **Awaiting calculation**, the missing original commission details, and the three unposted orders. Readable historical discounts are displayed without inventing a commission or a net earning.

Posting the missing earnings requires the original commission evidence and payment/COD reconciliation through Finance Center's Old orders review. This patch does not create financial entries or make those unverified amounts withdrawable.

Verification: 112 existing financial workflow backend tests passed; all 8 seller-home backend tests passed, including the exact hybrid ₹2,050 / three-order case, consistent finance/dashboard totals, no exposed competing-seller items and no financial writes on reads. All 76 relevant frontend component tests passed. Production browser checks passed at 320, 390, 768 and 1280 pixels, including the ₹2,050 total and pending earnings panel. The production build and whitespace checks passed.

Audit output: `test-artifacts/seller-dashboard-audit/store-calculation.json`. Repeat with `node scripts/auditSellerDashboardReadOnly.mjs --store=Neelam` from `backend`. These are local source fixes; no deployment or financial reconciliation was performed.
