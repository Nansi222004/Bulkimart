# Checkout repair and verification — 2026-10-15

## Completed changes

1. **Atlas compatibility repaired.** The authorized database `bulkimart`, MongoDB 8.0.34, had obsolete non-sparse full unique indexes on optional historical fields. `Payment.create()` collided on `gatewayOrderId_1` with a missing/null key; after that constraint was fixed, `Order.create()` would collide on `orderId_1`. The migration created and verified replacement UNIQUE partial indexes before retiring either old constraint. No fake gateway IDs, disabled integrity checks, blanket `syncIndexes()`, database reset or document cleanup was used.
2. **Wrong-cart submission repaired.** A fresh browser on neutral `/checkout` defaults to the Quick storefront while the unified basket can contain only e-commerce items. Checkout displayed that basket but invoked single-channel `placeOrder()` against an empty Quick cart. A single displayed group whose channel differs from the restored storefront now uses the existing grouped checkout path. Remembered Shop All still uses ordinary `/api/orders`. Payment, inventory, ownership, seller eligibility, pricing, delivery and financial validation remain server-authoritative.
3. **Local gateway configuration corrected.** The ignored `backend/.env` selected `phonepe` and omitted `RAZORPAY_MODE` despite having Razorpay test credentials. Only `PAYMENT_GATEWAY=razorpay` and `RAZORPAY_MODE=test` were changed. Credential values and historical PhonePe records/code were not altered. The real Razorpay API accepted one unpaid INR 1 test order and reported PENDING; no capture was requested.

## Exact Atlas scope

Target identity was pinned by database name and a SHA-256 hostname/database fingerprint (no URI or credentials logged). Preflight verified version, existing definitions, canonical uniqueness, duplicate present values and explicit null counts. There were zero duplicate present legacy IDs and zero explicit nulls. Test-data deletion was unnecessary.

| Collection | Retired index | Verified replacement |
| --- | --- | --- |
| `bulkimart.payments` | `gatewayOrderId_1` | `legacy_gateway_order_id_unique_present`: UNIQUE `{ gatewayOrderId: 1 }`, partial `{ gatewayOrderId: { $exists: true } }` |
| `bulkimart.orders` | `orderId_1` | `legacy_order_id_unique_present`: UNIQUE `{ orderId: 1 }`, partial `{ orderId: { $exists: true } }` |

All other index definitions were compared before/after and preserved, including UNIQUE `orders.orderNo_1`, UNIQUE `checkoutattempts.checkout_user_key_unique` on `{ userId: 1, key: 1 }`, the historical payments compound idempotency index, cart uniqueness and wallet/ledger uniqueness. `$exists: true` includes explicit null, so present null remains unique; only omitted legacy IDs stop colliding. Read-only post-migration inspection independently verified final definitions.

Migration document writes/deletions: **zero**. Counts remained 2 existing orders, 1 payment and 0 checkout attempts. Both existing orders were already cancelled. No users, products, sellers, inventory, wallets, ledger entries, refunds, shipments, service records, e-book records/files or historical payment documents were deleted by this work.

The dedicated `backend/scripts/migrateAtlasCheckoutIndexes.mjs` requires `--apply`, exact test-target confirmation and the pinned fingerprint, permits only the reviewed development Atlas target and MongoDB major version 8, preflights both collections, saves index metadata privately, and compares every unrelated index after migration. It never runs on application startup. The older loopback-only script's remote guard remains unchanged. Metadata backup: ignored `backend/private-data/maintenance/checkout-indexes-*.json`; this contains index definitions, not customer documents or credentials.

## Real browser and running backend

`backend/scripts/verifyCheckoutBrowser.mjs` starts the **normal `node index.js` backend entrypoint**, actual Express routing/JWT/OTP authentication, genuine Mongoose models and an isolated local MongoDB 7.0.14 replica set. A fresh headless Chrome session at 390 x 844 loads the built storefront. A test transport proxy routes API traffic to that local backend, so no request can create a production/Atlas checkout. API responses are not mocked. OTP, push, maps and external delivery integrations are explicitly in fixture/mock mode; no real customer identity or gateway charge is used.

Both remembered Shop All (`POST /api/orders`) and no-remembered-storefront (`POST /api/orders/unified`) were exercised. Verified:

- COD returned 201 and displayed the confirmation screen.
- Exactly one order and its linked payment persisted; stock decreased from 10 to 9 and the cart emptied.
- Same-user/same-key replay returned the existing order without another payment or stock deduction.
- The customer opened order history from confirmation and still saw the order after page refresh.
- Authenticated seller and admin order lists included the order.
- Seller accepted, prepared, chose internal delivery and dispatched through existing HTTP endpoints.
- No startup/index errors or uncaught browser exceptions occurred in passing runs.

Screenshots are not used as persistence proof: assertions query the actual isolated database and API. Sanitized reports are written under ignored `test-artifacts/checkout/browser-single.json` and `browser-neutral.json`. Test fixture databases/processes are cleaned up; no Atlas user/catalog fixtures were created. Browser checks establish processing through dispatch, not a completed rider handover/customer-delivery session. No real Android/iOS device was used.

The original local development backend on `localhost:5050` reloaded under its existing nodemon watcher after source changes. A duplicate startup attempt encountered EADDRINUSE; only that duplicate watcher was stopped, preserving the original. The original server returned health 200 and 401 for unauthenticated order creation/status recovery. Startup connected to the configured Atlas cluster; no checkout index initialization failure was observed. The authorized Atlas migration, rather than a server restart, changed the obsolete indexes. No production release was performed.

## Regression coverage and results

