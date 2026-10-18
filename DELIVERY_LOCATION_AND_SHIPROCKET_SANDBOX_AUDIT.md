# Delivery location and Shiprocket test isolation audit

## 1. Root cause and evidence

The reported text originated in the original `backend/controllers/deliveryPartner.controller.js:860`, inside `acceptOrder`. It was triggered when the seller selected from the first order item had `storeDetails.lat === undefined` or `storeDetails.lng === undefined`. The source did **not** distinguish a missing seller, an unpinned store, or a valid GeoJSON-only store pin.

The investigation found multiple concrete defects:

| Path | Previous behavior | Evidence / correction |
| --- | --- | --- |
| Rider broadcast | Selected GeoJSON `storeDetails.point.coordinates` for rider discovery, then built the notification payload from flat lat/lng. | Original controller lines 405–407 and 587 onward disagreed. Current controller lines 399–412 and 587 use the same normalized store. |
| Rider acceptance | Required flat fields even when indexed GeoJSON coordinates existed; checked only `undefined`, accepting null/out-of-range values. | Current `deliveryPartner.controller.js:851` calls `requireOrderPickup`; isolated point-only acceptance and invalid/missing-pin tests pass. |
| Admin assignment | Used the first seller item, required flat fields, and did not validate finite/range values. Queue swallowed pickup errors and showed no eligible riders. | Current `deliveryAssignment.controller.js:17`, `:50`, and `:86` resolve a single actual order store, return an actionable error, and validate both endpoints. |
| Seller dispatch | Could offer an internal delivery without validating its store pin. | `seller.controller.js:886` now blocks internal dispatch without a valid pickup. `fulfillment.controller.js:180` also validates manual selection. |
| Order/store identity | First-item selection could choose an arbitrary store in a multi-store order. | `storePickup.service.js:19` rejects missing or multiple seller identities rather than borrowing another store's coordinates. |
| Active rider delivery | Re-read current store coordinates, which could differ from the accepted delivery snapshot. | `deliveryPartner.controller.js:1910` uses the persisted delivery pickup address and coordinates first. |

**Incident limitation:** no production/customer database was inspected. Therefore this audit proves the field-mapping defect and missing-pin behavior with code and isolated tests; it does not claim which particular live store triggered the user's incident. A store with no real coordinates still needs its actual pin configured by authorized staff. No arbitrary pin or data backfill was applied.

The order does not need a pre-existing geographic pickup snapshot to be accepted: pickup is resolved from its Seller, then saved in `Delivery.pickupLocation`. Rider GPS, customer destination, Seller coordinates, and the Shiprocket registered pickup name are distinct fields. Shiprocket's string pickup-location name cannot satisfy rider geographic validation.

## 2. Correct pickup source and validation

`backend/services/storePickup.service.js` is the shared source resolver:

- All order items must identify one Seller document through `items[].sellerId`. Missing stores and multi-store ambiguity fail with 409.
- Within that Seller, `storeDetails.point` is the indexed geographic pin, with GeoJSON order `[longitude, latitude]`. Legacy flat `storeDetails.lat/lng` remain supported when no point exists.
- Both values must be finite numbers, latitude within -90 to 90 and longitude within -180 to 180. Zero-valued components, including `(0, 0)`, are accepted by this geographic validator. Null, strings, booleans, infinity, NaN, malformed GeoJSON, and out-of-range numbers fail.
- A malformed explicit point fails closed rather than guessing another location. Address, pincode, store name and Seller identity remain attached to that Seller.
- The customer destination is independently validated. Customer and rider coordinates never substitute for a missing pickup pin.

Admin's new `PATCH /api/admin/sellers/:id/pickup-location` saves only flat coordinates, the matching GeoJSON point, location source, and version increment. The Admin router retains `protect, requireAdmin` (`backend/routes/admin.routes.js:68`). Existing address and identity fields are preserved. Seller profile writes retain ownership and approval checks and now reject null/invalid coordinate payloads. No schema migration is required.

