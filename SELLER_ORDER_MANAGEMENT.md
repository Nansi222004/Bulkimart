# Seller order details and fulfillment

## Findings and implemented behavior

The old Orders UI duplicated `vendorTransitions` and labeled every pre-dispatch cancellation as **Reject**, including accepted/preparing orders. The backend intentionally permits cancellation until hand-off and already restores stock/payment/wallet through `cancelOrderAndRestore`. That operation is preserved and now called **Cancel order** after acceptance; it is not silently removed.

Order details omitted the store pickup, assigned rider, price breakdown, SKU/variant, shipment metadata and usable timeline. The API lacked a permitted-action contract, and the UI guessed carrier behavior from the storefront. Delivery selection and preparation readiness were conflated. Seller status writes could also globally change historical multi-store orders even though fulfillment already refused such operations.

The API now returns `permittedActions`, `version`, `displayStatus`, own-item details, customer delivery snapshot, own-store pickup details, safe assignment data and pricing for single-store orders. Cards and details fail closed when actions are absent. Multi-store items remain filtered and full-basket pricing remains withheld; global mutations require platform support. Rider detail lookup verifies the Delivery record belongs to that order and never returns OTP values, identity documents or bank details.

For seller-first orders, `ready_for_pickup` is a validated status API action recording `fulfillment.readyAt` and a timeline entry while keeping the existing order enum `preparing`. This avoids changing rider/customer/admin state-machine contracts. Readiness is versioned and idempotent. Delivery selection requires readiness for modern orders. Manual selection uses atomic state/version/method predicates and is idempotent; sellers cannot submit a rider ID. Existing historical fulfillment paths remain compatible.

Internal `dispatched` already meant **ready for riders to claim**, rather than physical pickup. The seller now sees **Awaiting rider acceptance**, then **Delivery assigned**. Actual pickup/progress/completion still belong to the authorized rider workflow. The browser regression exercised real local rider acceptance and duplicate-claim rejection.

## State/action matrix

All actions additionally require approved seller ownership, payment readiness where applicable, current state/version and no conflicting shipment/assignment lock.

| Order stage | Seller actions |
| --- | --- |
| New/placed | Accept after payment verification (COD needs no online verification); Reject with reason |
| Confirmed/accepted | Start preparing; Cancel order through the existing stock/refund path |
| Preparing, modern seller-first order | Ready for pickup; Cancel order |
| Ready (`preparing` + `fulfillment.readyAt`) | Choose eligible delivery; Cancel while unassigned/unlocked |
| Manual selected, before offer | Offer to Bulkimart riders; Cancel while unassigned/unlocked |
| Internal ready/dispatched | Await rider acceptance; seller cannot mark out-for-delivery or delivered |
| Rider assigned/in transit | Show rider and delivery status; progression remains rider-controlled |
| Shiprocket waybill confirmed | Confirm courier hand-off using persisted provider references; cancellation blocked |
| Courier dispatched | Out for delivery under the existing authorized seller-reporting policy |
| Courier out for delivery | Mark delivered under that same existing policy |
| Delivered/cancelled/returned/refunded | No seller forward-workflow mutations |
| Provider creating/assigning/reconciliation required | No seller mutations; refresh/contact platform support |

Legacy courier orders retain their existing manual courier/waybill hand-off form. Modern seller-first courier orders require persisted provider order, shipment, AWB and courier references and cannot replace these with browser-entered identifiers. Existing tracking URLs and genuine provider status are preserved at hand-off. Legacy confirmed-but-unaccepted orders retain explicit acceptance before preparation.

## Details and delivery UI

The responsive, scrollable deep-link modal now includes order number/reference, placed time, channel, status, payment method/state, recorded price components, cancellation reason, customer name/contact/address/instructions, copy-address action, item images/SKU/variant/quantity/unit price/line total/messages, store contact/pickup, timeline, and assigned rider name/contact/status/time. The existing Refresh details action fetches the latest authorized record.

Before manual selection the view shows real on-duty rider candidates with masked contact and capacity checks. E-commerce candidates are bounded by the existing maximum geo-offer radius. Quick retains internal-rider restrictions. This is an availability snapshot, not a reservation or a claim of live socket presence. Riders accept offers; the seller cannot select a named rider. Empty availability provides refresh/retry guidance.

Before courier creation, store pickup and customer destination are separate. Weight comes from item snapshots. Dimensions must each be greater than 0.5cm and at most 500cm. Existing customer charges remain fixed and increased courier quotes still require renewed confirmation. Missing pickup links point sellers to existing support; enabling/linking remains an authorized admin operation.

The provider pickup listing is checked against the admin-configured location name and store postcode, rejecting explicitly inactive/unverified records. The configured pickup is used in the provider request and its verified address is recorded with parcel dimensions/weight. The code never substitutes the customer address as pickup. Unknown/provider-error responses fail closed before shipment creation.

After creation the view shows returned shipment/AWB/courier/status, recorded pickup/destination/package, creation/pickup/tracking times, HTTPS label/tracking links and safe errors. Uncertain outcomes stay locked for platform reconciliation instead of creating a duplicate. Successful readiness/manual selection/provider creation append timeline records. The existing shipment lock and quote/financial policies remain intact.

