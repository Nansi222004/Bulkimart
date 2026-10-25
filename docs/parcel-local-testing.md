# Parcel service-area testing

For the current fee formula, driver earning calculation, mobile payment layout fix and pickup/drop cash choice, see [Parcel pricing and cash payment](parcel-pricing-and-cash.md). The running 4174 instance now enables customer choice through its synthetic Admin policy; shared settings remain separate.

The user confirmed that the database behind localhost:5050 is shared with production. Its policy was read through the public catalogue only and was **not changed**: version 2, Indore pincode 452015.

The requested test coverage was saved using the **actual Admin form and protected policy API** in a separate full-app instance:

- Start/sign in to the synthetic test accounts: http://127.0.0.1:4174/__parcel-test/start
- Admin: http://127.0.0.1:4174/admin/parcel-delivery
- Customer: http://127.0.0.1:4174/parcel-delivery/book

Use these links with the same 127.0.0.1 host so the isolated login stays available. Port 4173 continues to use the shared database; its area rejection remains intentional.

## What was saved

| Local test area | Pincode | Radius |
| --- | --- | --- |
| Botejhari / Katangjhari — LOCAL TEST | 481332 | 10 km |
| Indore — LOCAL TEST | 452006 | 10 km |

The original synthetic fixture area remains present. The local policy is version 2, with the admin save recorded in policy history. Other local policy fields, including fares, taxes, limits and driver earnings, were preserved.

The admin steps were:

1. Open Parcel Deliveries, then **Fare and driver settings**.
2. Under **Where we deliver**, choose **Add service area**.
3. Enter the area name and pincodes.
4. Search for the centre and choose **Use this location**.
5. Set Radius to 10 km.
6. Add the second area, enter the policy note, then choose **Save parcel settings**.

Approval checks both pincode and distance from the area centre. Adding a pincode alone does not bypass the radius or parcel/route restrictions.

## Try the customer flow

Open the start link once, then the customer link. Choose the supplied saved Botejhari pickup and Indore destination. Fill recipient details, choose documents, and use a synthetic parcel such as 1 kg with 10 × 10 × 10 cm dimensions. Confirm the restrictions, then select **Confirm drop details**.

The browser check reached the service/fare screen with these locations and created **zero bookings**. This instance uses simulated geocoding and routes; its approximate test centres and fares are not a live Google Maps or intercity-service approval. The Google browser key is intentionally absent. Saved locations and the existing address-search fallback are available.

Parcel type, short description, weight, dimensions and restrictions are required by the current backend. The local test limits are 5 kg and 50 cm per side. Weight/dimensions enforce eligibility; the current fare uses base/distance/minimum/inclusive-tax rules and does not add a separate weight charge.

## Isolation and lifetime

This runs the current application and full existing API router against a fresh MongoMemoryReplSet. It does not load backend/.env, copy production users, use real provider credentials or connect to the shared database. Synthetic admin/customer sessions are issued only by the verification helper on loopback port 4174; real auth middleware still validates them.

The instance is running in the background. Its data lasts only while that helper runs. To restart it:

    cd forntend
    npm run test:parcel-local

After a restart, the fresh fixture begins with its original synthetic area. Reapply the requested areas through Admin, or run the isolated browser workflow:

    node verification/parcel-local-areas-browser.mjs

To stop the running disposable instance without affecting 4173/5050:

    Invoke-WebRequest -Method Post http://127.0.0.1:4174/__parcel-test/stop

## Verification and files

- Actual Admin save, optimistic version, policy history and preservation of other settings: passed.
- Customer quote for the supplied areas through the normal full-app shell: passed.
- Mobile layout at 393 × 852: passed.
- Unexpected browser runtime errors: zero.
- Bookings created in the manual instance: zero.
- Existing isolated parcel acceptance after adding optional manual mode: 15 checks passed.
- Shared public policy read-back: unchanged, version 2 / 452015.

