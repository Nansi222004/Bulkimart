# Parcel pricing, driver earnings and cash payer

Implemented and verified locally on 25 October 2026. No deployment, shared production policy save, real booking, live payment, payout or provider asset write was performed.

## Admin controls and calculations

Open **Admin → Parcel Deliveries → Fare and driver settings** (`/admin/parcel-delivery`). **Customer delivery charges** controls the starting fee, per-kilometre fee, minimum, maximum and inclusive tax rate. **Driver earnings** separately controls the starting driver earning and per-kilometre earning. Amounts are entered in rupees and stored as integer paise.

The existing authoritative `parcelFare` calculation is unchanged:

- Route metres = route kilometres × 1000, rounded up to a whole metre.
- Distance charge = route metres × per-kilometre charge / 1000, rounded up to a paisa.
- Customer fee = the larger of the minimum fee and starting fee + distance charge. A fee above the configured maximum, an unsupported route or an earning above the fee net of tax rejects the quote.
- Driver earning = starting driver earning + route metres × driver rate / 1000, with the distance component rounded up to a paisa.
- Included tax = customer fee × tax basis points / (10000 + tax basis points), rounded to a paisa. It is already within the customer fee, not an extra charge.
- Platform allocation = customer fee − included tax − driver earning.

For the **synthetic 4174 test settings**, a 5.2 km route with ₹10 starting fee and ₹2/km produces **₹20.40**. A ₹5 starting driver earning and ₹1/km produces **₹10.20**. These are illustrative test settings, not a readout of the shared account's private earning configuration. The customer's supplied screenshot explicitly labels its route simulated; its 5.20 km is not a live measured route.

The existing backend computes quotes, snapshots the policy, validates the policy version at confirmation and controls money. The client cannot supply an authoritative fare or driver earning. The amount is visible to the assigned driver and Admin; driver offers also display the offered earning. Earnings are posted only after verified delivery and remain held under the existing finance controls. Collecting cash does not release an earning or authorize a payout. The existing parcel payout adapter remains release-blocked.

## Pickup or drop cash collection

The new **Cash collection location** admin setting has three values:

| Admin choice | Stored policy value | Customer experience |
| --- | --- | --- |
| Drop only · recipient pays | `delivery` | Drop is selected; pickup is unavailable |
| Pickup only · sender pays | `pickup` | Pickup is selected; drop is unavailable |
| Customer chooses pickup or drop | `customer_choice` | Both choices are available |

These options apply only to eligible cash bookings after a successful policy save. The existing cash category/enablement rules still apply. Update the customer-facing terms to match the collection rule. Existing policies retain `delivery`; the implementation does not silently enable pickup on them.

On the fare review screen, select **Cash to delivery partner**, then **Pay at → Pickup · sender pays** or **Drop · recipient pays**. Changing the payment method or collection point requires accepting the terms again. Online Razorpay payment remains before assignment and has no pickup/drop cash selection. Only the delivery fee is collected, not the value of the parcel.

The driver sees the frozen collection point and the amount. For pickup payment, **Record exact cash received** appears at `arrived_at_pickup`, and pickup proof cannot complete until the exact fee is collected. For drop payment, collection remains at `arrived_at_dropoff`; delivery proof requires the exact fee. Cash cannot be collected again at the other endpoint. The existing assigned-driver authorization, proof codes, transaction/version checks, custody ledger, reconciliation, cancellation review and evidence-based cash refund workflow remain enforced. No ledger account or payout release rule was added.

## API and compatibility

- Existing catalogue and quote responses add `cashCollectionPoints`, derived from the saved/snapshotted policy. The catalogue retains `cashCollectionPoint` as before.
- Existing booking creation accepts optional `cashCollectionPoint: pickup|delivery` for `pay_driver`. The server rejects unsupported points, points prohibited by the policy and cash options submitted for online payment.
- The chosen point is saved under the existing mixed `cash.collectionPoint` field and returned as `cashCollectionPoint` in the existing customer/Admin/driver DTOs. No new collection, schema migration, index or endpoint is required.
- Missing collection points on old bookings and requests mean `delivery`. Legacy online/drop idempotency hashes are preserved; pickup is part of the booking hash. Reusing an identity with a changed cash point fails. A second booking cannot be created from the same quote.
- The chosen point is retained in the existing account-scoped draft and frozen retry payload. Pending confirmation displays the original point even if the current policy changes. A quote refresh uses the new server-supplied allowed points; the server still rejects stale policy versions.

