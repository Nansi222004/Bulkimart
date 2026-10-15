# Seller delivery selection and dedicated order details

Implemented locally on 2026-10-16. No deployment, production/Atlas writes, database resets, checkout-index migration or payment-credential changes were performed.

## Confirmed source findings

The primary order-details experience lived inside `OrdersTab` as a modal, opened through `/seller/orders?order=...`. Delivery controls were in another modal and only opened by the separate server-returned Choose delivery action. Marking a parcel ready refreshed the record but did not automatically expose the choices. For older orders without `fulfillment.assignmentPolicy`, the action mapper instead labeled a direct dispatch transition Ready for pick up, bypassing method selection entirely.
 
The order details now use `/seller/orders/:orderId`. The seller shell follows its existing history-based routing conventions and renders `OrderDetailsPage`. Details, notification clicks and push click targets use that route. Old query-string links still resolve through the authorized API and are normalized to the new route. Initial entry, refresh, browser back/forward and new tabs fetch the current owner-authorized order. Loading/error/retry states do not require a list row or navigation payload. Navigation invalidates obsolete detail responses, and account changes clear detail/list state. Returning to Orders preserves the in-session list search/status filter.

The page reuses the existing detail sections, list action handlers and server-returned permitted actions. After readiness, Choose delivery method is rendered inline automatically, with both Bulkimart and Shiprocket options. Pre-ready orders explain the next readiness step. Older unassigned orders now expose the same explicit readiness/setup actions rather than bypassing the chooser. Existing confirmed courier waybills retain their hand-off action. Customer, item, payment, store, rider, shipment and timeline data come from the authorized detail endpoint.

## Approved partners and operational eligibility

Admin delivery-partner approval and seller dispatch already use the same `DeliveryPartner` collection. Approval updates `DeliveryPartner.status` and grants the linked `User` the delivery role; there is no separate pool to copy approved applications into. `isAvailable` defaults false and is changed by the rider's authenticated duty workflow. Approval alone therefore does not make a partner available.

The source had inconsistent operational checks: the seller availability query and fallback offer queries did not apply the same account, coverage and capacity checks. Also, dispatch required a store GeoJSON point even when valid saved latitude/longitude existed. Older rider profiles with only latitude/longitude could appear available but fail the GeoJSON search.

`riderEligibility.service.js` now supplies shared checks to the seller availability endpoint, actual offer dispatch and acceptance preflight:

- Partner must be approved; its linked User must be active with delivery membership.
- Availability/offer listings require the rider's on-duty flag. Acceptance preserves the existing capacity-based rule, since accepting another job can clear that flag; it still rechecks approval, account eligibility, coverage, radius and capacity.
- If service pincodes are configured, they must include the store pickup or destination pincode, following the existing zone-matching convention. An explicitly out-of-coverage rider is not offered the order through a fallback query.
- E-commerce remains bounded to the existing expanding pickup search: default 5 km, then 10 km, then 15 km, derived from `PICKUP_RADIUS_METERS`. A rider's configured pickup radius is an additional cap.
- Quick retains its existing zone/general on-duty fallback discovery, subject to the same operational safety checks. Third-party Quick shipping remains disabled under the existing policy.
- Existing `canTakeAnother` capacity rules remain authoritative. No new concurrency policy or forced availability is introduced.

Dispatch can derive the store position from valid saved latitude/longitude. For legacy riders without a GeoJSON point it uses a bounded coordinate query followed by exact distance filtering. Candidate batches are capped at 50 and offers remain capped at five. The availability response contains actual eligible rider names, masked contacts, duty state and availability; it does not expose ineligible riders' personal details.

The exact account pictured in the user's admin screenshot was not inspected in production. Its actual duty, account membership, capacity, location and pincode coverage remain unverified. Tests demonstrate each inclusion/exclusion rule with isolated records; they do not establish that the pictured approved account qualifies for that order.

## Delivery workflow and restrictions

| Stage | Seller behavior |
| --- | --- |
| New order | Existing accept/reject actions |
| Accepted | Start preparing |
| Preparing | Mark Ready for pickup; retain existing authorized cancellation policy |
| Ready, method not selected | Inline choices with current rider availability and courier eligibility explanations |
| Manual selected | Offer to Bulkimart riders; no named rider reservation or fake assignment |
| Offered | Await rider acceptance; existing atomic claim prevents duplicate assignments |
| Rider accepted | Show latest authorized rider/contact/assignment data |
| Shiprocket confirmed | Show real recorded courier/AWB/shipment/tracking/label information and supported hand-off action |
| Terminal or shipment reconciliation lock | Existing backend restrictions and immutable/locked actions remain in force |