Evidence: test-artifacts/parcel-local-areas/results.json, admin-areas.png, customer-quote.png, parcel-local-area-browser.log, parcel-local-default-regression.log and parcel-local-instance.json. Earlier browser-driver attempts failed on setup timing or field selection; no failed attempt is counted as a passed customer check.

The initial isolated setup extended only verification files and the frontend test:parcel-local command. The subsequent local application changes are documented below. Shared production settings remain unchanged.

## Admin coverage map and clearer rejection messages — 25 October 2026

Open **Admin → Parcel Deliveries → Fare and driver settings → Where we deliver**. Each area now uses the existing shared Google Maps loader and parcel picker to show a draggable centre marker and a circle at the configured radius. Search, current location, map clicks and dragging all require **Use this location** before the corrected centre can be saved. Changing the radius updates the circle. Search controls have separate accessible IDs for each area. Overlays and listeners are removed when the editor closes or an area changes. Search remains available if the map SDK cannot load.

An area's name is a label. Approval still requires **both** an allowed pincode and coordinates within that area's radius, independently for pickup and drop. The server now identifies **Pickup** or **Drop**, and distinguishes an unapproved pincode from a pin outside the coverage circle. This changes error messages only; coverage, routing, fare, payment and assignment rules are preserved.

The customer's shopping header and parcel draft are separate. The supplied screenshot's header says Indore, while the parcel pickup still says Botejhari. Changing the header does not silently replace a confirmed parcel address. Use the parcel flow's Back button, edit pickup/drop, search for the intended Indore address, confirm the pin, then confirm the address and contacts. Editing street text alone deliberately preserves coordinates. A note in the flow now explains this distinction.

A read-only public catalogue check after the change confirmed that the shared policy remains **version 2, pincode 452015 only**. Neither 481332 nor 452006 has been approved in that shared database. The requested synthetic approvals remain confined to the separate 4174 instance, which was restarted and populated again through the actual Admin form.

Executed checks for this follow-up:

| Check | Result |
| --- | --- |
| Backend `npm run test:parcel` | 94 passed, 0 failed, 3 suites |
| Frontend `npm run test:parcel` | 96 passed, 0 failed |
| `node verification/parcel-local-areas-browser.mjs` | Passed: real local Admin save/history, independent search IDs, circle radius update, confirmed dragged pin, unsaved map experiment not saved, overlay cleanup, customer quote, 393px layout; zero unexpected runtime errors and zero bookings in this instance |
| `node verification/parcel-journey-browser.mjs` | 15 passed, 0 failed; one synthetic booking in its own separate disposable database |
| Backend and frontend `npm run build` | Both passed; existing frontend large-chunk warning |
| `git diff --check` | Passed |

The map unit and browser checks use a **simulated Google SDK**, and local geocoding/routes are simulated. This verifies application integration, not real provider availability or physical GPS. The manual 4174 instance intentionally has no Google browser key, so its normal interactive map shows the unavailable/search fallback. The regular app reuses its existing browser key; actual Google API enablement, origin restrictions and live map rendering remain unverified. No real booking, provider payment, production coverage save or deployment occurred. Unrelated full regression suites were not rerun for this focused follow-up; the prior baseline results remain in `parcel-booking-ux.md`.

Files changed in this follow-up: `backend/services/parcelPolicy.service.js`, `backend/verification/parcel-delivery.test.js`, `forntend/src/components/parcels/ParcelPolicyEditor.jsx`, `ParcelMap.jsx`, `ParcelLocationPicker.jsx`, `ParcelBookingFlow.jsx`, `forntend/verification/parcel-location-ui.test.mjs`, `parcel-journey-ui.test.mjs`, `parcel-local-areas-browser.mjs`, and this guide. No schema, endpoint or environment changes were needed.