## Mobile fix

The screenshot's letter-by-letter payment labels were caused by the general full-width text-input rule also matching radio inputs. That rule now excludes radios. Radios and checkboxes have fixed 18px dimensions; labels use the remaining width and retain accessible native controls. Actual browser assertions check readable labels, compact radio dimensions and no horizontal overflow at 320, 390, 768 and 1440px.

## Safe local testing

The isolated helper was restarted and the actual Admin form saved `customer_choice` and matching synthetic terms, together with the prior synthetic coverage. All other local fare, tax, earning and matching settings were preserved. The disposable policy is version 2. It uses simulated geography/routes and has no production connection or Google browser key.

1. Open http://127.0.0.1:4174/__parcel-test/start to establish synthetic local sessions.
2. Admin: http://127.0.0.1:4174/admin/parcel-delivery.
3. Customer: http://127.0.0.1:4174/parcel-delivery/book. Choose the saved test locations, enter a documents parcel within the shown limits, calculate a quote and review the cash options.

No booking was created in the manual 4174 instance. Its data lasts only while the helper runs. After restarting `npm run test:parcel-local`, run `node verification/parcel-local-areas-browser.mjs --cash-choice` to reapply only the synthetic policy through the real Admin UI. See [parcel-local-testing.md](parcel-local-testing.md) for lifecycle and isolation details.

A read-only shared catalogue check during this work returned policy **version 3**, cash collection **delivery**, Indore pincodes **452015 and 452006**. This differs from the previously observed version 2; this task did not submit any shared policy mutation. Port 4173 continues to use the shared backend and will keep pickup unavailable until an authorized administrator intentionally changes its policy. No change there is implied by the local 4174 test.

## Verification

| Executed check | Actual result |
| --- | --- |
| Backend `npm run test:parcel` | **108 passed**, 0 failed, 3 suites |
| Frontend `npm run test:parcel` | **103 passed**, 0 failed |
| Backend financial-workflow/payment-notifications/fcm-auth verification suites | **156 passed**, 0 failed, 3 suites |
| Frontend auth-role/checkout-ui/portal-startup/delivery-assignment/delivery-registration/payment-ui/razorpay-overlay/financial-workflow-ui | **149 passed**, 0 failed |
| `node verification/parcel-journey-browser.mjs` | **18 checks passed**, 0 failures; actual local API, one synthetic booking in its own disposable database, external Maps responses simulated |
| `node verification/parcel-delivery-browser.mjs` | **35 responsive views**, 2 customer payment paths, 2 driver lifecycles (pickup/drop), manual fallback and error recovery passed; API/payment fixtures, zero real gateway calls |
| `node verification/parcel-local-areas-browser.mjs --cash-choice` | Actual isolated Admin save/history, selected pickup option, coverage map lifecycle and customer quote passed; zero bookings and zero unexpected browser errors |
| Frontend and backend production builds | Both passed; existing frontend large-chunk warning |
| `git diff --check` | Passed |

The first optional Admin test run failed before saving because its test driver's textarea selector was invalid; the selector was corrected and the complete run passed. That diagnostic is retained as `test-artifacts/parcel-pay-at-admin-browser-failed-selector.log`. No assertion was weakened. The full unrelated backend suite was not rerun for this focused change; the previously recorded six baseline failing suites are not claimed fixed.

Evidence: `test-artifacts/parcel-pay-at-{backend,frontend,financial-regression,ui-regression,journey-browser,driver-browser,admin-browser,frontend-build,backend-build}.log`, `test-artifacts/parcel-journey/results.json`, `payment-pickup-390.png` in that directory, `test-artifacts/parcel-browser-results.json`, and `test-artifacts/parcel-local-areas/results.json`. No live Maps route, physical GPS or real provider payment was exercised by these new cash checks.

## Files changed in this follow-up