## 3. Assignment flow before and after

Seller acceptance, preparation, ready-for-pickup, manual selection, and offering to riders remain separate operations. Quick Commerce, ShopAll, and Wholesale use their existing internal delivery path; Wholesale remains an order sales channel rather than a separate pickup-address source. Same-Day continues to require internal riders. Standard Shiprocket fulfillment stays a separate explicit seller action.

Before assignment now proceeds:

1. Validate order and rider IDs, current order state, internal carrier, absence of active courier creation, rider approval/duty, active delivery membership, coverage/radius and capacity.
2. Resolve the actual store and validate pickup and customer destination. Missing store pins name the store and direct the seller to `/seller/profile`. Admin's queue exposes a pin editor for that exact store and reloads eligibility after saving.
3. Re-read assignment state and revalidate store and rider inside the existing assignment transaction. Reject conflicting concurrent changes. Retries for the same rider return the existing delivery.
4. Save the existing accepted delivery stage, pickup/drop snapshots, rate snapshot, timeline and assignment history. **Order status stays dispatched**; assignment does not mark it shipped or out for delivery. The existing physical pickup transition in `deliveryPartner.controller.js:1225` changes it to out for delivery.
5. Notify the assigned rider once after a newly committed assignment. A `delivery_assigned` socket event restores Active Delivery, rather than presenting an inappropriate second Accept offer. Duplicate requests do not create duplicate deliveries or notifications. A notification failure returns a clear warning that assignment already succeeded and the rider should refresh Active Delivery.

Notification delivery is best effort: this change does not introduce an outbox or automatic push redelivery. A process crash between commit and notification still requires active-delivery restoration. No successful push receipt is claimed.

## 4. Files changed for this task

| File | Precise purpose |
| --- | --- |
| `backend/services/storePickup.service.js` | New shared store identity, coordinate validation, normalization and actionable error resolver. |
| `backend/controllers/deliveryAssignment.controller.js` | Validates actual pickup/drop/rider, exposes queue pickup errors, saves Admin pins, rechecks transaction state, handles concurrent retries and notifies once. |
| `backend/controllers/deliveryPartner.controller.js` | Consistent broadcast/poll/accept coordinates, rejects courier accepts, preserves accepted pickup snapshots, corrects assignment notification wording. |
| `backend/controllers/seller.controller.js` | Validates coordinate writes and blocks unpinned internal dispatch. |
| `backend/controllers/fulfillment.controller.js` | Validates manual pickup, returns safe environment diagnostics, isolates shipment references and webhook environments. |
| `backend/routes/admin.routes.js` | Admin-only pickup editor and credential-free `GET /api/admin/shiprocket/environment` diagnostics. |
| `backend/config/shiprocketEnvironment.js` | New pure environment and endpoint validator; separate credentials with no sandbox fallback. |
| `backend/config/runtime.js` | Validates selected Shiprocket configuration before DB/network startup and applies existing isolated-staging gates to sandbox mode. |
| `backend/config/shiprocket.js` | Environment-specific authentication/token caching; preserves nine-day cache and 15-second timeout; blocks redirects. |
| `backend/services/shiprocket.service.js` | Uses validated endpoints throughout; safe capabilities; no redirects; adds missing tracking timeout and sanitizes error logging. |
| `backend/services/sellerPickupSync.service.js` | Prevents mock/sandbox pickup registration being reused as live provider verification. |
| `backend/models/Order.js` | Optional `shiprocket.environment` marker, without migration or business/financial field changes. |
| `backend/.env.example` | Documents mode choices and separate server-only variables. |
| `forntend/src/modules/Admin/components/DeliveryAssignmentTab.jsx` | Store-specific errors, actual-coordinate editor, eligibility reload and assignment busy guard. |
| `forntend/src/modules/Delivery/context/DeliveryContext.jsx` | Restores the assigned job on the new notification event. |
| `forntend/src/modules/Seller/components/OrdersTab.jsx` | Link to existing store pin editor and visible provider environment. |