Evidence: `test-artifacts/parcel-coverage-{backend-tests,frontend-tests,browser,journey-browser,backend-build,frontend-build}.log` and `test-artifacts/parcel-local-areas/results.json`. The screenshots from the map browser run use the controlled SDK and do not represent live Google map imagery.

## Address search postcode preservation — 25 October 2026

The next screenshot showed a customer quote rejected for **pickup pincode 452001**, despite the supplied Durga Nagar/Nanda Nagar address containing **452015**. A read-only catalogue query still returned saved policy **version 2, Indore 452015 only**. The Banganga/452001 row visible in the Admin editor was not in the saved policy. Typing an area into the editor does not activate it.

Inspection found a confirmed search defect: the forward service found a place, but its response omitted the matched postal code. The parcel picker then always made a reverse lookup and replaced the selected address with that lookup's result. Controlled regression tests reproduced both the redundant lookup and the address replacement before the fix: **2 tests failed** as expected.

The existing forward service/API now additionally returns the postal code from the same Google result as the coordinates. The picker preserves that matched address and postal code, without an unnecessary reverse lookup when the postal code is present. Reverse lookup still applies to GPS and moved pins, and enriches legacy search responses without replacing their selected street. No pincode is inferred merely from typed search text and no coverage rule is bypassed. Pincodes are now visible on the candidate and selected location cards. The Admin editor separately identifies the saved coverage/version, so an unsaved row cannot be mistaken for an active approval.

A live, read-only Google Geocoding check for the user-supplied address succeeded outside the restricted execution host. Both forward and reverse calls returned **452015**; the forward precision was **APPROXIMATE**, and the reverse address wording differed. No coordinates, keys or credentials were printed. This establishes the fresh provider result; it does **not** establish how the user's existing browser draft acquired 452001. A stale draft, a different selected location, or a manual field change cannot be distinguished from the screenshot alone. The first restricted-host attempt failed before obtaining a usable provider response and is not counted as successful verification.

After refreshing the application, reselect the pickup through **Back → Locations → Edit pickup → Find address → Use this location**, verify the displayed pincode and pin, and check the contact/details form. This deliberately replaces the old selection without clearing the whole booking draft. Both pickup and drop still require approved pincodes and pins within the saved coverage radius. There was no need to approve 452001 merely to accommodate the incorrect retained field, and no shared policy was changed.

Final results for this fix:

| Check | Actual result |
| --- | --- |
| Backend `npm run test:parcel` | **98 passed, 0 failed**, 3 suites |
| Frontend `npm run test:parcel` | **98 passed, 0 failed** |
| `node verification/parcel-journey-browser.mjs` | **16 passed, 0 failed**, including real forward API/picker postcode preservation and no second reverse request; external Maps responses simulated |
| Backend and frontend builds | Both passed; existing frontend large-chunk warning |
| `git diff --check` | Passed |
| Live Google lookup | Forward and reverse succeeded, 452015; approximate location, no interactive-map, route or physical-GPS verification |

The browser acceptance created one synthetic booking only in its own disposable database. No real booking, production policy change, deployment, payment or provider write occurred. Full unrelated regression suites were not rerun for this focused fix.

Files changed for this fix: `backend/services/geocode.service.js`, `backend/controllers/geo.controller.js`, `backend/verification/parcel-routing.test.js`, `backend/verification/parcel-journey-server.mjs`, `forntend/src/components/parcels/ParcelLocationPicker.jsx`, `ParcelBookingFlow.jsx`, `ParcelPolicyEditor.jsx`, `forntend/verification/parcel-journey-ui.test.mjs`, `parcel-location-ui.test.mjs`, `parcel-journey-browser.mjs`, and this guide. The forward API change is additive; no schema or environment change is needed. Evidence: `test-artifacts/parcel-postcode-before-fix.log`, `parcel-postcode-{frontend-tests,backend-tests,browser,frontend-build,backend-build}.log`, and `test-artifacts/parcel-journey/results.json`.