`backend/services/parcelPolicy.service.js`, `backend/services/parcelWorkflow.service.js`, `backend/controllers/parcelDelivery.controller.js`, `backend/verification/parcel-delivery.test.js`, `backend/verification/parcel-journey-server.mjs`, `forntend/src/components/parcels/ParcelBookingFlow.jsx`, `parcelJourney.js`, `ParcelPolicyEditor.jsx`, `ParcelOperations.jsx`, `ParcelDelivery.jsx`, `parcels.css`, `forntend/verification/parcel-journey-ui.test.mjs`, `parcel-location-ui.test.mjs`, `parcel-journey-browser.mjs`, `parcel-delivery-browser.mjs`, `parcel-local-areas-browser.mjs`, and this guide. Earlier dirty changes were preserved. No environment, shopping payment/order/escrow, commission or settlement implementation file was changed for this follow-up.

## Immediate Razorpay checkout follow-up

The original new-booking callback navigated to tracking and required a second **Pay online** click. Its “Payment is confirmed only after server verification” text described the confirmation rule; it was not a verification request that the customer needed to complete separately. Two component regressions reproduced the missing immediate payment-init request before the change.

The final online action is now **Book & Pay**. Once the existing booking API confirms creation and the owned tracking record is loaded, the component automatically calls its existing payment-init endpoint and the shared Razorpay Checkout helper exactly once. Selecting the online radio by itself does not create a booking or initiate payment. Existing tracking links and refreshes do not open checkout automatically. Dismissal preserves the pending booking and manual retry; an initialization error remains visible and the same payment attempt key is reused. The tracking text now explains secure Razorpay checkout and shows a progress state while busy.

A separate loader test confirmed that a rejected SDK-load promise was permanently cached, preventing a fresh script request on retry. The shared loader now shares only an in-flight request, clears completed/failed load state, validates that the SDK constructor exists, removes failed script elements and times out a stalled script after 15 seconds. Server verification, provider callback handling, payment signatures, paid-state checks and backend financial services were not changed. The screenshot's grey backdrop alone cannot establish whether the customer's provider iframe was stalled or blocked; no claim is made that this particular third-party frame failure was reproduced live.

Final executed checks:

- Frontend parcel suite: **106 passed, 0 failed**, including automatic opening, no repeat opening, existing booking visits and initialization-error retry.
- Frontend auth/checkout/startup/delivery/payment/financial regression command from the table above: **151 passed, 0 failed**. This includes **6** shared Razorpay helper tests (also run separately, 6 passed) covering trusted verification, callback races, failure, SDK-load retry and timeout recovery.
- Parcel browser fixture matrix: **35 responsive views**, **2 payment paths**, automatic online checkout without a second Pay click, cancellation/initialization-error retry, **2 driver lifecycles**, manual assignment and history error recovery passed. There were **2 mocked payment verifications and zero real gateway calls**.
- Frontend production build passed with the existing large-chunk warning. Backend production build passed. `git diff --check` passed. Backend unit suites were not rerun for this frontend-only follow-up; the earlier backend results above remain historical.

Early regression runs exposed a completed-loader cache state carried between isolated test windows; the loader was corrected and the full regression command rerun. A cancellation assertion was also synchronized with the component's actual tracking refresh before checking the preserved notice. Diagnostic failures are retained; only final complete runs are reported as passing. Browser payment checks use an explicit SDK/API fixture and do not verify live Razorpay modal rendering, key validity, provider order creation or a real payment. No production configuration, shared database record, real booking or provider payment was changed.

Files changed for this follow-up: `forntend/src/components/parcels/ParcelDelivery.jsx`, `ParcelBookingFlow.jsx`, `forntend/src/utils/razorpayCheckout.js`, `forntend/verification/parcel-read-ui.test.mjs`, `parcel-delivery-browser.mjs`, `parcel-browser-entry.jsx`, `razorpay-overlay.test.mjs`, and this guide. Evidence: `test-artifacts/parcel-checkout-before-fix.log`, `parcel-checkout-loader-before-fix.log`, `parcel-checkout-frontend.log`, `parcel-checkout-regression-final.log`, `parcel-checkout-loader-final.log`, `parcel-checkout-browser.log`, `parcel-checkout-build-final.log`, `parcel-checkout-backend-build.log`, and `parcel-browser-results.json`.
