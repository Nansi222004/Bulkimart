# Parcel booking UX and maps

## Inspection and implementation plan — 25 October 2026

The existing entry is `HomeServiceEntries` / `ParcelServiceCard` in `forntend/src/components/services/CustomerServices.jsx`, mounted by the customer `LandingPage`. `ParcelCustomerEntry` uses the verified `CustomerSessionContext`. `ParcelDelivery.jsx` already owns booking/history/tracking routes. `ParcelLocationPicker` uses protected `/api/geo/forward` and `/api/geo/reverse`. `DeliveryMap.jsx` contains the existing singleton Google Maps JavaScript loader.

The customer parcel router is `backend/routes/parcelDelivery.routes.js`. `parcelDelivery.controller.js`, `parcelWorkflow.service.js`, `parcelPolicy.service.js`, `parcelPayment.service.js` and `parcelAssignment.service.js` own quotes, bookings, validation, payments and delivery assignment. Existing `ParcelPolicy`, `ParcelQuote` and `ParcelDelivery` remain canonical. Addresses require address/name/phone/pincode and numeric lat/lng. Both endpoints need an approved pincode AND circle coverage. Parcel category, weight and all three dimensions are required. There is one parcel service, with no vehicle tariff catalogue. Prices are integer paise from policy and server road distance. Quotes expire and freeze a policy version. Booking keys are deterministic per customer; quote consumption prevents duplicate bookings. Online payment remains pending until provider verification; pay-driver availability follows policy. Existing production mutations remain release-blocked.

Initial tests before edits: backend parcel delivery/routing/shopping-capacity **81 passed**, frontend location/read/service **53 passed**. Logs: `test-artifacts/parcel-ux-*-baseline.log`. Working tree was clean. Graph tools were not exposed; source inspection was used.

Configured names only: backend `GOOGLE_MAPS_API_KEY` and `MAPS_MODE`, frontend `VITE_GOOGLE_MAPS_API_KEY`. Backend environment contains duplicate Maps definitions; no values are exposed or changed. Source configuration does not prove API enablement, billing or key restrictions. Existing server road routing was unimplemented outside authorized mocks. No live Maps requests or real bookings are necessary for isolated verification.

Plan:

1. Extract the existing SDK singleton for sharing; add Google Places autocomplete, explicit current-location confirmation, pin editing and manual/search fallback.
2. Add real Google Routes support at the existing server map boundary; attach minimized route/service metadata to current quotes and booking DTOs. Preserve pricing, assignment and payment rules.
3. Replace the customer booking form with locations, address/contact/parcel details, route/service selection and fare-review screens. Preserve state and stable retry identity; keep existing history/tracking and payment recovery.
4. Verify provider parsing, serviceability and booking invariants using isolated tests; exercise the actual components and local APIs in a browser with mocked external maps/payments. Run relevant regressions and builds. Document actual results and remaining configuration limits.

## Delivered flow

**Home → Locations → Address/contact and parcel details → Route/service → Fare review → Booking/tracking.**

The existing home service card now uses aqua/orange parcel artwork and retains Send a Parcel and Delivery history. Locations have distinct pickup/drop summaries, one active search, optional saved-address shortcuts and Switch. Places suggestions debounce by 350 ms and support keyboard selection. GPS is requested only after a customer action. Search/GPS/map-pin results require explicit confirmation; failed selection clears previous coordinates. Find address uses the existing protected geocoder when browser Places is unavailable. A map pin plus manual text works if reverse geocoding fails; if no valid coordinates can be obtained, progression remains blocked.

Pickup contact prefills from the verified session; recipient contact stays independent. Building, address/locality/city, landmark, contact, pincode and label remain editable without changing coordinates. The compact parcel section keeps category, description, weight, all three dimensions, instructions and restriction consent. Explicit Save pickup uses the existing saved-address endpoint and its customer-profile contact convention.

The current server quote supplies route geometry, distance, travel duration, service and limits. There is one supported Doorstep delivery service; no unsupported bike/van/truck tier was invented. Review shows the actual base/distance/minimum adjustment/inclusive tax, supported payment choices and accepted terms. No example fares, unsupported discounts or promised pickup ETA. Sticky actions stay above bottom navigation and safe areas.

Only explicit Book Parcel confirmation creates a booking. Existing tracking/history/payment APIs supply the reference, payment/cash state, assigned/pending state and timeline. Online payment remains pending until server verification. Driver assignment, proof codes, financial controls and payment recovery remain unchanged.

Inputs survive backward navigation and temporary moves to history. Tab-session drafts are scoped to the verified account; ordinary drafts expire after one hour. Uncertain booking attempts retain their original key/payload even after quote expiry, allowing replay of an already-created booking. Material edits invalidate quotes/routes and stale asynchronous responses are ignored. Near-expiry quotes require renewed fare review. A synchronous submission lock prevents double taps.

## Maps, configuration and storage

