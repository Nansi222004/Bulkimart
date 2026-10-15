# Seller Shiprocket pickup synchronization

Implemented locally on 2026-10-16. No deployment, Atlas changes, real Shiprocket registration, database deletion or payment/index migration was performed.

## Behavior and existing integration

Previously, fulfillment could verify an administrator-linked pickup location, but onboarding did not register the saved store address with Shiprocket. The implementation reuses the existing backend Shiprocket authentication/client, Seller store profile, seller-session middleware, fulfillment validation and 30-second order sweeper.

Saving onboarding step 1, submitting the seller application, or saving the store profile now queues pickup synchronization after the seller save succeeds. Provider calls run in the sweeper, so a provider outage does not fail an otherwise valid registration. Login, profile reads and checkout do not create pickup locations.

The provider operations are `GET /v1/external/settings/company/pickup` and `POST /v1/external/settings/company/addpickup`. The normalized request includes the saved store/contact name, email, phone, street address, city, state, postal code and country. A valid pickup email is now collected during onboarding and can be corrected in the seller profile. Missing/invalid information is shown as Needs attention without making a provider request.

A creation acknowledgement alone never establishes success. The worker reads the provider listing and verifies the location ID, location name, full normalized contact/address fields, active status (`status: 2`) and phone verification (`phone_verified: 1`). Only then does it persist Registered. Provider verification requirements may need action in the Shiprocket account; this feature does not bypass those requirements.

