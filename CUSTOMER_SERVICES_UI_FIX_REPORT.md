# Customer Services and parcel discovery fix — 2026-10-23

## Verified causes

Services: the home rendered only LegalDiscovery, whose initial state was false, whose link required `/api/customer-services/capabilities` data.catalogue=true, and whose catch silently ignored errors. There was no general `/services` entry in UserContext or LandingPage dispatch. The existing `/legal-services` catalogue and public API are implemented; this was discovery/disabled-state behavior, not a missing implementation. Legal flags default false unless explicitly set to the string true. No matching flags were found in backend/.env or inherited process environment during this session. This is local evidence, not a claim about a deployed environment.

Parcel: App already registers `/parcel-delivery` and descendants under CustomerSessionGate; ParcelCustomerEntry requires a verified customer. LandingPage already had ParcelDiscovery in the pre-existing worktree. That component returned null unless catalogue=true and productionBlocked=false, silently swallowing availability errors. All eight parcel flags default false and the example explicitly disables them. Consequently the existing booking/history/tracking implementation was undiscoverable in a default-disabled environment. No route or backend rebuild was necessary.

The graph MCP tools required by AGENTS.md were not exposed (tool discovery returned no matches); direct inspection was used. Root AGENTS.md is the only AGENTS.md found. Parcel baseline/report, legal report, GST report and current source were inspected. GST intake is vendor-specific, not the customer Services catalogue.

## Changes in this task

- `forntend/src/components/services/CustomerServices.jsx` (new): permanent Services discovery link, capability-aware Services hub reusing LegalServices, standalone parcel card with package icon, honest unavailable/loading/error states and explicit retry. Booking action requires catalogue, booking, automatic assignment, fallback, fulfilment, a payment mode, non-production capability response, and an effective policy with a usable payment mode. Policy/HTTP errors fail closed. Server remains authoritative for directions, quotation, payment and booking.
- `forntend/src/components/services/customerServices.css` (new): aqua/orange styling, wrapping cards, keyboard focus, responsive padding and bottom-bar clearance.
- `forntend/src/modules/User/pages/LandingPage.jsx`: home Services link after existing quick actions; `/services` dispatch with UnifiedHeader. Existing unrelated edits preserved.
- `forntend/src/modules/User/context/UserContext.jsx`: recognizes services pathname.
- `forntend/src/utils/customerSession.js`: public Services discovery, private parcel/history and legal request guards retained.
- `forntend/verification/customer-services-ui.test.mjs` (new): eight capability, discovery, auth classification, empty catalogue and retry checks using actual components.
- This report.

Home in Shop All or Quick Home → Services (`/services`). Services retains the customer header/bottom navigation. Existing catalogue item buttons navigate to `/legal-services/:id`; request history remains `/legal-services/requests`. Parcel booking links to `/parcel-delivery/book`; history links to `/parcel-delivery/history`; existing tracking is `/parcel-delivery/track/:id`. The parcel workspace retains its existing Bulkimart home link and separate session guard. Categories, Orders, Cart and checkout navigation remain in place; no Subscription entry added.

## Catalogue and operational configuration

Backend customer legal routes expose capabilities/catalogue publicly before private authentication middleware. Catalogue matches `status: published` AND `audiences: customer`; DTOs use data arrays/meta as consumed by LegalServices. Vendor-only or unpublished services are intentionally excluded. Admin Manage Services already supports explicit customer audience and publication. An authorized admin must review and publish legitimate customer-eligible entries, and separately approve catalogue flag configuration. Empty successful results show 'No eligible services available'; a disabled catalogue shows unavailable; failures expose retry. No fabricated entries were added.

Actual deployed catalogue records and deployment configuration were not queried. Their presence remains an operational verification item. No production DB, provider or deployment operation was performed. No flags changed. Production bookings/mutations, payment collection, refunds, assignment and fulfilment remain blocked by existing guards. Parcel policy, authoritative directions and separately approved operational configuration remain prerequisites. Existing customer API origin/session conventions are reused; no new alternate base URL. Backend assignment, shopping COD, rider earnings, product order/cart/checkout code are untouched by this task.

## Validation

Commands run from the indicated package directory:

- Frontend `node --test tests/customer-services.test.mjs`: 8 passed, 0 failed before moving to verification/customer-services-ui.test.mjs (tests/ is ignored by repository policy).
- Frontend `node --test tests/customer-services.test.mjs tests/auth-role.test.mjs tests/portal-startup.test.mjs tests/service-ui.test.mjs tests/checkout-ui.test.mjs`: initial invocation ran the four existing files successfully (102 passed, 0 failed); the new file creation had failed due to a doubled directory prefix. The new file was subsequently created and tested separately as above. No combined 110-test run is claimed.
- Backend `node verification/run-shopping-capacity-tests.mjs --config verification/jest.config.js --runInBand --runTestsByPath verification/legal-services.test.js verification/parcel-delivery.test.js verification/parcel-routing.test.js`: 3 suites, 112 passed, 0 failed. Uses isolated test runtime/database, not production.
- Frontend `npm run build`: passed.
- Backend `npm run build`: passed.
- Root `git diff --check`: passed, with line-ending notices.

The full suite was not run. Earlier unrelated baseline failures remain documented in PARCEL_DELIVERY_IMPLEMENTATION_REPORT.md, not represented as new failures or as resolved. Vite test startup emitted optimizer/port diagnostics while parallel suites ran; the completed test commands exited successfully.


Browser layout attempts: frontend `node tests/mobile-layout.test.mjs` and `node tests/mobile-layout.test.mjs --full --paths=/,/services --widths=390,1280` both failed before page inspection with `Browser command timed out: Page.enable`. Mobile and desktop visual behavior is not verified; rerun these checks with a functioning browser automation session. No screenshot was provided in the request, so styling follows existing brand variables and customer shell rather than a screenshot comparison.
`node --test verification/customer-services-ui.test.mjs` (frontend, final tracked-location rerun): 8 passed, 0 failed.
