# Seller home fixes — 29 October 2026

The seller header profile opens Profile. All four dashboard KPI cards are keyboard accessible buttons: Revenue opens Earnings, Total Orders opens Orders, Average Order Value opens Sales Report, and Pending Orders opens the Pending filter. The average label wraps without an overlapping icon.

Revenue includes completed orders with payment evidence (or COD), using only the seller's merchandise after allocated discounts. Unfinished orders, unpaid checkouts, cancelled orders, returned orders and refunded orders cannot inflate it. Average Order Value divides that revenue by completed orders. Total Orders counts visible, non-cancelled orders, including orders in progress.

Net earnings appear separately in the Revenue card and use original financial snapshots, including commission and deductions. Missing historical terms or unresolved return adjustments are marked pending; they are not recalculated using current commission rules. Revenue with irreconcilable historical pricing displays its known subtotal and pending coverage. These figures are sales/earnings, not withdrawable payout balances.

Pending means placed, confirmed or preparing, with COD or paid online payment. The card and server-side Pending filter use the same statuses and payment eligibility. KPI and order requests reject stale responses. Dashboard totals refresh when returning to the dashboard, focusing the window, or receiving new order/notification events. Dashboard totals cover all storefronts; hybrid sellers also see both storefront sales breakdowns. The subsequent Neelam audit corrected the earlier active-storefront scope and distinguishes pending net earnings from posted settlement balances; see `neelam-store-calculation-audit.md`.

Sales Performance uses the server's last 30 daily completed-sales values, with India calendar dates. Hover, tap and keyboard focus show the day's value and cursor guide. The 7-day and 30-day controls select actual series data.

Bulk listing accepts `.xlsx` and UTF-8 `.csv` sheets up to 10 MB and optional `.zip` images up to 50 MB. Both client and server reject unsupported files. Corrupt workbooks/archives, empty sheets, missing required columns, missing names, invalid category hierarchies, malformed prices, MRP below price, invalid stock/units and unmatched image filenames produce clear errors. All rows validate before product creation; row validation failures create no products. Upload failures during import remain visible as per-row errors with honest success/failure counts.

The Excel template now includes Stock with whole-number validation. Category dropdown defined names use the supported ExcelJS API. CSV parsing handles BOMs, quoted commas, multiline values and physical spreadsheet row numbers.

Verification:

- Backend: 48 tests passed across seller home, payment notifications and seller order regressions, using disposable MongoDB databases. Two old notification-test assertions were aligned with the existing unpaid-order details rule (404); the API behavior for those requests did not change.
- Frontend: 11 component tests passed across seller home and seller order amounts.
- Browser: production pages passed at widths 320, 390, 768 and 1280, covering profile/KPI navigation, Pending filter, Average Order Value layout, chart hover/range and upload file/row errors. Browser API fixtures and disposable backend tests are separate; this did not exercise production data or external image hosting.
- Production build and whitespace checks passed.

These changes have not been deployed.