Shiprocket continues to require current confirmed pickup registration, separate administrator shipping approval, provider configuration/serviceability, accepted/prepared/payment-ready state, item weight, valid package dimensions and seller confirmation of the current estimate. Pickup and customer destination remain separately labeled. Missing registration links to `/seller/profile`; missing approval explains that platform approval is required. Customer checkout charges remain unchanged. Shipment locks, provider reconciliation and estimate-increase reconfirmation are preserved. Manual delivery remains independent of Shiprocket configuration.

Selecting a manual method does not itself assign a rider. Dispatch records offers, and the rider's protected acceptance endpoint claims the order. Retry/refresh does not invent or overwrite assignment state. Sellers still cannot submit a rider ID to bypass acceptance.

## Files changed

| Path | Purpose |
| --- | --- |
| `backend/services/riderEligibility.service.js` | Shared operational eligibility checks |
| `backend/controllers/fulfillment.controller.js` | Use shared eligibility, return duty state and useful method/state/approval explanations |
| `backend/controllers/deliveryPartner.controller.js` | Apply eligibility to offers/claims; bounded legacy-coordinate discovery |
| `backend/services/sellerOrderActions.service.js` | Preserve readiness and chooser for legacy unassigned orders |
| `backend/services/notification.service.js` | Persist dedicated seller order route |
| `forntend/src/modules/Seller/pages/OrderDetailsPage.jsx` | Dedicated page entry reusing existing order UI |
| `forntend/src/modules/Seller/pages/DashboardPage.jsx` | Render the page inside the existing authenticated seller shell |
| `forntend/src/modules/Seller/context/SellerContext.jsx` | Route loading, error/retry, channel restoration, history and list-state preservation |
| `forntend/src/modules/Seller/components/OrdersTab.jsx` | Primary details rendered as page; inline automatic method checks; guarded async eligibility results |
| `forntend/src/modules/Seller/Seller.css` | Responsive page/chooser styles |
| `forntend/public/notification-routing.js` | Push clicks target the dedicated route |
| `backend/__tests__/api/seller-first-checkout.http.test.js` | Real model/API inclusion, exclusion, readiness and method-reason regressions |
| `backend/__tests__/services/seller-order-actions.test.js` | Operational eligibility matrix and legacy-order action regression |
| `forntend/scripts/seller-notifications.test.mjs` | Dedicated route, automatic methods, unavailable recovery, notification/push routing regressions |
| `forntend/scripts/checkout-ui.test.mjs` | Existing confirmed-estimate test adapted to the actual details page |
| `backend/scripts/verifySellerNotificationsBrowser.mjs` | Browser route/refresh/new-tab/responsive/manual-offer regression |

## Verification and rollout limits

| Command / scope | Actual result |
| --- | --- |
| `cd backend; npm test -- --runInBand` | 53 suites passed; 459 passed, 7 skipped, 0 failed; 466 tests total |
| Focused seller action/eligibility suite | 18 passed, 0 failed; included in full total |
| Focused seller-first checkout API suite, including final cross-seller detail/options assertions | 46 passed, 0 failed; same suite included in full total |
| `cd forntend; node --test --test-concurrency=1 scripts/auth-role.test.mjs scripts/seller-notifications.test.mjs scripts/checkout-ui.test.mjs scripts/socket-ui.test.mjs scripts/service-ui.test.mjs scripts/image-search-ui.test.mjs` | 105 passed, 0 failed, 0 skipped |
| `cd backend; npm run build` | Passed: syntax and backend service-package checks |
| `cd forntend; npm run build` | Passed; existing warning for large chunks, main JavaScript approximately 1.71 MB minified |
| `node backend/scripts/verifySellerNotificationsBrowser.mjs` | Passed with headless Chrome, isolated local replica set and explicit mock providers |
| `git diff --check` | Passed; Windows line-ending conversion warnings only |

The full suites include existing checkout, authentication, payments, delivery, Quick Commerce, service and e-book regressions. No lint script exists in either package. The final browser test ran outside the filesystem sandbox because sandboxed Chrome timed out during renderer initialization; it still used only disposable local fixtures. Browser assertions were updated for dedicated URLs, enabled-action waits and the existing uppercase offer-status enum.

Headless Chrome uses genuine local application routes, JWTs, Socket.IO, MongoDB models and a disposable replica set. It verifies new-order popup/notification navigation to the page, fresh status, notification read state, refresh, a separate order tab, seller readiness, actual eligible rider display, manual offers, authenticated acceptance, duplicate-acceptance denial and assigned rider refresh. Page geometry is checked at 390px and 1280px. Provider operations run in explicit mock mode; FCM push transport and real Shiprocket operations are not verified by this test. Real Android/iOS devices and production were not tested.

No new environment variables or database schema changes are required. The deployed frontend server must serve its normal SPA fallback for `/seller/orders/:orderId`, as it does for other seller routes. Publish the updated service-worker helper through the normal approved rollout so new push click targets are used. Existing query-string notification links remain compatible. Check the actual rider duty/coverage/capacity and provider approvals in staging before rollout. No deployment was performed.