| API | Actual integration |
| --- | --- |
| Maps JavaScript | Existing singleton extracted from DeliveryMap.jsx into utils/googleMaps.js; shared script, load timeout and retry |
| Places API (New) | importLibrary, AutocompleteSuggestion, session token, toPlace and fetchFields for selected coordinates/address components |
| Geocoding / nearby resolver | Existing authenticated /api/geo/forward and /api/geo/reverse |
| Routes API | Existing server getRoute now calls computeRoutes with DRIVE and a narrow distance/duration/encoded-polyline field mask |

Suggestions are restricted to India, matching the canonical six-digit-pincode service policy. No device location is hardcoded. The server validates coordinates, provider output and duration, times out after eight seconds, and fails closed without substituting a straight-line route.

Local inspection found **MAPS_MODE=mock and identical frontend/backend key values**, with duplicate backend Maps definitions. Environment files and credentials were not changed. Files cannot prove Google API enablement, billing or key restrictions. Live use needs separately restricted values in existing VITE_GOOGLE_MAPS_API_KEY (browser referrers) and GOOGLE_MAPS_API_KEY (server/API restrictions), enabled Maps JavaScript, Places (New), Geocoding and Routes APIs, and approved live-mode configuration. Existing production parcel mutations remain blocked.

Google map attribution is preserved; standalone route summaries and Places suggestions include Google Maps attribution. Mock metrics are labelled simulated and have no invented polyline. Geometry/duration are transient quote-response/UI data, not stored in quote/booking documents or session drafts. Existing financial distance records stay intact. Optional pricing.routeProvider is application metadata in the existing Mixed snapshot. **No migration, index operation or dependency addition is required.**