The existing Shiprocket service/auth paths used `/api/v1/external`; the documented provider paths use `/v1/external`. Corrected the service/auth URLs and bounded authentication with a 15-second timeout. References: [Shiprocket API](https://apidocs.shiprocket.in/?version=latest), [official pickup-list request](https://www.postman.com/shiprocketdev/shiprocket-dev-s-public-workspace/request/vtmfoba/get-all-pickup-locations). Custom proxy base URLs must be checked in staging before rollout.

## Files changed for this task

- `backend/services/sellerOrderActions.service.js`: new server action contract and shipment-lock helper.
- `backend/controllers/seller.controller.js`: enriched seller detail/list projection, current version checks, readiness action, multi-store mutation guard, cancellation/managed-courier protections.
- `backend/controllers/fulfillment.controller.js`: readiness gate, real rider candidate projection, automatic rider-acceptance semantics, provider pickup verification, bounded parcel validation, stored pickup/package and audit/idempotency handling.
- `backend/models/Order.js`: additive optional readiness, pickup snapshot and parcel fields; no index changes.
- `backend/services/shiprocket.service.js`, `backend/config/shiprocket.js`: pickup verification, documented API paths and auth timeout.
- `forntend/src/modules/Seller/components/OrdersTab.jsx`: server actions, readiness/fulfillment UI, fresh detail reopening, sensible cancellation label and parcel validation.
- `forntend/src/modules/Seller/components/orderDetailSections.jsx`: new pure presentation of comprehensive authorized details; safe external links and address copying.
- `forntend/src/modules/Seller/Seller.css`: responsive details grid, bounded modal and item layouts.
- `backend/__tests__/api/seller-first-checkout.http.test.js`: readiness/version/idempotency, concurrent manual selection, invalid seller-supplied rider IDs, pickup failures, package constraints, recorded shipment data, safe assigned-rider detail and 24-case forbidden late-state mutation matrix.
- `backend/__tests__/api/seller-order-lifecycle.http.test.js`: single-store mutation fixtures and explicit multi-store refusal.
- `backend/__tests__/services/seller-order-actions.test.js`: action/state/carrier/payment/lock matrix.
- `backend/__tests__/services/shiprocket-pickup.test.js`: official paths, configured pickup matching, provider failures and unverified/mismatched pickup denial without network access.
- `forntend/scripts/seller-notifications.test.mjs`, `forntend/scripts/checkout-ui.test.mjs`: server-action fixtures, detail sections, assigned rider, safe URLs and pickup/destination separation.
- `backend/scripts/verifySellerNotificationsBrowser.mjs`: isolated real-browser preparation/ready/manual offer/rider acceptance, duplicate refusal, updated details and 390/1280px geometry checks.
- `.gitignore`, `backend/.gitignore`: narrowly retain the new/updated regression files while preserving existing rules.
- `SELLER_ORDER_MANAGEMENT.md`: this report.

## Verification and limitations

- Full backend: `npm test -- --runInBand` — 52 suites, 428 passed, 7 skipped, 0 failed (435 total).
- Focused actual order API suite: 42 passed, including the 24-case late-state mutation matrix within one test.
- Frontend: `node --test --test-concurrency=1 scripts/auth-role.test.mjs scripts/seller-notifications.test.mjs scripts/checkout-ui.test.mjs scripts/socket-ui.test.mjs scripts/service-ui.test.mjs scripts/image-search-ui.test.mjs` — 100 passed, 0 failed, 0 skipped. Seller notifications/details subset: 19 passed; checkout subset: 16 passed.
- Backend and frontend `npm run build`: passed. Existing Vite large-chunk warning remains (main JS approximately 1.71 MB minified). No lint script is configured.
- Real headless Chrome + actual Express/JWT/Mongoose/Socket.IO + disposable local replica set: passed customer/seller login isolation, new-order popup/deep links, preparation, readiness, delivery selection, candidate display, manual offer, authorized rider acceptance, duplicate refusal and fresh assigned-rider detail. Details fit 390px and 1280px without horizontal overflow. OTP, maps and external push/shipping remain mocked.
- Initial expanded runs exposed outdated frontend action fixtures and a mock multi-store mutation expectation; those were updated to the server contract/security boundary. A later unit fixture omitted its modern assignment policy during the compatibility check; corrected. Final complete frontend/backend results above passed.

Live Shiprocket credentials, pickup eligibility, serviceability, booking, labels, tracking webhooks and actual delivery were **not verified**. No real Android/iOS device tests were performed. Genuine courier invoice and file/photo proof-of-delivery are not provided by the current integration; links appear only for recorded values and internal delivery shows only existing OTP-verification evidence. Automatic provider reconciliation and label/pickup repair endpoints are not available here; uncertain outcomes require authorized platform support and stay locked. No fake live AWBs, rider names, statuses or counts were added.

Deployment needs the existing Shiprocket credentials/webhook configuration and the admin-approved pickup link. No environment files/credentials, payment/refund policies, PhonePe records, checkout idempotency/index migration or unrelated service/e-book behavior were changed. No database reset, Atlas writes, production orders, deletion or deployment was performed. Existing unrelated dirty worktree changes were preserved.