Provider references: [Shiprocket API documentation](https://apidocs.shiprocket.in/?version=latest), [Shiprocket's pickup-location listing](https://www.postman.com/shiprocketdev/shiprocket-dev-s-public-workspace/request/vtmfoba/get-all-pickup-locations).

## State, retries and address changes

`Seller.storeDetails.email` stores the pickup contact email. `Seller.pickupSync` stores status, normalized-address fingerprint, deterministic location name, provider ID, attempt count, next retry, worker lease/operation ID, creation intent, confirmation time, sanitized error, verification mode and prior reference history. A nonunique `(pickupSync.status, pickupSync.nextAttemptAt)` index supports due-job lookup. No checkout indexes were changed.

The durable worker processes at most five sellers per sweep, uses a 90-second MongoDB lease and limits a cycle to five attempts with exponential backoff starting at one minute. Expired leases are recoverable. Compare-and-set checks prevent old workers from confirming an obsolete address or overwriting a completed synchronization. Failures contain static, safe explanations rather than provider payloads or credentials.

The location name combines the full Seller ID and an address/contact fingerprint within the provider's 36-character limit. Workers list existing locations before creating one. They can reuse the deterministic location or an already-linked/history-associated location only when all required fields match. They never adopt an arbitrary other store's matching address.

Creation intent is persisted before POST. If the response is lost, subsequent attempts reconcile the provider listing instead of blindly repeating POST. Repeated events, concurrent workers and explicit retries therefore do not create another location for that uncertain operation. If the provider never confirms the result, retries stop and the seller sees Needs attention. An operator must investigate; this also conservatively covers a crash between recording intent and sending the request.

Meaningful saved contact/address changes invalidate the current registration and queue a versioned location. The old provider reference remains in history and existing shipments retain their own recorded reference. Returning to an earlier address preserves any earlier uncertain creation intent. No unsupported provider address-edit API is assumed.

`GET /api/sellers/pickup-sync` returns the authenticated seller's safe status. `POST /api/sellers/pickup-sync/retry` accepts an empty body, uses only the authenticated seller's saved profile and respects active/backoff state. It also supports explicit rechecking of a Registered location. Seller IDs/address overrides are rejected. Rejected/suspended sellers cannot use these operations.

The seller profile shows Registered, Pending or Needs attention, confirmation time, retry timing, refresh/retry/recheck controls and an address/contact correction form. Pending is not represented as successful registration.

## Fulfillment policy

Managed Shiprocket shipments require the current confirmed pickup ID/address and the existing independent administrator-controlled shipping approval. Registration never sets `thirdPartyFulfillment.enabled`. Existing administrator-linked legacy pickups still undergo provider verification. Shipments already created keep their recorded pickup reference after later address changes.

Manual Bulkimart delivery remains independent. Quick Commerce restrictions, parcel validation, customer delivery charges, seller estimate reconfirmation, shipment locks and uncertain-shipment reconciliation remain in place.

## Existing sellers and operations

From `backend`, the maintenance tool defaults to reporting only:

```powershell
node scripts/syncSellerPickups.mjs --database=EXPECTED_DATABASE --limit=25
node scripts/syncSellerPickups.mjs --database=EXPECTED_DATABASE --seller=SELLER_OBJECT_ID
```

For an approved synchronization operation, add `--apply`. Use `--after=LAST_OBJECT_ID` with the reported `nextAfter` cursor for bounded batches. The limit is 1–100. The connected database name must exactly match `--database`. Production apply additionally requires an approved maintenance window and `--approved-production-maintenance`. This flag is an operator acknowledgement, not deployment authorization. Apply can create remote pickup locations; review the dry run first. No deletes, approval changes or broad database/index synchronization are performed.

The existing runtime needs `MONGO_URI`, `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD` and `SHIPROCKET_WEBHOOK_SECRET` under its existing integration configuration. `SHIPROCKET_BASE_URL` remains an optional existing override. `SHIPROCKET_MODE=mock` is only for explicitly isolated tests; mock confirmations cannot authorize live-mode managed shipments. Credentials stay on the backend. The backend sweeper must remain running. Where automatic index creation is disabled, provision the new nonunique Seller lookup index during the approved rollout.

If saving the durable queue itself fails after the seller save, onboarding remains successful and logs only a static scheduling warning. Profile retry or controlled maintenance repairs that missed scheduling; no system can durably enqueue during a database outage. After rollout, review existing eligible sellers through the dry-run tool before applying bounded batches.

## Files for this task

| Files | Purpose |
| --- | --- |
| `backend/models/Seller.js` | Pickup email, durable sync state/history and worker index |
| `backend/services/shiprocket.service.js` | Existing client extended with pickup list/create and strict managed-reference verification |
| `backend/services/sellerPickupSync.service.js` | Validation, queue, leases, reconciliation, retries and readiness/status helpers |
| `backend/controllers/seller.controller.js` | Queue after successful onboarding/profile writes; accept pickup email |
| `backend/controllers/sellerPickup.controller.js`, `backend/routes/seller.routes.js` | Owner-scoped status and retry endpoints |
| `backend/services/orderSweeper.service.js` | Process durable jobs using existing timer |
| `backend/controllers/fulfillment.controller.js` | Require confirmed current managed pickup without changing shipping approval |
| `backend/scripts/syncSellerPickups.mjs` | Target-checked, bounded dry-run/apply maintenance |
| `forntend/src/modules/Seller/components/PickupSyncCard.jsx`, `ProfileTab.jsx`, `forntend/src/modules/Seller/Seller.css` | Status, retry, correction and responsive profile layout |
| `forntend/src/modules/Seller/pages/OnboardingPage.jsx`, `forntend/src/modules/Seller/context/SellerContext.jsx` | Collect/send pickup email without persisting it in shared onboarding drafts |
| `forntend/src/modules/Seller/components/OrdersTab.jsx` | Route pickup setup/correction to seller profile |
| `backend/__tests__/api/seller-pickup-sync.http.test.js` | Real model/router tests with isolated MongoDB and mocked provider |
| `backend/__tests__/api/seller-first-checkout.http.test.js`, `backend/__tests__/services/shiprocket-pickup.test.js` | Fulfillment/manual/old-shipment and strict provider verification regressions |
| `forntend/scripts/seller-notifications.test.mjs`, `backend/scripts/verifySellerNotificationsBrowser.mjs` | Actual-component UI and headless-browser profile/worker regression |
| `.gitignore`, `backend/.gitignore` | Narrow exception retaining the new API regression test |

Existing unrelated dirty worktree changes were preserved. A checkout diagnostic test assertion was corrected to exclude an independently checked random request ID from a raw-error-leakage regex: a UUID containing `121` was an intermittent false positive. Checkout application logic was not changed by this task.

## Verification

The isolated API suite covers onboarding, invalid input, sanitized failures, bounded retry, concurrent workers, lost acknowledgements, missing remote outcomes, address changes, legacy-reference adoption, unverified provider records, owner-scoped APIs, stale leases/workers, dry-run maintenance and returning to an uncertain previous address. Fulfillment tests cover pending pickup blocking courier while manual delivery remains available, and existing shipment references surviving address changes.

The headless Chrome integration ran against a disposable local replica set and the explicit mock integration. It queued from the profile, let the real sweeper register the mock pickup, refreshed to Registered and verified shipping approval remained disabled. The correction form fit 390px; existing order-details checks ran at 390px and 1280px, and the existing manual rider flow passed. Atlas writes: zero.

| Command/scope | Actual result |
| --- | --- |
| `cd backend; npm test -- --runInBand` | 53 suites passed; 446 tests passed, 7 skipped, 0 failed; 453 total |
| Focused pickup API suite | 13 passed, also included in the full backend total |
| Focused provider pickup suite | 9 passed, also included in the full backend total |
| `cd forntend; node --test --test-concurrency=1 scripts/auth-role.test.mjs scripts/seller-notifications.test.mjs scripts/checkout-ui.test.mjs scripts/socket-ui.test.mjs scripts/service-ui.test.mjs scripts/image-search-ui.test.mjs` | 102 passed, 0 failed, 0 skipped |
| `cd backend; npm run build` | Passed: syntax check and service-package import/limits check |
| `cd forntend; npm run build` | Passed; main JavaScript bundle approximately 1.71 MB minified |
| `node backend/scripts/verifySellerNotificationsBrowser.mjs` | Passed using headless Chrome, disposable local replica set and explicit mock provider |
| `git diff --check` | Passed; Git reports existing Windows line-ending conversion warnings |

Neither package defines a lint script. These are local tests, not live provider verification. No genuine Shiprocket pickup registration, provider phone verification, production deployment, real-device test or production storage/network test was performed. Complete a controlled real-provider registration and read-back verification before relying on the live integration.