Existing real replica-set tests cover fresh COD/online checkout, unrelated E11000 classification, same-key replay, lost responses/commit acknowledgement, owner-scoped recovery, schema/index uniqueness, seller acceptance/rejection, provider locks/reconciliation, unchanged customer delivery charges and Quick Commerce restrictions. Rollback after order insertion is now exercised separately for COD, wallet and online: orders, payments, checkout claim, stock and wallet ledger/balance revert; subsequent same-key success creates one result. Frontend tests cover the newly reproduced channel mismatch and retain uncertain-response/key recovery tests.

| Command / scope | Actual result |
| --- | --- |
| Backend focused: `npm test -- --runInBand __tests__/api/seller-first-checkout.http.test.js __tests__/api/checkout-workflow.http.test.js __tests__/api/razorpay-webhook.http.test.js` | 3 suites, 53 passed, 0 failed |
| Backend full: `npm test -- --runInBand` | 50 suites passed; 402 passed, 7 skipped, 0 failed (409 total) |
| Frontend focused: `npm run test:checkout` | 16 passed, 0 failed |
| Frontend: `node --test --test-concurrency=1 scripts/checkout-ui.test.mjs scripts/auth-role.test.mjs scripts/service-ui.test.mjs scripts/image-search-ui.test.mjs scripts/socket-ui.test.mjs` | 78 passed, 0 failed, 0 skipped |
| `node scripts/verifyCheckoutBrowser.mjs --remembered-shop-all` in backend | Passed, genuine single-channel browser/HTTP/database workflow |
| `node scripts/verifyCheckoutBrowser.mjs` in backend | Passed, genuine neutral-route browser/HTTP/database workflow |
| `node scripts/verifyRazorpayTestOrder.mjs --confirm=CREATE_UNPAID_RAZORPAY_TEST_ORDER` in backend | Passed after local mode correction; real test-mode order created, PENDING, no capture |
| Atlas migration dry-run, confirmed apply, read-only final verification | Passed; both replacements verified, canonical/unrelated indexes preserved, zero document writes |
| Backend `npm run build` and `node --check` for new migration/browser/provider scripts | Passed |
| Frontend `npm run build` | Passed; existing large-chunk warning (main JS approximately 1.70 MB) |
| `git diff --check` | Passed; Windows line-ending advisories only |

No lint or typecheck script is configured in either package. All tests above were actually run; the full backend includes existing wallet, auth, cart, seller, delivery, e-book, service-management and marketplace suites. The reported browser scenarios each passed with the final link-integrity assertions and admin visibility checks. The final single-case rerun passed after instrumentation; the intermediate unclassified assertion is retained below as a verification limitation rather than presented as an independently diagnosed defect.

## Files changed in this task

| Path | Purpose |
| --- | --- |
| `backend/scripts/migrateAtlasCheckoutIndexes.mjs` | New pinned, explicitly authorized index-only Atlas migration |
| `backend/scripts/inspectCheckoutDatabase.mjs` | Read-only version/fingerprint, unique definitions and aggregate duplicate/null/status evidence |
| `backend/scripts/verifyCheckoutBrowser.mjs` | New genuine browser/backend/database fixture workflow and persistence assertions |
| `backend/scripts/verifyRazorpayTestOrder.mjs` | New explicitly confirmed unpaid test-mode provider probe; no MongoDB access |
| `backend/__tests__/api/seller-first-checkout.http.test.js` | Extend post-insertion rollback assertions to wallet and online payments |
| `backend/.gitignore` | Exclude private index metadata backups |
| `backend/.env` (ignored) | Align local gateway/mode with existing test credentials; secrets unchanged |
| `forntend/src/modules/User/pages/CheckoutPage.jsx` | Submit the displayed basket when its only group differs from the restored channel |
| `forntend/scripts/checkout-ui.test.mjs` | Regression for a neutral URL with a Quick-restored/e-commerce-only basket |
| `CHECKOUT_DATA_CONFLICT.md`, `CHECKOUT_END_TO_END.md` | Historical status update and this final evidence report |

Earlier worktree changes, authentication, payment signatures, seller-first delivery, Shiprocket policy/confirmation requirements, Quick Commerce restrictions, historical payment readers and private e-book/service storage were preserved. No deployment was performed.

## Boundaries and operational notes

Atlas index migration and final index inspection actually ran. Browser order creation/persistence ran in isolated local fixtures; no authenticated checkout was placed against `bulkimart` on Atlas. The real Razorpay **test-order creation/status lookup** ran, but a real sandbox card/UPI capture and provider-generated signed callback were not completed. Automated signature/webhook tests remain required evidence for the verification rules, not proof of a real payment capture. No live Shiprocket shipment, real rider handover, real-device test or production checkout was performed.

Earlier browser attempts exposed harness CORS preflight errors, the actual storefront/cart mismatch and one intermediate unclassified assertion. The transport harness was corrected and instrumented; subsequent complete runs and the deterministic channel regression provide the reported passing evidence. The seven skipped backend tests are not claimed as passed. Deployment storage/backup prerequisites from other feature reports remain unchanged.

No new environment variables are needed for checkout. The Atlas migration is a completed one-time operation, not a recurring startup step. For this test environment retain the existing keys with `PAYMENT_GATEWAY=razorpay` and `RAZORPAY_MODE=test`. Production credentials/modes require their own authorized configuration/release. Do not recreate the obsolete full-field indexes as a rollback: current valid records omit those fields, so doing so reinstates the conflict or fails. Roll back application changes independently while retaining verified uniqueness for present legacy IDs and all canonical constraints.