Documentation consulted: [Google Routes requests](https://developers.google.com/maps/documentation/routes/compute_route_directions), [Places autocomplete](https://developers.google.com/maps/documentation/javascript/place-autocomplete-data), [Routes policies](https://developers.google.com/maps/documentation/routes/policies). Account restrictions and public terms/privacy still require review before live activation.

## Existing contracts reused

No new production resource, collection or endpoint was introduced.

- GET /api/parcel-delivery/capabilities and /catalogue: availability, policy limits/categories and payment capabilities.
- GET /api/geo/forward and /reverse: protected resolution.
- GET/POST /api/users/addresses: existing address book and explicit pickup save.
- POST /api/parcel-delivery/quotes: full existing validation/fare rules, with additive transient route and service DTOs.
- POST /api/parcel-delivery/bookings: existing transaction, quote consumption and Idempotency-Key.
- GET /api/parcel-delivery/bookings and /:id: owned history/tracking, additive minimized route distance/provider and service.
- Existing parcel payment/verify/status, cancellation and driver/admin APIs: unchanged lifecycle and recovery.

Both locations must have an approved pincode AND be inside its configured circle **before routing**. The server checks coordinates, contacts, category, consent, weight and every dimension. Prices retain integer-paise base/distance/minimum/inclusive-tax calculations and configured fare/route limits. The browser cannot set fare, payment status, driver or eligibility. Pay-driver is offered only for enabled categories/policy. No payment, escrow, ledger, order, commission, settlement or assignment implementation was modified.

## Actual verification

| Scope | Result |
| --- | --- |
| Initial backend parcel baseline | 81 passed, 0 failed |
| Initial frontend location/read/service baseline | 53 passed, 0 failed |
| Backend npm run test:parcel | **90 passed**, 3 suites, 0 failed |
| Frontend npm run test:parcel | **94 passed**, 0 failed |
| Frontend auth/checkout/startup/delivery/payment/financial regressions | **149 passed**, 0 failed |
| Backend financial-workflow/payment-notifications/fcm-auth | **156 passed**, 3 suites, 0 failed |
| Full backend suite | **54 suites passed, 6 failed; 779 tests passed, 10 failed, 7 skipped** |
| Compare full-suite failures with recorded storefront-final-backend-regression.json | Identical suite/assertion names and releaseReservedCoins setup export |
| Existing parcel-delivery-browser.mjs, normal Chrome sandbox | **35 responsive views**, 2 payment paths, manual assignment, driver lifecycle and error recovery passed |
| New parcel-journey-browser.mjs, normal Chrome sandbox | **15 checks passed**, 0 failed, 0 unexpected browser errors |
| Production-build home/cart/checkout at 390/1440px | **6 scenarios passed**, 0 failed/errors |
| Backend build | Passed (syntax/service-package checks) |
| Frontend build | Passed; existing large-chunk warning |
| git diff --check | Passed |

Executed frontend regression command:

    node --test --test-concurrency=1 tests/auth-role.test.mjs tests/checkout-ui.test.mjs tests/portal-startup.test.mjs tests/delivery-assignment.test.mjs tests/delivery-registration.test.mjs verification/payment-ui.test.mjs verification/razorpay-overlay.test.mjs verification/financial-workflow-ui.test.mjs

Executed backend financial/auth command:

    node --experimental-vm-modules node_modules/jest/bin/jest.js --config verification/jest.config.js --runInBand --runTestsByPath verification/financial-workflow.test.js verification/payment-notifications.test.js verification/fcm-auth.test.js

Full backend command:

    npm test -- --runInBand --json --outputFile=../test-artifacts/parcel-ux-backend-regression.json

Production-build browser command:

    node verification/storefront-browser.mjs --paths=/grocery--home,/cart,/checkout --widths=390,1440

The complete acceptance harness uses actual customer components, Express authentication/middleware, Google-response parsing, parcel policy/fare services, quote/booking transactions, saved-address controller and owned history with a disposable MongoMemoryReplSet. Google SDK/network results and device coordinates are explicitly simulated. It starts at the existing home card, confirms addresses/contacts, adjusts a pin, saves pickup, rejects an out-of-area pincode before Routes, recovers from route failure and displays the real local server fee. Exactly **one synthetic local booking** is created. A simulated intermediary 503 after committed creation, double tap and page reload recover the same booking. Route screens fit 320/390/768/1440px; the mobile review action stays visible. Leaving the map cleans up markers and listeners.

The existing browser suite separately exercises mocked Razorpay checkout, pay-driver, admin assignment and driver proof/cash progression. No real provider payment or dispatch occurred. The complete harness supplies a verified synthetic session; it does not claim a real OTP login or physical-device GPS pass. The production-build matrix checks the normal storefront/home/cart/checkout shell with isolated fixtures.

Early harness attempts failed correctly: its proxy initially omitted Idempotency-Key; a socket-close simulation was retried automatically by Chrome; and readiness could read document.body before mount. The proxy now retains the header, deterministically reports an interrupted response after local commitment, and waits safely for the page. No failed attempt is counted as passed, and original booking assertions remain enforced. Final regression checks also reproduce and fix success notices appearing on unrelated historical bookings, preserve approximate-location warnings after address resolution, and dismiss pending suggestion loading when Escape is pressed.

The unchanged full-suite failures are order-fulfillment-lifecycle, seller-payment.http, admin-workflows.http, razorpay-webhook.http, sms.service and the checkout-workflow.http setup export. No unrelated logic or assertions were changed to alter counts.

Evidence is in ignored test-artifacts/parcel-ux-*.log, parcel-ux-backend-regression.json, parcel-browser-results.json and parcel-journey/results.json/screenshots. Screenshots label the simulated Google map and are not proof of live Google rendering.

## Changed files

| File | Purpose |
| --- | --- |
| backend/services/maps.service.js | Real Routes boundary and explicit mock metadata |
| backend/services/parcelWorkflow.service.js | Transient quote route and minimized booking metadata |
| backend/controllers/parcelDelivery.controller.js | Additive route/service DTO |
| backend/verification/parcel-routing.test.js | Provider parsing/failure/security tests |
| backend/verification/parcel-delivery.test.js | Compatibility and geometry-storage tests |
| backend/verification/parcel-journey-server.mjs | Isolated real-API acceptance server |
| backend/package.json | Parcel test command |
| forntend/src/utils/googleMaps.js | Shared SDK loader and Places integration |
| forntend/src/components/DeliveryMap.jsx | Reuse shared loader |
| forntend/src/components/parcels/ParcelBookingFlow.jsx | Staged flow, price review, retry handling |
| forntend/src/components/parcels/ParcelMap.jsx | Editable pins, quote geometry and cleanup |
| forntend/src/components/parcels/parcelJourney.js | Canonical input/draft helpers |
| forntend/src/components/parcels/ParcelLocationPicker.jsx | Confirmed GPS/Places/search/pin selection |
| forntend/src/components/parcels/ParcelDelivery.jsx | Connect flow to existing history/tracking/payment |
| forntend/src/components/parcels/parcelApi.js | Error status and existing saved-address adapter |
| forntend/src/components/parcels/parcels.css | Responsive cards, map and sticky actions |
| forntend/src/components/services/CustomerServices.jsx | Existing home parcel card |
| forntend/src/components/services/customerServices.css | Aqua/orange discovery treatment |
| forntend/src/modules/User/context/UserContext.jsx | Whitelisted return path after existing sign-in |
| forntend/verification/parcel-journey-ui.test.mjs | Location/flow/SDK/idempotency tests |
| forntend/verification/parcel-read-ui.test.mjs | New form owner, preserved disabled/read assertions |
| forntend/verification/parcel-delivery-browser.mjs | Existing matrix uses staged controls and normal sandbox |
| forntend/verification/parcel-journey-browser.mjs | Real local browser/API acceptance |
| forntend/verification/parcel-journey-entry.jsx | Explicitly simulated SDK/session test boundary |
| forntend/package.json | Parcel unit/browser commands |
| docs/parcel-booking-ux.md | This audit, plan and completion report |

## Remaining limits and production status

Live API enablement/billing/key restrictions, physical GPS, iOS Safari/Android/WebView, real map controls/geometry, and physical-device keyboard/network conditions remain unverified. No additional vehicle tiers, promotions or independent recipient address book were added because there is no approved backend contract for them; the existing address book uses profile contact. Six baseline backend suites still fail as reported.

**No production configuration change, deployment, campaign activation, live database access, real customer booking, real payment, refund or financial transaction was performed.** Acceptance bookings were synthetic and confined to disposable loopback databases.
