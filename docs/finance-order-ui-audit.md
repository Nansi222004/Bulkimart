# Order finance UI and button audit

Completed on 28 October 2026 for Finance Center → Orders & COD.

The order popup now separates Summary, Payment history, and Item earnings. Its header, navigation, and available actions stay visible while the selected section scrolls. The popup fits mobile and desktop screens, supports backdrop/close/Escape dismissal, traps focus through the shared modal component, and restores focus to the selected order. Escape also works after refreshing an order temporarily disables its focused button.

Payment history uses readable activity descriptions and account names instead of displaying database IDs. Product and store names are resolved by the admin API in batches. Saved amounts, cash evidence, event references, and financial snapshots are not rewritten. Missing or deleted account names are described as unavailable; names, rates, and amounts are not invented. Technical delivery references remain accessible in a disclosure when needed.

## Controls checked

| Control | Verified behavior |
| --- | --- |
| Search and cash/date filters | Apply the entered filters, reset to the first page, reject an end date before the start date, and do not submit while typing. |
| Clear filters | Removes previously applied filters from the next server request, including when clearing from a later page. |
| Previous / Next | Change pages while retaining applied filters; unavailable pages are disabled. |
| Refresh orders / Refresh order | Reload authoritative order data without reporting a financial save. |
| Download CSV | Downloads the actual CSV response using applied filters; starts a real browser download and reports download errors. |
| View details | Opens the selected order, without writing any financial records. |
| Summary / Payment history / Item earnings | Display the selected section and clear an unfinished action form when changing section. |
| Confirm cash received | Opens the cash receipt form and submits the entered amount and real evidence to `cod/verify`. |
| Report a cash problem | Opens a form and submits the issue to `cod/dispute`. |
| Cover cash shortfall | Submits the reviewed shortfall action to `cod/writeoff`. |
| Calculate seller earnings | Submits to `allocate`; is disabled with an explanation when commission or discount information is missing. |
| Release seller earnings | Submits to `release`. |
| Release rider earnings | Submits to `release-rider`. |
| Confirm / Save cash issue / Confirm cash receipt | Require real evidence and a reason, retain the financial revision check, and prevent duplicate submissions. No generic evidence reference or reason is supplied. |
| Cancel | Clears the action draft and returns to the order details without a write. |
| Close / backdrop / Escape | Close the popup when an operation is not in flight and restore focus. |
| Retry loading orders | Retries an unsuccessful read without presenting the failure as an empty order list. |

Existing server permissions, release gates, reconciliation checks, and financial calculations continue to enforce all money operations. Unavailable actions are disabled and explained rather than connected to placeholder behavior.

## Validation

- 112 backend integration tests passed, including authorization, real CSV export, cash/earnings operations, and the new display-name and privacy checks.
- 87 frontend tests passed across the financial workflow and Finance Center suites. These include all six order-finance action endpoints, evidence validation, duplicate-submission prevention, filter clearing, pagination, refresh, CSV download, readable names, missing-data states, cancellation, and retry.
- Six Chromium scenarios passed at 390px and 1440px: COD list, All Orders list, and an enabled cash-issue workflow. The checks exercise section navigation, refresh, cancel, cash-issue submission, Escape, focus restoration, and viewport bounds.
- Production build passed. Vite retains the existing large-bundle warning.
- Changed files passed whitespace and backend syntax checks.

Backend integration tests use an isolated MongoDB replica set. Browser tests use the built frontend and mocked APIs; no live cash confirmation, payout, or dispute was created. Screenshots are in `test-artifacts/finance-order-details`. Restart the backend if auto-reload is not enabled, and reload the local frontend preview.

The code-review graph tools were unavailable, so this audit used direct source and diff inspection. Existing unrelated working-tree edits were preserved.