Prior Wholesale changes were preserved. No commit, push, deployment, dependency installation, or destructive migration was performed.

## 5. Shiprocket environment findings and configuration

Official sources inspected:

- [Standard API documentation](https://apidocs.shiprocket.in/?version=latest): warns that requests using valid credentials affect real account data.
- [Test documentation portal](https://apidocs-test.shiprocket.in/): documents the standard `https://apiv2.shiprocket.in/v1/external` API. The documentation hostname does not establish an isolated shipping environment.
- [Getting started](https://apidocs-test.shiprocket.in/guides/getting-started/) and [authentication](https://apidocs-test.shiprocket.in/guides/authentication/): account API-user authentication; these do not establish sandbox access for this account.

No separately confirmed sandbox endpoint or account credentials were available. Presence-only inspection of local configuration found development + `SHIPROCKET_MODE=mock`; live credential fields exist but sandbox fields are absent. Credential values were neither displayed nor used. **The local `.env` was left unchanged in mock mode.** No Shiprocket account login or live API request was performed.

| Mode | Required configuration | Behavior |
| --- | --- | --- |
| `mock` | `SHIPROCKET_MODE=mock` | Existing in-process fake provider responses. No HTTP calls, regardless of live credentials present. Optional webhook fixture secret is only for isolated webhook tests. |
| `sandbox` | `SHIPROCKET_SANDBOX_BASE_URL`, `SHIPROCKET_SANDBOX_EMAIL`, `SHIPROCKET_SANDBOX_PASSWORD`, `SHIPROCKET_SANDBOX_WEBHOOK_SECRET`, and `SHIPROCKET_SANDBOX_CONFIRMED=true` | Reserved for a separately provider-confirmed isolated endpoint/account. Missing fields or confirmation fail at startup and service entry. Does not reuse live URL or credentials. |
| `live` | Explicit `SHIPROCKET_MODE=live`, `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_WEBHOOK_SECRET`; optional `SHIPROCKET_BASE_URL=https://apiv2.shiprocket.in` | Standard provider origin only. Custom live endpoint overrides are rejected. |

All network origins must be HTTPS origins without embedded credentials, path, query, or fragment. Sandbox rejects the known live host (including alternate port/trailing-dot spellings) and both documentation hosts. Redirects are disabled, preventing a test endpoint from redirecting a request to live. Token caches are keyed by environment/endpoint/account credentials and never returned to frontend diagnostics.

In production runtime, non-live modes still require the existing independent isolation settings: `DEPLOYMENT_ENV=staging`, `ALLOW_MOCK_SERVICES=true`, `STAGING_DATA_ISOLATED=true`, staging-only `PUBLIC_API_URL`, and staging-only `CORS_ORIGINS`. They cannot attach to live Bulkimart hosts. Startup requires explicit integration modes. No local mode setting was copied to production.

New shipment references retain their environment. Switching environments cannot resume a shipment created in another mode; legacy recognizable mock references are treated as mock. Webhooks select the current environment's secret and cannot update explicitly different-environment shipments. Existing order locks, uncertain-result reconciliation and duplicate-creation prevention remain intact. A timeout during creation requires reconciliation; there is no automatic mutation retry.

## 6. Every outbound Shiprocket call site

All provider traffic is in `backend/config/shiprocket.js` and `backend/services/shiprocket.service.js`; all methods pass through environment validation:

| Operation | External path |
| --- | --- |
| Authentication/token refresh | `POST /v1/external/auth/login` |
| List or verify registered pickup | `GET /v1/external/settings/company/pickup` |
| Register pickup address (also used by background seller pickup sync) | `POST /v1/external/settings/company/addpickup` |
| Serviceability / freight quotes | `GET /v1/external/courier/serviceability/` |
| Create order/shipment | `POST /v1/external/orders/create/adhoc` |
| Courier / AWB assignment | `POST /v1/external/courier/assign/awb` |
| Labels | `POST /v1/external/courier/generate/label` |
| Pickup scheduling | `POST /v1/external/courier/generate/pickup` |
| Tracking | `GET /v1/external/courier/track/awb/:awb` |

Seller fulfillment options can make pickup verification and quote reads. Explicit seller shipment creation performs the mutation sequence. Seller profile pickup synchronization can create provider pickup-address records; it is also isolated by mode. Quick Commerce financial activation reads capabilities/quotes but its existing third-party shipment activation restrictions remain. Webhooks are inbound through `/api/courier-events/webhook`. Admin rider assignment does not invoke any Shiprocket operation.

## 7. Verification results and limitations

**All provider integration tests used mocks. No genuine sandbox has been verified.** Axios was intercepted before every network call in sandbox transport tests, using a synthetic `.invalid` hostname, fixture credentials, and isolated MongoDB. The confirmation flag in those tests is a fixture, not evidence of an approved real account.

| Check | Result |
| --- | --- |
| Relevant backend tests, 11 suites | 268 passed; includes assignment/acceptance, concurrent retries, Admin authorization, invalid/missing/point-only/zero pins, notifications, pickup sync, Shiprocket lifecycle, OTP, runtime modes, inventory, Quick finance, and Wholesale checkout/payment/refund regressions. |
| Shiprocket environment suite, additional final focused run | 22 passed; also included in the broad suite. |
| Relevant frontend tests | 91 passed: assignment UI, seller profile/Wholesale, socket transport, role authentication and checkout. |
| Production frontend build | Passed. Existing large-chunk warning remains. |
| Backend build/package check | Passed. |
| `git diff --check` | Passed. |

Backend command:

```text
npm test -- --runInBand __tests__/api/delivery-location.http.test.js __tests__/api/seller-pickup-sync.http.test.js __tests__/api/seller-order-lifecycle.http.test.js __tests__/services/order-fulfillment-lifecycle.test.js __tests__/services/shiprocket-pickup.test.js __tests__/services/shiprocket-environment.test.js __tests__/config/runtime.test.js __tests__/services/quick-commerce-finance.test.js __tests__/services/inventory.service.test.js __tests__/api/delivery-otp.http.test.js __tests__/api/wholesale.http.test.js
```

Frontend command:

```text
node --test tests/delivery-assignment.test.mjs tests/seller-profile-wholesale.test.mjs tests/socket-ui.test.mjs tests/auth-role.test.mjs tests/checkout-ui.test.mjs
```

New QA sources: `backend/__tests__/api/delivery-location.http.test.js`, `backend/__tests__/services/shiprocket-environment.test.js`, and `forntend/tests/delivery-assignment.test.mjs`. Existing fixture tests were updated for explicit environment configuration and the newly required store pin. These directories are ignored by the repository's existing `.gitignore`; QA sources remain locally available without staging changes. Final logs are under `test-artifacts/delivery-location/` (also ignored).

The requested knowledge-graph tools were unavailable; targeted source searches were used as the documented fallback.

Remaining account-dependent verification requires Shiprocket to confirm an isolated endpoint, API-user credentials, webhook setup, eligible courier/pickup behavior and permitted test operations. Real authentication, provider-issued IDs/AWBs, pickup scheduling, labels and tracking delivery were not exercised. Actual store coordinates must be supplied by authorized staff if missing; no map position can be inferred safely from this report.

## 8. Safety confirmation

No live shipment, AWB, pickup request or pickup-address registration was created. No live payment or production-data mutation was performed. No production customer data was used. Order totals, COD amounts, delivery fees, payout formulas, checkout, inventory deductions and payment logic were not changed. No commit, push or deployment was performed.
